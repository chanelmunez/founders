import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: '.env.local' });

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

class ComprehensiveGraphExtractor {
  private openaiApiKey: string;
  private anthropicApiKey: string;
  private groqApiKey: string;
  private geminiApiKey: string;
  private globalEntities: Map<string, Entity> = new Map();
  private testMode: boolean = false;
  private episodeLimit: number = 0;

  constructor(testMode: boolean = false, episodeLimit: number = 0) {
    this.openaiApiKey = process.env.openai || '';
    this.anthropicApiKey = process.env.anthropic || '';
    this.groqApiKey = ''; // Removed due to rate limiting issues
    this.geminiApiKey = process.env.gemini || '';
    this.testMode = testMode;
    this.episodeLimit = episodeLimit;
  }

  private createEntityId(name: string, type: string, episodeId: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${type}_${normalized}_${episodeId.substring(0, 8)}`;
  }

  private createRelationshipId(entity1Id: string, entity2Id: string): string {
    const sorted = [entity1Id, entity2Id].sort();
    return `rel_${sorted[0]}_${sorted[1]}_${uuidv4().substring(0, 8)}`;
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
        model: 'gpt-4o',
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
    const content = data.choices[0].message.content.trim();
    
    // Handle cases where OpenAI returns JSON wrapped in markdown code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }
    
    // Try to find JSON object in text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // If no code blocks, try parsing directly
    return JSON.parse(content);
  }

  private async makeAnthropicRequest(text: string, episodeTitle: string, retryCount: number = 0): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    const maxRetries = 2;
    
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.anthropicApiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: `You are an expert at extracting named entities and relationships from business podcast transcripts. You specialize in identifying Amazon-searchable products and creating knowledge graphs. 

CRITICAL: You must return ONLY valid JSON. Do not include any explanations, comments, or text before or after the JSON.

${prompt}`
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      const content = data.content[0].text.trim();
      
      // Multiple strategies to extract valid JSON
      let jsonData;
      
      try {
        // Strategy 1: Try parsing the content directly
        jsonData = JSON.parse(content);
      } catch (error) {
        try {
          // Strategy 2: Extract JSON from markdown code blocks
          const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
          if (codeBlockMatch) {
            jsonData = JSON.parse(codeBlockMatch[1]);
          } else {
            // Strategy 3: Find JSON object in text
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              jsonData = JSON.parse(jsonMatch[0]);
            } else {
              // Strategy 4: Try to clean and fix common JSON issues
              let cleaned = content;
              
              // Remove common prefixes
              cleaned = cleaned.replace(/^.*?(?=\{)/s, '');
              // Remove common suffixes  
              cleaned = cleaned.replace(/\}[^}]*$/s, '}');
              // Fix trailing commas
              cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
              // Fix unescaped quotes in values
              cleaned = cleaned.replace(/: "([^"]*)"([^",}\]]*?)"/g, ': "$1$2"');
              
              jsonData = JSON.parse(cleaned);
            }
          }
        } catch (secondError) {
          throw error; // Throw the original parsing error
        }
      }

      // Validate the JSON structure
      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('Invalid JSON structure: not an object');
      }

      // Ensure required fields exist with defaults
      if (!jsonData.entities) {
        jsonData.entities = [];
      }
      if (!jsonData.relationships) {
        jsonData.relationships = [];
      }

      // Validate entities array
      if (!Array.isArray(jsonData.entities)) {
        jsonData.entities = [];
      }

      // Validate relationships array  
      if (!Array.isArray(jsonData.relationships)) {
        jsonData.relationships = [];
      }

      return jsonData;

    } catch (error) {
      console.warn(`Anthropic request failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
      
      if (retryCount < maxRetries) {
        console.log(`Retrying Anthropic request in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.makeAnthropicRequest(text, episodeTitle, retryCount + 1);
      }
      
      // After all retries failed, return a minimal valid response
      console.warn(`All Anthropic retries failed. Returning minimal response.`);
      return {
        entities: [],
        relationships: [],
        error: `Failed after ${maxRetries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`
      };
    }
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
        model: 'llama3-70b-8192',
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

  private async makeGeminiRequest(text: string, episodeTitle: string): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are an expert at extracting named entities and relationships from business podcast transcripts. You specialize in identifying Amazon-searchable products and creating knowledge graphs. Return only valid JSON.\n\n${prompt}`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const content = data.candidates[0].content.parts[0].text;
    
    // Handle cases where Gemini returns explanation before JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return JSON.parse(content);
  }

  private createEnhancedExtractionPrompt(text: string, episodeTitle: string): string {
    return `Extract named entities and relationships from this business podcast episode for building a knowledge graph.

EPISODE: "${episodeTitle}"

CRITICAL ENTITY TYPES TO EXTRACT:

1. PEOPLE: Founders, entrepreneurs, CEOs, investors, historical business figures, authors
2. PLACES: Companies, organizations, countries, cities, institutions, brands
3. EVENTS: Product launches, acquisitions, IPOs, business milestones, historical events, crises
4. OBJECTS: Technologies, business strategies, methodologies, concepts, frameworks, inventions
5. MEDIA: Books, documentaries, movies, podcasts, articles, publications, TV shows
6. PRODUCTS: Physical/digital products, services, brands, tools, software, consumer goods

AMAZON PRODUCT FOCUS:
For each entity, determine if it's searchable on Amazon for affiliate purposes:
- Books, audiobooks, e-books, magazines
- Physical products, gadgets, tools, electronics
- Software with physical versions, games
- Branded merchandise, clothing, accessories  
- Business tools, supplies, equipment
- Movies, TV shows on DVD/Blu-ray

For AMAZON-SEARCHABLE items, provide 2-4 specific keywords for Amazon search.

RELATIONSHIP EXTRACTION:
Extract detailed relationships showing:
- Business relationships (founded, invested_in, acquired, competed_with, partnered_with)
- Influence relationships (inspired_by, mentored_by, influenced, learned_from)
- Product relationships (created, invented, used, recommended, endorsed)
- Content relationships (wrote_book, appeared_in, featured_in, interviewed_by)
- Family relationships (father_of, son_of, married_to)
- Professional relationships (worked_for, hired, fired, succeeded_by)

QUALITY REQUIREMENTS:
- Focus on the most significant entities (minimum 0.7 confidence)
- Prioritize people, companies, and products over generic concepts
- Extract specific product names, not categories
- Include both historical and contemporary figures
- Capture competitive dynamics and business relationships

Return ONLY valid JSON in this exact format:
{
  "entities": [
    {
      "name": "Exact Entity Name",
      "type": "person|place|event|object|media|product",
      "context": "Detailed description and significance in episode (50-100 words)",
      "amazon_searchable": true/false,
      "amazon_keywords": ["keyword1", "keyword2", "keyword3"] or null,
      "confidence_score": 0.0-1.0
    }
  ],
  "relationships": [
    {
      "entity1_name": "First Entity",
      "entity2_name": "Second Entity", 
      "relationship_type": "specific_relationship_type",
      "description": "Detailed description of the relationship and its significance",
      "confidence_score": 0.0-1.0
    }
  ]
}

IMPORTANT: Extract 8-15 high-quality entities and 5-12 meaningful relationships. Focus on business-relevant entities that would be valuable for a knowledge graph about entrepreneurship and business history.

TRANSCRIPT (first 12000 characters):
${text.substring(0, 12000)}`;
  }

  private processExtractedEntities(
    extractedData: any, 
    episodeId: string, 
    episodeTitle: string
  ): { entities: Entity[], relationships: Relationship[] } {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Process entities
    if (extractedData.entities && Array.isArray(extractedData.entities)) {
      for (const entityData of extractedData.entities) {
        if (!entityData.name || !entityData.type) continue;
        
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
    if (extractedData.relationships && Array.isArray(extractedData.relationships)) {
      for (const relData of extractedData.relationships) {
        if (!relData.entity1_name || !relData.entity2_name) continue;
        
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
            relationship_type: relData.relationship_type || 'related_to',
            description: relData.description || '',
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
          
          if (relationshipStrength > 0.3) {
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
      if (entity.type === 'person') themes.add('Entrepreneurship');
      if (entity.type === 'place' && entity.context.includes('company')) themes.add('Business Strategy');
      if (entity.type === 'product') themes.add('Product Development');
      if (entity.type === 'media' && entity.context.includes('book')) themes.add('Business Literature');
      if (entity.amazon_searchable) themes.add('Recommended Products');
    }
    
    return Array.from(themes);
  }

  async extractFromEpisode(episode: Episode, modelName: string): Promise<EpisodeData> {
    console.log(`🤖 Extracting entities from "${episode.title}" using ${modelName}...`);
    
    try {
      let extractedData;
      
      switch (modelName.toLowerCase()) {
        case 'openai':
          extractedData = await this.makeOpenAIRequest(episode.text, episode.title);
          break;
        case 'anthropic':
          extractedData = await this.makeAnthropicRequest(episode.text, episode.title);
          break;
        case 'gemini':
          extractedData = await this.makeGeminiRequest(episode.text, episode.title);
          break;
        default:
          throw new Error(`Unsupported model: ${modelName}`);
      }

      const { entities, relationships } = this.processExtractedEntities(
        extractedData, 
        episode.episode_id, 
        episode.title
      );

      return {
        episode_id: episode.episode_id,
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
      console.error(`❌ Error extracting from episode "${episode.title}" with ${modelName}:`, error);
      throw error;
    }
  }

  async processEpisodeWithAllModels(episode: Episode): Promise<Map<string, EpisodeData>> {
    const availableModels: string[] = [];
    if (this.openaiApiKey) availableModels.push('openai');
    if (this.anthropicApiKey) availableModels.push('anthropic');
    if (this.geminiApiKey) availableModels.push('gemini');

    const results = new Map<string, EpisodeData>();
    
    // Process all models in parallel for this episode
    const modelPromises = availableModels.map(async (model) => {
      try {
        const result = await this.extractFromEpisode(episode, model);
        return { model, result, success: true };
      } catch (error) {
        console.warn(`⚠️ ${model} failed for "${episode.title}":`, error instanceof Error ? error.message : String(error));
        return { model, result: null, success: false, error };
      }
    });

    const modelResults = await Promise.allSettled(modelPromises);
    
    modelResults.forEach((promiseResult, index) => {
      const model = availableModels[index];
      
      if (promiseResult.status === 'fulfilled' && promiseResult.value.success && promiseResult.value.result) {
        results.set(model, promiseResult.value.result);
        console.log(`  ✅ ${model}: ${promiseResult.value.result.entities.length} entities, ${promiseResult.value.result.relationships.length} relationships`);
      } else {
        const errorMsg = promiseResult.status === 'rejected' 
          ? (promiseResult.reason instanceof Error ? promiseResult.reason.message : String(promiseResult.reason))
          : (promiseResult.value.error instanceof Error ? promiseResult.value.error.message : String(promiseResult.value.error));
        console.log(`  ❌ ${model}: Failed (${errorMsg})`);
      }
    });

    return results;
  }

  async processWithAllModels(inputFile: string): Promise<void> {
    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }

    console.log(`📖 Reading podcast data from ${inputFile}...`);
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const podcastData: PodcastData = JSON.parse(rawData);

    const availableModels = [];
    if (this.openaiApiKey) availableModels.push('openai');
    if (this.anthropicApiKey) availableModels.push('anthropic');
    if (this.geminiApiKey) availableModels.push('gemini');

    console.log(`🤖 Available AI models: ${availableModels.join(', ')}`);
    console.log(`📊 Found ${podcastData.episodes.length} episodes to process`);

    const episodesToProcess = this.testMode 
      ? podcastData.episodes.slice(0, this.episodeLimit)
      : podcastData.episodes;

    console.log(`🎯 Processing ${episodesToProcess.length} episodes${this.testMode ? ' (TEST MODE)' : ''}`);
    console.log(`⚡ Using parallel processing for faster extraction\n`);

    // Initialize model data storage
    const modelData = new Map<string, EpisodeData[]>();
    availableModels.forEach(model => modelData.set(model, []));

    const startTime = Date.now();

    // Process episodes with rate limiting but parallel model execution
    for (let i = 0; i < episodesToProcess.length; i++) {
      const episode = episodesToProcess[i];
      
      if (!episode.text || episode.text.length < 100) {
        console.log(`⚠️ Skipping "${episode.title}" - insufficient text (${episode.text?.length || 0} chars)`);
        continue;
      }

      console.log(`🔄 Episode ${i + 1}/${episodesToProcess.length}: "${episode.title}"`);
      
      try {
        // Process all models in parallel for this episode
        const episodeResults = await this.processEpisodeWithAllModels(episode);
        
        // Store results by model
        episodeResults.forEach((result, model) => {
          modelData.get(model)?.push(result);
        });

        // Rate limiting between episodes (not between models)
        if (i < episodesToProcess.length - 1) {
          console.log(`  ⏱️ Waiting 3 seconds before next episode...\n`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

      } catch (error) {
        console.error(`❌ Failed to process episode "${episode.title}":`, error);
        continue;
      }
    }

    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`\n⏱️ Total processing time: ${processingTime.toFixed(1)} seconds\n`);

    // Generate outputs for each model
    for (const model of availableModels) {
      const episodeData = modelData.get(model) || [];
      const successCount = episodeData.length;

      if (successCount > 0) {
        console.log(`📊 Processing ${model.toUpperCase()} results...`);
        
        // Detect cross-episode relationships
        const crossEpisodeRels = this.detectCrossEpisodeRelationships(episodeData);
        
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

        // Generate datetime stamp for filenames (YYYYMMDDHHMMSS format)
        const now = new Date();
        const dateTimeStamp = now.getFullYear().toString() +
          (now.getMonth() + 1).toString().padStart(2, '0') +
          now.getDate().toString().padStart(2, '0') +
          now.getHours().toString().padStart(2, '0') +
          now.getMinutes().toString().padStart(2, '0') +
          now.getSeconds().toString().padStart(2, '0');
        
        // Save model-specific file in data folder with datetime stamp
        const outputSuffix = this.testMode ? '-test' : '';
        const modelOutputFile = path.join(process.cwd(), 'data', `nodejs-podcast-${model}${outputSuffix}_${dateTimeStamp}.json`);
        fs.writeFileSync(modelOutputFile, JSON.stringify(graphOutput, null, 2));
        console.log(`💾 Saved ${model} results to: ${modelOutputFile}`);

        // Save relationships file for this model in data folder with datetime stamp
        const relationshipsFile = path.join(process.cwd(), 'data', `nodejs-podcast-relationships-${model}${outputSuffix}_${dateTimeStamp}.json`);
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
        
        console.log(`📊 ${model.toUpperCase()} FINAL RESULTS:`);
        console.log(`   ✅ Episodes: ${successCount}`);
        console.log(`   🏷️ Entities: ${allEntities.length}`);
        console.log(`   🔗 Relationships: ${allRelationships.length}`);
        console.log(`   🌐 Cross-episode connections: ${crossEpisodeRels.length}`);
        console.log(`   🛒 Amazon products: ${amazonProducts.length}\n`);
      } else {
        console.log(`❌ No episodes successfully processed with ${model}\n`);
      }
    }

    console.log(`🎉 Parallel graph entity extraction completed for all models!`);
    console.log(`⚡ Total time saved by parallel processing: ~${(processingTime * (availableModels.length - 1) / availableModels.length).toFixed(1)} seconds`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isTestMode = args.includes('--test') || args.includes('-t');
  const episodeLimitArg = args.find(arg => arg.startsWith('--limit='));
  const episodeLimit = episodeLimitArg ? parseInt(episodeLimitArg.split('=')[1]) : 3;
  
  const inputFileArg = args.find(arg => arg.startsWith('--input='));
  const inputFile = inputFileArg 
    ? inputFileArg.split('=')[1]
    : isTestMode 
      ? 'nodejs-podcast-summary-test.json'
      : 'nodejs-podcast-summary.json';

  console.log('🎯 Comprehensive Graph Entity Extraction');
  console.log('=======================================');
  
  if (isTestMode) {
    console.log(`🧪 TEST MODE: Processing ${episodeLimit} episodes only`);
  }

  const extractor = new ComprehensiveGraphExtractor(isTestMode, episodeLimit);

  try {
    await extractor.processWithAllModels(path.join(process.cwd(), inputFile));
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();