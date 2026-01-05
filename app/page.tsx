"use client";

import { useState } from "react";

interface AgentStep {
  step: string;
  reasoning?: string;
  searchQueries?: string[];
  results?: any;
  timestamp: Date;
}

interface PartsList {
  categories: {
    name: string;
    components: {
      name: string;
      options: {
        name: string;
        specifications: string[];
        pros: string[];
        cons: string[];
        datasheetLink?: string;
        vendorLinks?: { name: string; url: string; price?: string }[];
      }[];
    }[];
  }[];
}

export default function Home() {
  const [projectDescription, setProjectDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [partsList, setPartsList] = useState<PartsList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectDescription.trim()) {
      setError("Please enter a project description");
      return;
    }

    setIsLoading(true);
    setError(null);
    setAgentSteps([]);
    setPartsList(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectDescription }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to execute agent");
      }

      const data = await response.json();
      // Convert timestamp strings back to Date objects
      const stepsWithDates = (data.steps || []).map((step: any) => ({
        ...step,
        timestamp: new Date(step.timestamp),
      }));
      setAgentSteps(stepsWithDates);
      setPartsList(data.partsList || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            Part Finder Agent
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            AI-powered assistant to help you find electronic components for your projects
          </p>
        </header>

        {/* Input Form */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="project-description"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              >
                Project Description
              </label>
              <textarea
                id="project-description"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Describe your project and the components you need. For example: 'I'm building a temperature monitoring system that needs to measure temperatures from -40°C to 125°C with 0.1°C accuracy. I need sensors, a microcontroller, and a display.'"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white resize-none"
                rows={6}
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 disabled:cursor-not-allowed"
            >
              {isLoading ? "Searching for Components..." : "Find Components"}
            </button>
          </form>
          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Agent Execution Display */}
        {agentSteps.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
              Agent Execution
            </h2>
            <div className="space-y-4">
              {agentSteps.map((step, index) => (
                <div
                  key={index}
                  className="border-l-4 border-blue-500 pl-4 py-2 bg-slate-50 dark:bg-slate-700/50 rounded-r-lg"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Step {index + 1}
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      {step.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-900 dark:text-white font-medium mb-2">
                    {step.step}
                  </p>
                  {step.reasoning && (
                    <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">Reasoning:</span> {step.reasoning}
                      </p>
                    </div>
                  )}
                  {step.searchQueries && step.searchQueries.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Search Queries:
                      </p>
                      <ul className="list-disc list-inside space-y-1">
                        {step.searchQueries.map((query, qIndex) => (
                          <li
                            key={qIndex}
                            className="text-sm text-slate-600 dark:text-slate-400"
                          >
                            {query}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {isLoading && agentSteps.length === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-slate-700 dark:text-slate-300">
                Initializing agent...
              </p>
            </div>
          </div>
        )}

        {/* Parts List Results */}
        {partsList && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-6">
              Recommended Parts List
            </h2>
            <div className="space-y-8">
              {partsList.categories.map((category, catIndex) => (
                <div key={catIndex} className="border-b border-slate-200 dark:border-slate-700 pb-6 last:border-b-0 last:pb-0">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                    {category.name}
                  </h3>
                  <div className="space-y-6">
                    {category.components.map((component, compIndex) => (
                      <div
                        key={compIndex}
                        className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4"
                      >
                        <h4 className="text-lg font-medium text-slate-900 dark:text-white mb-3">
                          {component.name}
                        </h4>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {component.options.map((option, optIndex) => (
                            <div
                              key={optIndex}
                              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg p-4"
                            >
                              <h5 className="font-semibold text-slate-900 dark:text-white mb-2">
                                {option.name}
                              </h5>
                              {option.specifications.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                    Specifications:
                                  </p>
                                  <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                    {option.specifications.map((spec, specIndex) => (
                                      <li key={specIndex} className="list-disc list-inside">
                                        {spec}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {option.pros.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">
                                    Pros:
                                  </p>
                                  <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                    {option.pros.map((pro, proIndex) => (
                                      <li key={proIndex} className="list-disc list-inside">
                                        {pro}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {option.cons.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">
                                    Cons:
                                  </p>
                                  <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                    {option.cons.map((con, conIndex) => (
                                      <li key={conIndex} className="list-disc list-inside">
                                        {con}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {option.datasheetLink && (
                                <div className="mb-2">
                                  <a
                                    href={option.datasheetLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    📄 Datasheet
                                  </a>
                                </div>
                              )}
                              {option.vendorLinks && option.vendorLinks.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                    Vendors:
                                  </p>
                                  <ul className="space-y-1">
                                    {option.vendorLinks.map((vendor, vendorIndex) => (
                                      <li key={vendorIndex}>
                                        <a
                                          href={vendor.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                          {vendor.name}
                                          {vendor.price && ` - ${vendor.price}`}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

