import * as fs from 'fs';
import * as path from 'path';

interface Episode {
  title: string;
  text: string;
  episode_number?: number;
  date?: string;
  url?: string;
  episode_id: string;
}

interface PodcastData {
  episodes: Episode[];
}

interface Entity {
  id: string;
  episode_id: string;
  name: string;
  type: string;
  context: string;
  amazon_searchable: boolean;
  amazon_keywords?: string[];
  confidence_score?: number;
}

interface Relationship {
  id: string;
  episode_id: string;
  entity1_id: string;
  entity1_name: string;
  entity2_id: string;
  entity2_name: string;
  relationship_type: string;
  description: string;
  confidence_score?: number;
  is_cross_episode?: boolean;
}

interface EpisodeData {
  episode_id: string;
  episode_title: string;
  episode_number?: number;
  date?: string;
  url?: string;
  entities: Entity[];
  relationships: Relationship[];
  extracted_by: string;
  extracted_at: string;
}

interface GraphOutput {
  episodes: EpisodeData[];
  all_entities: Entity[];
  all_relationships: Relationship[];
  cross_episode_relationships: any[];
  amazon_products: Entity[];
  extraction_metadata: any;
}

interface SearchResult {
  episode_id: string;
  episode_title: string;
  episode_number?: number;
  episode_url?: string;
  episode_date?: string;
  match_type: 'episode_text' | 'episode_title' | 'entity_name' | 'entity_context' | 'relationship_description';
  match_details: string;
  entities_linked: Entity[];
  relationships_linked: Relationship[];
  relevance_score: number;
}

class PodcastSearchEngine {
  private summaryData: PodcastData | null = null;
  private entityData: GraphOutput | null = null;
  private relationshipData: any | null = null;

  constructor() {}

  private loadSummaryData(): void {
    try {
      const summaryPath = path.join(process.cwd(), 'data/nodejs-podcast-summary-cleaned.json');
      if (!fs.existsSync(summaryPath)) {
        throw new Error(`Summary file not found: ${summaryPath}`);
      }
      
      const rawData = fs.readFileSync(summaryPath, 'utf-8');
      this.summaryData = JSON.parse(rawData);
      console.log(`📖 Loaded ${this.summaryData?.episodes.length} episodes from summary`);
    } catch (error) {
      console.error('❌ Error loading summary data:', error);
      throw error;
    }
  }

  private loadModelData(model: string): void {
    try {
      // Find the latest files for the specified model
      const dataDir = path.join(process.cwd(), 'data');
      const files = fs.readdirSync(dataDir);
      
      // Find entity file
      const entityFiles = files
        .filter(f => f.startsWith(`nodejs-podcast-${model}`) && f.endsWith('.json') && !f.includes('relationships'))
        .sort()
        .reverse();
      
      // Find relationship file  
      const relationshipFiles = files
        .filter(f => f.startsWith(`nodejs-podcast-relationships-${model}`) && f.endsWith('.json'))
        .sort()
        .reverse();

      if (entityFiles.length === 0) {
        throw new Error(`No entity files found for model: ${model}`);
      }
      
      if (relationshipFiles.length === 0) {
        throw new Error(`No relationship files found for model: ${model}`);
      }

      // Load the most recent files
      const entityPath = path.join(dataDir, entityFiles[0]);
      const relationshipPath = path.join(dataDir, relationshipFiles[0]);
      
      console.log(`📊 Loading entity data from: ${entityFiles[0]}`);
      const entityRawData = fs.readFileSync(entityPath, 'utf-8');
      this.entityData = JSON.parse(entityRawData);
      
      console.log(`🔗 Loading relationship data from: ${relationshipFiles[0]}`);
      const relationshipRawData = fs.readFileSync(relationshipPath, 'utf-8');
      this.relationshipData = JSON.parse(relationshipRawData);
      
      console.log(`✅ Loaded data for model '${model}': ${this.entityData?.all_entities.length} entities, ${this.entityData?.all_relationships.length} relationships`);
      
    } catch (error) {
      console.error(`❌ Error loading model data for '${model}':`, error);
      throw error;
    }
  }

  private calculateRelevanceScore(searchTerm: string, text: string, matchType: string): number {
    const lowerSearchTerm = searchTerm.toLowerCase();
    const lowerText = text.toLowerCase();
    
    // Exact match gets highest score
    if (lowerText.includes(lowerSearchTerm)) {
      // Calculate how many times the term appears
      const matches = (lowerText.match(new RegExp(lowerSearchTerm, 'g')) || []).length;
      
      // Base score by match type
      let baseScore = 0;
      switch (matchType) {
        case 'episode_title': baseScore = 100; break;
        case 'entity_name': baseScore = 90; break;
        case 'relationship_description': baseScore = 80; break;
        case 'entity_context': baseScore = 70; break;
        case 'episode_text': baseScore = 60; break;
        default: baseScore = 50; break;
      }
      
      // Bonus for multiple matches
      const matchBonus = Math.min(matches * 10, 50);
      
      // Penalty for longer text (diluted relevance)
      const lengthPenalty = Math.max(0, (text.length - 100) / 100);
      
      return Math.max(1, baseScore + matchBonus - lengthPenalty);
    }
    
    // Fuzzy matching for partial relevance
    const words = lowerSearchTerm.split(' ');
    const matchingWords = words.filter(word => lowerText.includes(word));
    
    if (matchingWords.length > 0) {
      const wordMatchRatio = matchingWords.length / words.length;
      return Math.round(wordMatchRatio * 30); // Max 30 for partial matches
    }
    
    return 0;
  }

  private findEpisodeById(episodeId: string): Episode | null {
    if (!this.summaryData) return null;
    return this.summaryData.episodes.find(ep => ep.episode_id === episodeId) || null;
  }

  private searchInEpisodeText(searchTerm: string): SearchResult[] {
    if (!this.summaryData) return [];
    
    const results: SearchResult[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();

    for (const episode of this.summaryData.episodes) {
      let matchFound = false;
      let matchType: SearchResult['match_type'] = 'episode_text';
      let matchDetails = '';
      let relevanceScore = 0;

      // Check episode title
      if (episode.title.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchType = 'episode_title';
        matchDetails = `Found "${searchTerm}" in episode title: "${episode.title}"`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, episode.title, 'episode_title');
      }
      // Check episode text
      else if (episode.text && episode.text.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchType = 'episode_text';
        
        // Extract context around the match
        const textLower = episode.text.toLowerCase();
        const matchIndex = textLower.indexOf(lowerSearchTerm);
        const contextStart = Math.max(0, matchIndex - 100);
        const contextEnd = Math.min(episode.text.length, matchIndex + searchTerm.length + 100);
        const context = episode.text.substring(contextStart, contextEnd);
        
        matchDetails = `Found "${searchTerm}" in episode text: "...${context}..."`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, episode.text, 'episode_text');
      }

      if (matchFound) {
        // Get entities and relationships for this episode
        const episodeEntities = this.entityData?.all_entities.filter(e => e.episode_id === episode.episode_id) || [];
        const episodeRelationships = this.entityData?.all_relationships.filter(r => r.episode_id === episode.episode_id) || [];

        results.push({
          episode_id: episode.episode_id,
          episode_title: episode.title,
          episode_number: episode.episode_number,
          episode_url: episode.url,
          episode_date: episode.date,
          match_type: matchType,
          match_details: matchDetails,
          entities_linked: episodeEntities,
          relationships_linked: episodeRelationships,
          relevance_score: relevanceScore
        });
      }
    }

    return results;
  }

  private searchInEntities(searchTerm: string): SearchResult[] {
    if (!this.entityData) return [];
    
    const results: SearchResult[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();
    const processedEpisodes = new Set<string>();

    for (const entity of this.entityData.all_entities) {
      let matchFound = false;
      let matchType: SearchResult['match_type'] = 'entity_context';
      let matchDetails = '';
      let relevanceScore = 0;

      // Check entity name
      if (entity.name.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchType = 'entity_name';
        matchDetails = `Found "${searchTerm}" in entity name: "${entity.name}" (${entity.type})`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, entity.name, 'entity_name');
      }
      // Check entity context
      else if (entity.context && entity.context.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchType = 'entity_context';
        matchDetails = `Found "${searchTerm}" in entity context for "${entity.name}": "${entity.context}"`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, entity.context, 'entity_context');
      }

      if (matchFound && !processedEpisodes.has(entity.episode_id)) {
        processedEpisodes.add(entity.episode_id);
        
        const episode = this.findEpisodeById(entity.episode_id);
        if (episode) {
          // Get all entities and relationships for this episode
          const episodeEntities = this.entityData.all_entities.filter(e => e.episode_id === entity.episode_id);
          const episodeRelationships = this.entityData.all_relationships.filter(r => r.episode_id === entity.episode_id);

          results.push({
            episode_id: entity.episode_id,
            episode_title: episode.title,
            episode_number: episode.episode_number,
            episode_url: episode.url,
            episode_date: episode.date,
            match_type: matchType,
            match_details: matchDetails,
            entities_linked: episodeEntities,
            relationships_linked: episodeRelationships,
            relevance_score: relevanceScore
          });
        }
      }
    }

    return results;
  }

  private searchInRelationships(searchTerm: string): SearchResult[] {
    if (!this.entityData) return [];
    
    const results: SearchResult[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();
    const processedEpisodes = new Set<string>();

    for (const relationship of this.entityData.all_relationships) {
      let matchFound = false;
      let matchDetails = '';
      let relevanceScore = 0;

      // Check relationship description
      if (relationship.description && relationship.description.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchDetails = `Found "${searchTerm}" in relationship: "${relationship.entity1_name}" ${relationship.relationship_type} "${relationship.entity2_name}" - ${relationship.description}`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, relationship.description, 'relationship_description');
      }
      // Check relationship type
      else if (relationship.relationship_type.toLowerCase().includes(lowerSearchTerm)) {
        matchFound = true;
        matchDetails = `Found "${searchTerm}" in relationship type: "${relationship.entity1_name}" ${relationship.relationship_type} "${relationship.entity2_name}"`;
        relevanceScore = this.calculateRelevanceScore(searchTerm, relationship.relationship_type, 'relationship_description');
      }

      if (matchFound && !processedEpisodes.has(relationship.episode_id)) {
        processedEpisodes.add(relationship.episode_id);
        
        const episode = this.findEpisodeById(relationship.episode_id);
        if (episode) {
          // Get all entities and relationships for this episode
          const episodeEntities = this.entityData.all_entities.filter(e => e.episode_id === relationship.episode_id);
          const episodeRelationships = this.entityData.all_relationships.filter(r => r.episode_id === relationship.episode_id);

          results.push({
            episode_id: relationship.episode_id,
            episode_title: episode.title,
            episode_number: episode.episode_number,
            episode_url: episode.url,
            episode_date: episode.date,
            match_type: 'relationship_description',
            match_details: matchDetails,
            entities_linked: episodeEntities,
            relationships_linked: episodeRelationships,
            relevance_score: relevanceScore
          });
        }
      }
    }

    return results;
  }

  public search(searchTerm: string, model: string = 'gemini'): SearchResult[] {
    console.log(`🔍 Searching for "${searchTerm}" using model "${model}"...`);
    
    // Load data
    this.loadSummaryData();
    this.loadModelData(model);

    // Perform searches
    const episodeResults = this.searchInEpisodeText(searchTerm);
    const entityResults = this.searchInEntities(searchTerm);
    const relationshipResults = this.searchInRelationships(searchTerm);

    // Combine and deduplicate results
    const allResults = [...episodeResults, ...entityResults, ...relationshipResults];
    const uniqueResults = new Map<string, SearchResult>();

    for (const result of allResults) {
      const existing = uniqueResults.get(result.episode_id);
      if (!existing || result.relevance_score > existing.relevance_score) {
        uniqueResults.set(result.episode_id, result);
      }
    }

    // Sort by relevance score (descending)
    const sortedResults = Array.from(uniqueResults.values())
      .sort((a, b) => b.relevance_score - a.relevance_score);

    console.log(`📊 Found ${sortedResults.length} episodes matching "${searchTerm}"`);
    
    return sortedResults;
  }

  public displayResults(results: SearchResult[], limit: number = 10): void {
    if (results.length === 0) {
      console.log('❌ No results found');
      return;
    }

    const displayResults = results.slice(0, limit);
    
    console.log(`\n🎯 Top ${displayResults.length} Results:\n${'='.repeat(50)}`);
    
    for (let i = 0; i < displayResults.length; i++) {
      const result = displayResults[i];
      console.log(`\n${i + 1}. ${result.episode_title} (Score: ${result.relevance_score})`);
      console.log(`   📺 Episode #${result.episode_number || 'N/A'} | ${result.episode_date || 'Unknown date'}`);
      console.log(`   🔗 ${result.episode_url || 'No URL'}`);
      console.log(`   📝 Match: ${result.match_details}`);
      console.log(`   🏷️  Entities: ${result.entities_linked.length} | 🔗 Relationships: ${result.relationships_linked.length}`);
      
      if (result.entities_linked.length > 0) {
        const topEntities = result.entities_linked.slice(0, 5).map(e => e.name).join(', ');
        console.log(`   👥 Top Entities: ${topEntities}${result.entities_linked.length > 5 ? '...' : ''}`);
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const modelArg = args.find(arg => arg.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : 'gemini';
  
  const searchArg = args.find(arg => arg.startsWith('--search='));
  let searchTerm = searchArg ? searchArg.split('=')[1] : 'tech';
  
  // If no --search flag, treat all remaining args as search term
  if (!searchArg && args.length > 0) {
    const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));
    if (nonFlagArgs.length > 0) {
      searchTerm = nonFlagArgs.join(' ');
    }
  }
  
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10;

  console.log('🔍 Podcast Knowledge Graph Search');
  console.log('=================================');
  console.log(`📊 Model: ${model}`);
  console.log(`🔍 Search Term: "${searchTerm}"`);
  console.log(`📋 Results Limit: ${limit}\n`);

  const searchEngine = new PodcastSearchEngine();
  
  try {
    const results = searchEngine.search(searchTerm, model);
    searchEngine.displayResults(results, limit);
  } catch (error) {
    console.error('❌ Search failed:', error);
    process.exit(1);
  }
}

// Only run main if this script is executed directly
if (require.main === module) {
  main();
}

export { PodcastSearchEngine, SearchResult };