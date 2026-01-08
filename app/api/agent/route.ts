import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import axios from "axios";
import { access } from "fs";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const TAVILY_API_URL = "https://api.tavily.com/search";
const DIGIKEY_API_URL = "https://api.digikey.com"; // Base URL for DigiKey API

const clientId = process.env.DIGIKEY_CLIENT_ID!;
const clientSecret = process.env.DIGIKEY_CLIENT_SECRET!;

interface AgentStep {
  step: string;
  reasoning?: string;
  searchQueries?: string[];
  results?: any;
  timestamp: Date;
}

function extractJSON(text: string): any {
  const trimmed = text.trim();
  
  // Try to find JSON in markdown code blocks first
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\[\{][\s\S]*?[\]\}])\s*```/);
  if (codeBlockMatch) {
    console.log("Extracted JSON from code block");
    return JSON.parse(codeBlockMatch[1].trim());
  }
  
  // Find the first { or [ and match its closing } or ]
  let jsonStart = trimmed.indexOf('{');
  let isObject = true;
  
  if (jsonStart === -1) {
    jsonStart = trimmed.indexOf('[');
    isObject = false;
  }
  
  if (jsonStart === -1) {
    console.log('No JSON object or array found in response');
    throw new Error('No JSON object or array found in response');
  }
  
  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';
  let braceCount = 0;
  let jsonEnd = -1;
  
  for (let i = jsonStart; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === openChar) braceCount++;
    if (char === closeChar) {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i;
        break;
      }
    }
  }
  
  if (jsonEnd === -1) {
    console.log('No matching closing bracket found');
    throw new Error('No matching closing bracket found');
  }
  
  const jsonString = trimmed.substring(jsonStart, jsonEnd + 1);
  
  console.log(jsonString);
  return JSON.parse(jsonString);
}

async function searchWithTavily(query: string): Promise<any> {
  try {
    const response = await axios.post(TAVILY_API_URL, {
      api_key: process.env.TAVILY_API_KEY,
      query: query,
      search_depth: "advanced",
      include_answer: true,
      include_images: false,
      include_raw_content: false,
      max_results: 5,
    });
    return response.data;
  } catch (error) {
    console.error("Tavily search error:", error);
    throw error;
  }
}

// 1. Get access token first
async function getDigikeyToken(clientId: string, clientSecret: string) {
  const tokenUrl = 'https://api.digikey.com/v1/oauth2/token';
  
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString()
  });

  const data = await response.json();

  console.log("DigiKey Token Response:", data);

  return data.access_token; // Save this!
}

async function searchWithDigiKey(query: string, accessToken: string): Promise<any> {
  try {
    const response = await axios.post(
      `${DIGIKEY_API_URL}/products/v4/search/keyword`,
      {
        Keywords: query,
        Limit: 1,
        Offset: 0,
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-DIGIKEY-Client-Id': process.env.DIGIKEY_CLIENT_ID || '',
          'Content-Type': 'application/json'
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("DigiKey search error:", error);
    throw error;
  }
}

async function analyzeWithGroq(
  prompt: string,
  systemPrompt?: string,
  retries = 3
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
          { role: "user" as const, content: prompt },
        ],
        response_format: { "type": "json_object" },
        temperature: 0.7,
      });
      return response.choices[0]?.message?.content || "";
    } catch (error: any) {
      // Check if it's a rate limit error
      if (error?.code === "rate_limit_exceeded" && attempt < retries - 1) {
        const retryAfter = error?.retry_after_seconds || 5;
        console.log(`Rate limited, waiting ${retryAfter}s before retry ${attempt + 1}/${retries}`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      console.error("Groq API error:", error);
      throw error;
    }
  }
  throw new Error("Failed after retries");
}

export async function POST(request: NextRequest) {
  try {
    const { projectDescription } = await request.json();

    if (!projectDescription) {
      return NextResponse.json(
        { error: "Project description is required" },
        { status: 400 }
      );
    }

    // Check for API keys
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured" },
        { status: 500 }
      );
    }
    if (!process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "TAVILY_API_KEY is not configured" },
        { status: 500 }
      );
    }
    // DigiKey API key is optional for now
    const hasDigiKey = !!process.env.DIGIKEY_API_KEY;

    const steps: AgentStep[] = [];

    // Step 1: Parse requirements and identify components
    const analysisPrompt = `Analyze the following project description and identify the electronic components needed. 
Provide a structured JSON response with:
1. Required component categories (limit to 3-5 key categories to keep the response concise, e.g., "Microcontrollers", "Sensors", etc. Do NOT repeat categories)
2. Key specifications for each category
3. Any constraints or special requirements

Project description: ${projectDescription}

Respond in JSON format with this structure:
{
  "categories": [
    {
      "name": "category name",
      "specifications": ["spec1", "spec2"],
      "constraints": ["constraint1", "constraint2"]
    }
  ]
}`;

    steps.push({
      step: "Analyzing project requirements",
      reasoning: "Parsing the project description to identify required components and specifications",
      timestamp: new Date(),
    });

    const requirementsAnalysis = await analyzeWithGroq(
      analysisPrompt,
      "You are an expert electronics engineer. Analyze project requirements and identify needed components."
    );

    // Add delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    let requirementsData;
    try {
      // Extract JSON from the response
      const jsonMatch = requirementsAnalysis.match(/\{[\s\S]*\}/);
      requirementsData = jsonMatch ? JSON.parse(jsonMatch[0]) : { categories: [] };
      // Deduplicate categories by name
      const uniqueCategories = new Map();
      for (const cat of requirementsData.categories || []) {
        if (!uniqueCategories.has(cat.name.toLowerCase())) {
          uniqueCategories.set(cat.name.toLowerCase(), cat);
        }
      }
      requirementsData.categories = Array.from(uniqueCategories.values());
    } catch (e) {
      console.error("Failed to parse requirements:", e);
      requirementsData = { categories: [] };
    }

    // Step 2: Generate search plan
    steps.push({
      step: "Generating search plan",
      reasoning: "Creating a structured plan to search for components",
      timestamp: new Date(),
    });

    const searchPlanPrompt = `Based on the following component categories, generate specific search queries to find:
1. Component options and alternatives
2. Datasheets and technical specifications
3. Digikey vendor information and pricing
4. Comparison reviews

Categories: ${JSON.stringify(requirementsData.categories, null, 2)}

Generate 3-5 specific search queries for each category. Format as a JSON array of objects EXACTLY in the format shown here, ensuring the structure includes "category" and "queries":
[
  {"category": "category name", "queries": ["query1", "query2", "query3"]}
]`;

    const searchPlanResponse = await analyzeWithGroq(
      searchPlanPrompt,
      "You are an expert at finding electronic components. Generate effective search queries."
    );

    console.log("Extracted search plan:", searchPlanResponse);

    // Add delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    let searchPlan: Array<{ category: string; queries: string[] }> = [];
    try {
      const jsonMatch = searchPlanResponse.match(/\[[\s\S]*\]/);
      searchPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

      console.log("Extracted search plan:", searchPlan);

      // Deduplicate search plan by category
      const uniqueSearchPlan = new Map();
      for (const item of searchPlan) {
        if (!uniqueSearchPlan.has(item.category.toLowerCase())) {
          uniqueSearchPlan.set(item.category.toLowerCase(), item);
        }
      }
      searchPlan = Array.from(uniqueSearchPlan.values());
    } catch (e) {
      console.error("Failed to parse search plan:", e);
      searchPlan = [];
    }
/*
    let searchPlan: Array<{ category: string; queries: string[] }> = [];
    try {
      searchPlan = extractJSON(searchPlanResponse);
      console.log("Extracted search plan:", searchPlan);
    } catch (e) {
      console.error("Failed to parse search plan:", e);
      console.error("Raw search plan response:", searchPlanResponse);
      searchPlan = [];
    }*/

    // Step 3: Execute searches and analyze results
    const allSearchQueries: string[] = [];
    const searchResultsMap: Map<string, any[]> = new Map();

    for (const planItem of searchPlan) {
      steps.push({
        step: `Searching for ${planItem.category} components`,
        reasoning: `Executing web searches to find options, specifications, and vendor information`,
        searchQueries: planItem.queries,
        timestamp: new Date(),
      });

      allSearchQueries.push(...planItem.queries);

      // Execute searches for this category
      const categoryResults: any[] = [];
      for (const query of planItem.queries.slice(0, 3)) { // Limit to 3 queries per category to avoid rate limits
        try {
          const tavilyResults = await searchWithTavily(query);
          categoryResults.push({
            query,
            results: tavilyResults.results || [],
            answer: tavilyResults.answer,
          });
        } catch (error) {
          console.error(`Search failed for query "${query}":`, error);
        }
      }
      searchResultsMap.set(planItem.category, categoryResults);
    }

    const token = await getDigikeyToken(clientId, clientSecret);

    console.log("DigiKey Token: " + token);

    // Step 4: Analyze search results and extract component information
    steps.push({
      step: "Analyzing search results",
      reasoning: "Extracting component specifications, pros/cons, and vendor information from search results",
      timestamp: new Date(),
    });

    const componentRecommendations: any = {};

    for (const [category, results] of searchResultsMap.entries()) {
      const resultsText = results
        .map((r) => {
          const resultSnippets = (r.results || [])
            .slice(0, 2) // Limit to 3 results per query to reduce token usage
            .map((item: any) => `${item.title}: ${item.content}`)
            .join("\n\n");
          return `Query: ${r.query}\nAnswer: ${r.answer}\nResults:\n${resultSnippets}`;
        })
        .join("\n\n---\n\n");

//console.log("resultsText:" + resultsText);

const analysisPrompt = `Based on the following search results for ${category}, extract and structure component recommendations.

Search Results:
${resultsText}

CRITICAL: Respond with ONLY valid JSON. No explanations, no markdown, no text before or after. Start your response with { and end with }.

Provide a JSON response with this exact structure:
{
  "components": [
    {
      "name": "component name",
      "options": [
        {
          "name": "option name (e.g., 'Arduino Uno', 'Raspberry Pi 4')",
          "specifications": ["spec1", "spec2"],
          "pros": ["pro1", "pro2"],
          "cons": ["con1", "con2"],
          "datasheetLink": "Leave this blank for now",
          "vendorLinks": [
            {"name": "vendor name", "url": "vendor url", "price": "price if available"}
          ]
        }
      ]
    }
  ]
}

Include 1-3 options per component. Include 1-3 components per category. Be specific with specifications, pros, and cons.`;

      const componentAnalysis = await analyzeWithGroq(
        analysisPrompt,
        "You are an expert electronics engineer. Respond ONLY with valid JSON, no other text."
      );

      console.log(`Component analysis for ${category}: ${componentAnalysis}`);


      // Add delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        let jsonString = componentAnalysis.trim();
        
        // Try to extract JSON from markdown code blocks first
        const codeBlockMatch = jsonString.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          jsonString = codeBlockMatch[1].trim();
        } else {
          // Look for JSON object boundaries more carefully
          // Find the first { that's likely the start of our JSON
          const startIndex = jsonString.indexOf('{');
          if (startIndex === -1) {
            throw new Error('No opening brace found in response');
          }
          
          // Find matching closing brace by counting braces
          let braceCount = 0;
          let endIndex = -1;
          for (let i = startIndex; i < jsonString.length; i++) {
            if (jsonString[i] === '{') braceCount++;
            if (jsonString[i] === '}') braceCount--;
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }
          
          if (endIndex === -1) {
            throw new Error('No matching closing brace found in response');
          }
          
          jsonString = jsonString.substring(startIndex, endIndex + 1);
        }
        
        const parsed = JSON.parse(jsonString);

        // Log datasheet links for debugging
        const datasheetLinks = parsed.components?.flatMap((comp: any) => 
          comp.options?.map((opt: any) => opt.datasheetLink).filter(Boolean)
        ) || [];
        console.log(`Datasheet links for ${category}:`, datasheetLinks);

        componentRecommendations[category] = parsed.components || [];
      } catch (e) {
        console.error(`Failed to parse component analysis for ${category}:`, e);
        console.error('Raw response:', componentAnalysis);
        componentRecommendations[category] = [];
      }
    }

    // Step 5: Synthesize final parts list
    steps.push({
      step: "Synthesizing final parts list",
      reasoning: "Compiling all findings into a comprehensive, organized parts list",
      timestamp: new Date(),
    });

    const partsList = {
      categories: Object.entries(componentRecommendations).map(([categoryName, components]) => ({
        name: categoryName,
        components: Array.isArray(components) ? components : [],
      })),
    };

    // Step 6: Recommend final compatible parts list
    steps.push({
      step: "Recommending final parts list",
      reasoning: "Selecting one compatible option per component to create a recommended final parts list",
      timestamp: new Date(),
    });

    const finalListPrompt = `Based on the following parts list, recommend a final set of compatible components for the project.

Parts List:
${JSON.stringify(partsList, null, 2)}

Project Description: ${projectDescription}

Select exactly one option per component (unless the component is not necessary, in which case do not include it), ensuring all selected parts are compatible with each other (e.g., voltage levels, interfaces, power requirements). Consider the project requirements and constraints.

Respond ONLY with valid JSON in this structure:
{
  "finalParts": [
    {
      "category": "category name",
      "component": "component name",
      "selectedOption": {
        "name": "option name",
        "specifications": ["spec1", "spec2"],
        "pros": ["pro1", "pro2"],
        "cons": ["con1", "con2"],
        "datasheetLink": "link or empty",
        "vendorLinks": [{"name": "vendor", "url": "url", "price": "price"}]
      },
      "compatibilityNotes": "brief notes on compatibility"
    }
  ],
  "totalEstimatedCost": "approximate total cost if available",
  "compatibilitySummary": "overall compatibility assessment"
}`;

    const finalListResponse = await analyzeWithGroq(
      finalListPrompt,
      "You are an expert electronics engineer. Select compatible components for a complete system."
    );

    // Add delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    let finalList: any = { finalParts: [], totalEstimatedCost: "", compatibilitySummary: "" };
    try {
      const trimmedResponse = finalListResponse.trim();
      const startIndex = trimmedResponse.indexOf('{');
      const endIndex = trimmedResponse.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
        const jsonString = trimmedResponse.substring(startIndex, endIndex + 1);
        finalList = JSON.parse(jsonString);
        
        // Log selected datasheet links for debugging
        const selectedDatasheetLinks = finalList.finalParts?.map((part: any) => part.selectedOption?.datasheetLink).filter(Boolean) || [];

        //INSERT USE OF DIGIKEY SEARCH HERE USING EACH NAME IN finalList.finalParts[i].selectedOption.name

        for (const part of finalList.finalParts) {
          const componentName = part.selectedOption?.name;

          const digiKeyResults = await searchWithDigiKey(componentName, token);
          console.log(`DigiKey search results for ${componentName}:`, digiKeyResults);

          // Set final parts links to DigiKey links if possible, otherwise remove the link
          part.selectedOption.vendorLinks = []; // Clear existing vendor links
          if (digiKeyResults && digiKeyResults.Products && digiKeyResults.Products.length > 0) {
            const product = digiKeyResults.Products[0]; // Use the first result
            if (product.DatasheetUrl) {
              part.selectedOption.datasheetLink = product.DatasheetUrl;
            } else {
              part.selectedOption.datasheetLink = '';
            }
            // Add photo URL
            part.selectedOption.photoUrl = product.PhotoUrl || '';
            // Add DigiKey to vendorLinks
            part.selectedOption.vendorLinks.push({
              name: 'DigiKey',
              url: product.ProductUrl || `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(componentName)}`,
              price: product.UnitPrice ? `$${product.UnitPrice}` : ''
            });
          } else {
            part.selectedOption.datasheetLink = '';
            // Leave vendorLinks empty
          }

          // Remove the old check since we're now setting it properly
          // const datasheetLink = part.selectedOption?.datasheetLink || "";
          // if (datasheetLink.includes("digikey.com")) {
          //   console.log(`Datasheet link for ${componentName} is from DigiKey: ${datasheetLink}`);
          // }
        }

        console.log('Selected datasheet links in final list:', selectedDatasheetLinks);
      }

    } catch (e) {
      console.error("Failed to parse final list:", e);
      console.error('Raw response:', finalListResponse);
    }

    return NextResponse.json({
      steps: steps.map((step) => ({
        ...step,
        timestamp: step.timestamp.toISOString(),
      })),
      partsList,
      finalList,
    });
  } catch (error) {
    console.error("Agent execution error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to execute agent",
      },
      { status: 500 }
    );
  }
}
