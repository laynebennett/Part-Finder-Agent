# Part Finder Agent

An autonomous AI agent that helps engineers find electronic components for their projects. Built with Next.js 14, TypeScript, Groq API, and Tavily API.

## Features

- 🤖 **AI-Powered Analysis**: Uses Groq (Llama 3.1) to understand project requirements and reason about component needs
- 🔍 **Web Search Integration**: Leverages Tavily API to search for components, datasheets, and vendor information
- 📋 **Comprehensive Parts Lists**: Generates detailed component recommendations with specifications, pros/cons, and purchasing links
- 🎨 **Modern UI**: Clean, responsive interface built with Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Groq API key ([Get one here](https://console.groq.com/) - Free tier available!)
- Tavily API key ([Get one here](https://tavily.com))

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd Part-Finder-Agent
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
```

4. Edit `.env.local` and add your API keys:
```
GROQ_API_KEY=your_groq_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
Part-Finder-Agent/
├── app/
│   ├── api/
│   │   └── agent/
│   │       └── route.ts          # API route for agent execution
│   ├── globals.css               # Global styles with Tailwind
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Main page with UI
├── .env.local.example            # Environment variables template
├── next.config.js                # Next.js configuration
├── package.json                  # Dependencies
├── tailwind.config.ts            # Tailwind CSS configuration
└── tsconfig.json                 # TypeScript configuration
```

## How It Works

1. **User Input**: User describes their project and component requirements
2. **Requirement Analysis**: Groq API parses and understands the requirements
3. **Planning**: Agent generates a step-by-step plan to find components
4. **Search Execution**: For each step, Tavily API searches the web for relevant information
5. **Analysis**: Groq API analyzes search results and extracts relevant data
6. **Synthesis**: All findings are compiled into a comprehensive parts list
7. **Presentation**: Results are displayed with specifications, links, and recommendations

## Next Steps

The current implementation includes:
- ✅ Next.js 14 project setup with TypeScript
- ✅ Tailwind CSS configuration
- ✅ Basic UI with input form and results display
- ✅ API route placeholder for agent execution

**Current implementation:**
- ✅ Groq API integration for reasoning (using Llama 3.1)
- ✅ Tavily API integration for web search
- ✅ Agent workflow logic
- ✅ Parts list generation and formatting

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## License

MIT

