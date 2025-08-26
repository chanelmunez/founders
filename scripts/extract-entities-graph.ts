import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Simple UUID function using crypto
function generateUUID(): string {
  return crypto.randomBytes(16).toString('hex');
}

// Load environment variables from .env.local manually
try {
  const envFile = fs.readFileSync('.env.local', 'utf-8');
  envFile.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      let key, value;
      if (line.includes('=')) {
        const [k, ...valueParts] = line.split('=');
        key = k.trim();
        value = valueParts.join('=').trim();
      } else if (line.includes(':')) {
        const [k, ...valueParts] = line.split(':');
        key = k.trim();
        value = valueParts.join(':').trim();
      }
      if (key && value) {
        process.env[key] = value;
      }
    }
  });
} catch (error) {
  console.warn('No .env.local file found');
}

interface Episode {
  title: string;
  text: string;
  episode_number?: number;
  date?: string;
  url?: string;
}

interface PodcastData {
  episodes: Episode[];
}

interface Entity {
  id: string;
  episode_id: string;
  name: string;
  type: 'person' | 'place' | 'event' | 'object' | 'media' | 'product';
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

interface CrossEpisodeRelationship {
  id: string;
  episode1_id: string;
  episode1_title: string;
  episode2_id: string;
  episode2_title: string;
  shared_entities: string[];
  relationship_strength: number;
  common_themes: string[];
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
  cross_episode_relationships: CrossEpisodeRelationship[];
  amazon_products: Entity[];
  extraction_metadata: {
    total_episodes: number;
    total_entities: number;
    total_relationships: number;
    models_used: string[];
    extracted_at: string;
  };
}

class GraphEntityExtractor {
  private openaiApiKey: string;
  private anthropicApiKey: string;
  private groqApiKey: string;
  private entityCache: Map<string, Entity[]> = new Map();
  private globalEntities: Map<string, Entity> = new Map();

  constructor() {
    this.openaiApiKey = process.env.openai || '';
    this.anthropicApiKey = process.env.anthropic || '';
    this.groqApiKey = process.env.groq || '';
  }

  private createEntityId(name: string, type: string, episodeId: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${type}_${normalized}_${episodeId.substring(0, 8)}`;
  }

  private createRelationshipId(entity1Id: string, entity2Id: string): string {
    const sorted = [entity1Id, entity2Id].sort();
    return `rel_${sorted[0]}_${sorted[1]}_${generateUUID().substring(0, 8)}`;
  }

  private async makeOpenAIRequest(text: string, episodeTitle: string): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting named entities and relationships from business podcast transcripts. You specialize in identifying Amazon-searchable products and creating knowledge graphs. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }

  private async makeAnthropicRequest(text: string, episodeTitle: string): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicApiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: `You are an expert at extracting named entities and relationships from business podcast transcripts. You specialize in identifying Amazon-searchable products and creating knowledge graphs. Return only valid JSON.\n\n${prompt}`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const content = data.content[0].text;
    
    // Handle cases where Claude returns explanation before JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return JSON.parse(content);
  }

  private async makeGroqRequest(text: string, episodeTitle: string): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting named entities and relationships from business podcast transcripts. You specialize in identifying Amazon-searchable products and creating knowledge graphs. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }

  private createEnhancedExtractionPrompt(text: string, episodeTitle: string): string {
    return `Extract named entities and relationships from this business podcast episode for building a knowledge graph.

EPISODE: "${episodeTitle}"

CRITICAL ENTITY TYPES TO EXTRACT:

1. PEOPLE: Founders, entrepreneurs, CEOs, investors, historical business figures
2. PLACES: Companies, organizations, countries, cities, institutions
3. EVENTS: Product launches, acquisitions, IPOs, business milestones, historical events
4. OBJECTS: Technologies, business strategies, methodologies, concepts, frameworks
5. MEDIA: Books, documentaries, movies, podcasts, articles, publications
6. PRODUCTS: Physical/digital products, services, brands, tools, software

AMAZON PRODUCT FOCUS:
For each entity, determine if it's searchable on Amazon for affiliate purposes:
- Books, audiobooks, e-books
- Physical products, gadgets, tools
- Software with physical versions
- Branded merchandise
- Business tools and supplies

For AMAZON-SEARCHABLE items, provide specific keywords for Amazon search.

RELATIONSHIP EXTRACTION:
Extract detailed relationships showing:
- Business relationships (founded, invested_in, acquired, competed_with)
- Influence relationships (inspired_by, mentored_by, influenced)
- Product relationships (created, used, recommended)
- Content relationships (wrote_book, appeared_in, featured_in)

Return ONLY valid JSON in this exact format:
{
  "entities": [
    {
      "name": "Exact Entity Name",
      "type": "person|place|event|object|media|product",
      "context": "Detailed description and significance in episode",
      "amazon_searchable": true/false,
      "amazon_keywords": ["keyword1", "keyword2"] or null,
      "confidence_score": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "entity1_name": "First Entity",
      "entity2_name": "Second Entity", 
      "relationship_type": "specific_relationship_type",
      "description": "Detailed description of the relationship",
      "confidence_score": 0.0-1.0
    }
  ]
}

TRANSCRIPT (first 8000 characters):
${text.substring(0, 8000)}`;
  }

  private processExtractedEntities(
    extractedData: any, 
    episodeId: string, 
    episodeTitle: string
  ): { entities: Entity[], relationships: Relationship[] } {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Process entities
    if (extractedData.entities) {
      for (const entityData of extractedData.entities) {
        const entityId = this.createEntityId(entityData.name, entityData.type, episodeId);
        
        const entity: Entity = {
          id: entityId,
          episode_id: episodeId,
          name: entityData.name,
          type: entityData.type,
          context: entityData.context || '',
          amazon_searchable: entityData.amazon_searchable || false,
          amazon_keywords: entityData.amazon_keywords || undefined,
          confidence_score: entityData.confidence_score || 0.8
        };

        entities.push(entity);
        
        // Add to global cache for cross-episode relationships
        const globalKey = `${entity.name.toLowerCase()}_${entity.type}`;
        if (!this.globalEntities.has(globalKey)) {
          this.globalEntities.set(globalKey, entity);
        }
      }
    }

    // Process relationships
    if (extractedData.relationships) {
      for (const relData of extractedData.relationships) {
        const entity1Id = this.findEntityId(relData.entity1_name, entities);
        const entity2Id = this.findEntityId(relData.entity2_name, entities);
        
        if (entity1Id && entity2Id) {
          const relationship: Relationship = {
            id: this.createRelationshipId(entity1Id, entity2Id),
            episode_id: episodeId,
            entity1_id: entity1Id,
            entity1_name: relData.entity1_name,
            entity2_id: entity2Id,
            entity2_name: relData.entity2_name,
            relationship_type: relData.relationship_type,
            description: relData.description,
            confidence_score: relData.confidence_score || 0.8,
            is_cross_episode: false
          };
          
          relationships.push(relationship);
        }
      }
    }

    return { entities, relationships };
  }

  private findEntityId(entityName: string, entities: Entity[]): string | null {
    const found = entities.find(e => 
      e.name.toLowerCase() === entityName.toLowerCase()
    );
    return found ? found.id : null;
  }

  public detectCrossEpisodeRelationships(allEpisodeData: EpisodeData[]): CrossEpisodeRelationship[] {
    const crossEpisodeRels: CrossEpisodeRelationship[] = [];
    
    for (let i = 0; i < allEpisodeData.length; i++) {
      for (let j = i + 1; j < allEpisodeData.length; j++) {
        const episode1 = allEpisodeData[i];
        const episode2 = allEpisodeData[j];
        
        const sharedEntities = this.findSharedEntities(episode1.entities, episode2.entities);
        
        if (sharedEntities.length > 0) {
          const relationshipStrength = this.calculateRelationshipStrength(sharedEntities, episode1, episode2);
          
          if (relationshipStrength > 0.3) { // Threshold for meaningful connection
            crossEpisodeRels.push({
              id: `cross_${episode1.episode_id}_${episode2.episode_id}`,
              episode1_id: episode1.episode_id,
              episode1_title: episode1.episode_title,
              episode2_id: episode2.episode_id,
              episode2_title: episode2.episode_title,
              shared_entities: sharedEntities.map(e => e.name),
              relationship_strength: relationshipStrength,
              common_themes: this.extractCommonThemes(sharedEntities)
            });
          }
        }
      }
    }
    
    return crossEpisodeRels;
  }

  private findSharedEntities(entities1: Entity[], entities2: Entity[]): Entity[] {
    const shared: Entity[] = [];
    
    for (const entity1 of entities1) {
      for (const entity2 of entities2) {
        if (entity1.name.toLowerCase() === entity2.name.toLowerCase() && 
            entity1.type === entity2.type) {
          shared.push(entity1);
          break;
        }
      }
    }
    
    return shared;
  }

  private calculateRelationshipStrength(sharedEntities: Entity[], ep1: EpisodeData, ep2: EpisodeData): number {
    const totalEntities1 = ep1.entities.length;
    const totalEntities2 = ep2.entities.length;
    const sharedCount = sharedEntities.length;
    
    // Weight by entity types (people and companies are more significant)
    let weightedScore = 0;
    for (const entity of sharedEntities) {
      switch (entity.type) {
        case 'person': weightedScore += 3; break;
        case 'place': weightedScore += 2.5; break;
        case 'product': weightedScore += 2; break;
        case 'media': weightedScore += 1.5; break;
        default: weightedScore += 1; break;
      }
    }
    
    return Math.min(1, (weightedScore / Math.max(totalEntities1, totalEntities2)) * 2);
  }

  private extractCommonThemes(sharedEntities: Entity[]): string[] {
    const themes = new Set<string>();
    
    for (const entity of sharedEntities) {
      // Extract themes based on entity types and context
      if (entity.type === 'person') themes.add('Entrepreneurship');
      if (entity.type === 'place' && entity.context.includes('company')) themes.add('Business Strategy');
      if (entity.type === 'product') themes.add('Product Development');
      if (entity.type === 'media' && entity.context.includes('book')) themes.add('Business Literature');
      if (entity.amazon_searchable) themes.add('Recommended Products');
    }
    
    return Array.from(themes);
  }

  async extractFromEpisode(episode: Episode, modelName: string): Promise<EpisodeData> {
    const episodeId = `ep_${episode.episode_number || Date.now()}_${generateUUID().substring(0, 8)}`;
    
    console.log(`Extracting entities from "${episode.title}" using ${modelName}...`);
    
    try {
      let extractedData;
      
      switch (modelName.toLowerCase()) {
        case 'openai':
          extractedData = await this.makeOpenAIRequest(episode.text, episode.title);
          break;
        case 'anthropic':
          extractedData = await this.makeAnthropicRequest(episode.text, episode.title);
          break;
        case 'groq':
          extractedData = await this.makeGroqRequest(episode.text, episode.title);
          break;
        default:
          throw new Error(`Unsupported model: ${modelName}`);
      }

      const { entities, relationships } = this.processExtractedEntities(
        extractedData, 
        episodeId, 
        episode.title
      );

      return {
        episode_id: episodeId,
        episode_title: episode.title,
        episode_number: episode.episode_number,
        date: episode.date,
        url: episode.url,
        entities,
        relationships,
        extracted_by: modelName,
        extracted_at: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error extracting from episode "${episode.title}" with ${modelName}:`, error);
      throw error;
    }
  }
}

async function main() {
  try {
    const inputFile = path.join(process.cwd(), 'nodejs-podcast-summary.json');
    
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }

    console.log('Reading podcast data...');
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const podcastData: PodcastData = JSON.parse(rawData);

    console.log(`Found ${podcastData.episodes.length} episodes`);

    const extractor = new GraphEntityExtractor();
    const models = ['openai', 'anthropic', 'groq'];
    const processLimit = 5; // Process first 5 episodes

    for (const model of models) {
      console.log(`\nProcessing with ${model}...`);
      const episodeData: EpisodeData[] = [];
      let successCount = 0;

      for (let i = 0; i < Math.min(processLimit, podcastData.episodes.length); i++) {
        const episode = podcastData.episodes[i];
        
        if (!episode.text || episode.text.length < 100) {
          console.log(`Skipping episode "${episode.title}" - insufficient text`);
          continue;
        }

        try {
          const result = await extractor.extractFromEpisode(episode, model);
          episodeData.push(result);
          successCount++;
          
          console.log(`✓ Processed episode ${i + 1}: ${result.entities.length} entities, ${result.relationships.length} relationships`);

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`✗ Failed to process episode "${episode.title}" with ${model}:`, error);
          continue;
        }
      }

      if (successCount > 0) {
        // Detect cross-episode relationships
        const crossEpisodeRels = extractor.detectCrossEpisodeRelationships(episodeData);
        
        // Aggregate all entities and relationships
        const allEntities: Entity[] = [];
        const allRelationships: Relationship[] = [];
        const amazonProducts: Entity[] = [];

        for (const epData of episodeData) {
          allEntities.push(...epData.entities);
          allRelationships.push(...epData.relationships);
          amazonProducts.push(...epData.entities.filter(e => e.amazon_searchable));
        }

        // Create comprehensive output
        const graphOutput: GraphOutput = {
          episodes: episodeData,
          all_entities: allEntities,
          all_relationships: allRelationships,
          cross_episode_relationships: crossEpisodeRels,
          amazon_products: amazonProducts,
          extraction_metadata: {
            total_episodes: successCount,
            total_entities: allEntities.length,
            total_relationships: allRelationships.length,
            models_used: [model],
            extracted_at: new Date().toISOString()
          }
        };

        // Save model-specific file
        const modelOutputFile = path.join(process.cwd(), `nodejs-podcast-${model}.json`);
        fs.writeFileSync(modelOutputFile, JSON.stringify(graphOutput, null, 2));
        console.log(`✓ Saved comprehensive data to ${modelOutputFile}`);

        // Save relationships file (combined from all successful models)
        const relationshipsFile = path.join(process.cwd(), 'nodejs-podcast-relationships.json');
        const relationshipsOutput = {
          relationships: allRelationships,
          cross_episode_relationships: crossEpisodeRels,
          metadata: {
            extracted_by: model,
            extracted_at: new Date().toISOString(),
            total_relationships: allRelationships.length,
            cross_episode_relationships: crossEpisodeRels.length
          }
        };
        fs.writeFileSync(relationshipsFile, JSON.stringify(relationshipsOutput, null, 2));
        console.log(`✓ Saved relationships to ${relationshipsFile}`);
        
        console.log(`\n📊 ${model} Results:`);
        console.log(`   Episodes: ${successCount}`);
        console.log(`   Entities: ${allEntities.length}`);
        console.log(`   Relationships: ${allRelationships.length}`);
        console.log(`   Cross-episode connections: ${crossEpisodeRels.length}`);
        console.log(`   Amazon products: ${amazonProducts.length}`);
      } else {
        console.log(`❌ No episodes successfully processed with ${model}`);
      }
    }

    console.log('\n🎉 Graph entity extraction completed!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();