import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import axios from "axios";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const TAVILY_API_URL = "https://api.tavily.com/search";
const DIGIKEY_API_URL = "https://api.digikey.com"; // Base URL for DigiKey API

interface AgentStep {
  step: string;
  reasoning?: string;
  searchQueries?: string[];
  results?: any;
  timestamp: Date;
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

async function searchWithDigiKey(query: string): Promise<any> {
  try {
    const response = await axios.get(`${DIGIKEY_API_URL}/search/v3/products/keyword`, {
      params: {
        keywords: query,
        limit: 5,
      },
      headers: {
        'Authorization': `Bearer ${process.env.DIGIKEY_API_KEY}`,
        'X-DIGIKEY-Client-Id': process.env.DIGIKEY_CLIENT_ID || '', // If needed
      },
    });
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
1. Required component categories (e.g., "Microcontrollers", "Sensors", "Power Management", etc.)
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
3. Vendor information and pricing
4. Comparison reviews

Categories: ${JSON.stringify(requirementsData.categories, null, 2)}

Generate 3-5 specific search queries for each category. Format as a JSON array of objects:
[
  {"category": "category name", "queries": ["query1", "query2", "query3"]}
]`;

    const searchPlanResponse = await analyzeWithGroq(
      searchPlanPrompt,
      "You are an expert at finding electronic components. Generate effective search queries."
    );

    // Add delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));

    let searchPlan: Array<{ category: string; queries: string[] }> = [];
    try {
      const jsonMatch = searchPlanResponse.match(/\[[\s\S]*\]/);
      searchPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
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
            .slice(0, 5)
            .map((item: any) => `${item.title}: ${item.content}`)
            .join("\n\n");
          return `Query: ${r.query}\nAnswer: ${r.answer}\nResults:\n${resultSnippets}`;
        })
        .join("\n\n---\n\n");

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
          "datasheetLink": "ONLY include if from manufacturer website, DigiKey, Mouser, or Octopart. Otherwise leave empty or omit.",
          "vendorLinks": [
            {"name": "vendor name", "url": "vendor url", "price": "price if available"}
          ]
        }
      ]
    }
  ]
}

Important: Only include datasheetLink if the URL is from a reputable source (manufacturer website, digikey.com, mouser.com, octopart.com). 
Include 2-4 options per component. Be specific with specifications, pros, and cons.`;

      const componentAnalysis = await analyzeWithGroq(
        analysisPrompt,
        "You are an expert electronics engineer. Respond ONLY with valid JSON, no other text."
      );

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

Select exactly one option per component, ensuring all selected parts are compatible with each other (e.g., voltage levels, interfaces, power requirements). Consider the project requirements and constraints.

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
