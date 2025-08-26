# Founders Podcast Search

A Next.js application for searching and exploring episodes, entities, and relationships from the Founders Podcast. Features a dark-themed interface with modal views and Amazon product integration.

## Features

- 🔍 **Smart Search**: Search across episodes, entities, and relationships with relevance scoring
- 📱 **Responsive Design**: Mobile-friendly dark theme interface
- 🎯 **Auto-search**: Debounced search with 500ms delay for smooth user experience
- 📖 **Modal Views**: Detailed popups for episodes, entities, and relationships
- 🛒 **Amazon Integration**: Search and display relevant Amazon products for media entities
- 🏷️ **Smart Pills**: Clickable tags with formatted text (replaces underscores, capitalizes words)
- ⚡ **Fast Loading**: Optimized with Next.js 14 and app router

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- SerpAPI key for Amazon search functionality

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd founders-podcast
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create `.env.local` file with your API keys:
   ```bash
   # Required for Amazon search functionality
   SERPAPI_KEY=your_serpapi_key_here
   
   # Optional: Add other AI service keys for data processing
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   GROQ_API_KEY=your_groq_key
   GEMINI_API_KEY=your_gemini_key
   ```

4. **Prepare data files** (see Data Processing section)

### Development

```bash
# Start development server
npm run dev

# Build for production  
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

The application will be available at `http://localhost:3000`

## Data Processing

The application requires processed JSON data files. Use these scripts to generate them:

### Core Data Scripts

```bash
# 1. Parse episodes from Founders Podcast website
npm run parse-episodes

# 2. Extract full episode text content
npm run parse-episode-text

# 3. Clean and format episode text
npm run clean-text

# 4. Extract entities using AI services
npm run extract-entities

# 5. Extract relationships and build knowledge graph
npm run extract-graph

# 6. Complete scraping and processing pipeline
npm run scrape-and-process
```

### Script Details

- **parse-episodes**: Scrapes episode metadata, titles, and URLs
- **parse-episode-text**: Extracts full episode transcripts and content
- **clean-text**: Formats text for better readability and paragraph breaks
- **extract-entities**: Uses AI to identify people, companies, products, media, and places
- **extract-graph**: Builds relationships between entities across episodes
- **scrape-and-process**: Complete end-to-end processing pipeline

### Required Data Files

The application expects these files in the `src/` directory:

- `data-episodes-claude.json` - Episode metadata with extracted entities
- `data-relationships-claude.json` - Relationships between entities
- `data-episodes-text.json` - Full episode text content

## File Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── amazon-search/route.ts    # SerpAPI Amazon search
│   │   ├── globals.css                   # Dark theme styles
│   │   ├── layout.tsx                    # Root layout
│   │   └── page.tsx                      # Main search interface
│   ├── data-episodes-claude.json         # Episode + entity data
│   ├── data-relationships-claude.json    # Relationship data  
│   └── data-episodes-text.json           # Full episode text
├── scripts/                              # Data processing scripts
│   ├── parse_episodes_nodejs.ts          # Episode metadata scraping
│   ├── parse_episode_text_nodejs.ts      # Episode text extraction
│   ├── clean_podcast_text.ts             # Text cleaning and formatting
│   ├── extract_entities_ai.ts            # AI-powered entity extraction
│   ├── comprehensive-graph-extraction.ts # Relationship building
│   └── scrape-and-process-episodes.ts    # Complete pipeline
├── data/                                 # Raw data files (gitignored)
└── package.json                         # Project dependencies
```

## API Integration

### Amazon Search

The application integrates with SerpAPI to search Amazon for relevant products:

- **Triggers**: Entities with `amazon_searchable: true` or `type: "media"`
- **Search Terms**: Uses `amazon_keywords` array or entity name
- **Display**: Shows thumbnail, title, and Amazon link in entity modals

### Search API

Internal search functionality with relevance scoring:

- **Episode Search**: Title and entity matching
- **Entity Search**: Name and context matching  
- **Relationship Search**: Type and description matching
- **Scoring**: Weighted relevance based on match type and position

## Deployment

### Vercel (Recommended)

1. **Connect repository to Vercel**
2. **Set environment variables** in Vercel dashboard
3. **Deploy** - automatic builds on push to main branch

### Other Platforms

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm start
   ```

## Configuration

### Search Behavior

- **Debounce Delay**: 500ms (configurable in `page.tsx`)
- **Initial Results**: Shows 5 most recent episodes on load
- **Pill Text Limit**: 15 characters with truncation
- **Results Limit**: No hard limit, sorted by relevance

### Modal Behavior

- **Close Methods**: Click outside, close button, or ESC key
- **Body Scroll**: Disabled when modal is open
- **Amazon Search**: Automatic for eligible entities

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is for educational and research purposes. Podcast content belongs to the original creators.