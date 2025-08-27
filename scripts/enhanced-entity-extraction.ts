import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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

interface AmazonProduct {
  url: string;
  title: string;
  thumbnail?: string;
}

interface Entity {
  id: string;
  episode_id: string;
  name: string;
  type: 'person' | 'place' | 'event' | 'object' | 'media' | 'product';
  context: string;
  amazon_searchable: boolean;
  amazon_keywords?: string[];
  amazon_products?: AmazonProduct[]; // Store complete Amazon product details
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
}

interface EpisodeData {
  episode_id: string;
  episode_title: string;
  entities: Entity[];
  relationships: Relationship[];
  extracted_by: string;
  extracted_at: string;
}

class EnhancedEntityExtractor {
  private openaiApiKey: string;
  private anthropicApiKey: string;
  private geminiApiKey: string;
  private serpApiKey: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.serpApiKey = process.env.SERPAPI_KEY || '';
    
    if (!this.serpApiKey) {
      console.warn('Warning: No SerpAPI key found. Amazon URL fetching will be skipped.');
    }
  }

  private generateUUID(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private createEntityId(name: string, type: string, episodeId: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `ent_${normalized}_${episodeId.substring(0, 8)}`;
  }

  private async fetchAmazonProducts(productName: string, keywords?: string[]): Promise<AmazonProduct[] | undefined> {
    if (!this.serpApiKey) return undefined;

    try {
      const searchQuery = keywords && keywords.length > 0 
        ? `${productName} ${keywords.join(' ')}` 
        : productName;

      // Direct SerpAPI call for Amazon search
      const url = `https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(searchQuery)}&api_key=${this.serpApiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`SerpAPI error: ${response.status} for "${productName}"`);
        console.warn(`Error details:`, errorText.substring(0, 200));
        return undefined;
      }

      const data = await response.json();
      console.log(`✓ SerpAPI success for "${productName}":`, data.organic_results ? data.organic_results.length : 0, 'results');
      
      if (data.organic_results && data.organic_results.length > 0) {
        // Get top 3 results with complete product details
        const topResults = data.organic_results.slice(0, 3);
        const amazonProducts: AmazonProduct[] = [];
        
        for (const result of topResults) {
          if (result.link) {
            const url = new URL(result.link);
            url.searchParams.set('tag', 'chanelmunezer-20');
            
            amazonProducts.push({
              url: url.toString(),
              title: result.title || productName,
              thumbnail: result.thumbnail || undefined
            });
          }
        }
        
        if (amazonProducts.length > 0) {
          console.log(`🔗 Found ${amazonProducts.length} Amazon products for "${productName}"`);
          amazonProducts.forEach((product, index) => {
            console.log(`   ${index + 1}. ${product.title}`);
            console.log(`      URL: ${product.url}`);
            if (product.thumbnail) {
              console.log(`      Thumbnail: ${product.thumbnail}`);
            }
          });
          return amazonProducts;
        }
      }
    } catch (error) {
      console.warn(`Error fetching Amazon products for "${productName}":`, error);
    }

    return undefined;
  }

  private createEnhancedExtractionPrompt(text: string, episodeTitle: string): string {
    return `Extract named entities and relationships from this business podcast episode. 
Use a LOWER THRESHOLD (0.4+) to capture MORE entities, including products that could be Amazon-searchable.

EPISODE: "${episodeTitle}"

ENTITY TYPES TO EXTRACT (with lower confidence threshold):
1. PEOPLE: All mentioned individuals, even briefly referenced
2. PLACES: Companies, organizations, locations, institutions  
3. EVENTS: Any business events, launches, milestones
4. OBJECTS: Technologies, strategies, methodologies, concepts
5. MEDIA: Books, documentaries, movies, articles, ANY publications
6. PRODUCTS: All physical/digital products, tools, software, brands

AMAZON SEARCHABILITY CRITERIA (be very generous):
Mark as amazon_searchable=true for:
- Books, audiobooks, e-books, magazines, publications
- Physical products, gadgets, electronics, devices
- Tools, business supplies, equipment, office items
- Software with retail versions, apps, platforms
- Branded items, merchandise, clothing, accessories
- Health, fitness, lifestyle products, supplements
- Business tools, methodologies, frameworks (if they have book/course versions)
- Technologies that have physical products or books about them
- Any consumer goods, services with physical products
- Educational content, courses, training materials
- Even abstract concepts if they have related books or products

For amazon_searchable items, provide 2-3 specific keywords for better Amazon search.

Return ONLY valid JSON:
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "person|place|event|object|media|product", 
      "context": "Why this entity is significant",
      "amazon_searchable": true/false,
      "amazon_keywords": ["keyword1", "keyword2"] or null,
      "confidence_score": 0.4-1.0
    }
  ],
  "relationships": [
    {
      "entity1_name": "First Entity",
      "entity2_name": "Second Entity",
      "relationship_type": "relationship_type", 
      "description": "Description of relationship",
      "confidence_score": 0.4-1.0
    }
  ]
}

TRANSCRIPT (first 6000 characters):
${text.substring(0, 6000)}`;
  }

  private async makeOpenAIRequest(text: string, episodeTitle: string): Promise<any> {
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
            content: 'You are an expert at extracting named entities from business podcasts. Use lower thresholds to extract more entities, especially Amazon-searchable products. Return only valid JSON.'
          },
          {
            role: 'user',
            content: this.createEnhancedExtractionPrompt(text, episodeTitle)
          }
        ],
        temperature: 0.2,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid OpenAI response format');
    }
    return JSON.parse(data.choices[0].message.content);
  }

  private async makeAnthropicRequest(text: string, episodeTitle: string): Promise<any> {
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
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: `You are an expert at extracting named entities from business podcasts. Use lower thresholds to extract more entities, especially Amazon-searchable products. Return only valid JSON.\n\n${this.createEnhancedExtractionPrompt(text, episodeTitle)}`
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.content || !data.content[0]) {
      throw new Error('Invalid Anthropic response format');
    }
    const content = data.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content);
  }

  private async makeGeminiRequest(text: string, episodeTitle: string): Promise<any> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are an expert at extracting named entities from business podcasts. Use lower thresholds to extract more entities, especially Amazon-searchable products. Return only valid JSON.\n\n${this.createEnhancedExtractionPrompt(text, episodeTitle)}`
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid Gemini response format');
    }
    const content = data.candidates[0].content.parts[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content);
  }

  private async processExtractedEntities(
    extractedData: any,
    episodeId: string,
    episodeTitle: string
  ): Promise<{ entities: Entity[], relationships: Relationship[] }> {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    if (extractedData.entities) {
      for (const entityData of extractedData.entities) {
        const entityId = this.createEntityId(entityData.name, entityData.type, episodeId);
        
        let amazonProducts: AmazonProduct[] | undefined;
        
        // Fetch Amazon products for multiple entity types or amazon_searchable entities
        const searchableTypes = ['media', 'product', 'object'];
        const shouldFetchAmazon = entityData.amazon_searchable || 
                                 searchableTypes.includes(entityData.type) ||
                                 (entityData.context && entityData.context.toLowerCase().includes('book'));
        
        if (shouldFetchAmazon) {
          console.log(`Fetching Amazon products for: ${entityData.name} (type: ${entityData.type})`);
          amazonProducts = await this.fetchAmazonProducts(entityData.name, entityData.amazon_keywords);
          
          // Rate limiting for SerpAPI
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const entity: Entity = {
          id: entityId,
          episode_id: episodeId,
          name: entityData.name,
          type: entityData.type,
          context: entityData.context || '',
          amazon_searchable: entityData.amazon_searchable || false,
          amazon_keywords: entityData.amazon_keywords || undefined,
          amazon_products: amazonProducts,
          confidence_score: entityData.confidence_score || 0.6
        };

        entities.push(entity);
      }
    }

    if (extractedData.relationships) {
      for (const relData of extractedData.relationships) {
        const entity1Id = entities.find(e => e.name.toLowerCase() === relData.entity1_name.toLowerCase())?.id;
        const entity2Id = entities.find(e => e.name.toLowerCase() === relData.entity2_name.toLowerCase())?.id;
        
        if (entity1Id && entity2Id) {
          const relationship: Relationship = {
            id: `rel_${this.generateUUID().substring(0, 8)}`,
            episode_id: episodeId,
            entity1_id: entity1Id,
            entity1_name: relData.entity1_name,
            entity2_id: entity2Id,
            entity2_name: relData.entity2_name,
            relationship_type: relData.relationship_type,
            description: relData.description,
            confidence_score: relData.confidence_score || 0.6
          };
          
          relationships.push(relationship);
        }
      }
    }

    return { entities, relationships };
  }

  async extractFromEpisode(episode: Episode, modelName: string): Promise<EpisodeData> {
    const episodeId = `ep_test_${this.generateUUID().substring(0, 8)}`;
    
    console.log(`\nExtracting entities from "${episode.title}" using ${modelName}...`);
    
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

    const { entities, relationships } = await this.processExtractedEntities(
      extractedData,
      episodeId,
      episode.title
    );

    return {
      episode_id: episodeId,
      episode_title: episode.title,
      entities,
      relationships,
      extracted_by: modelName,
      extracted_at: new Date().toISOString()
    };
  }
}

async function main() {
  try {
    // Load podcast data
    const inputFile = path.join(process.cwd(), 'data', 'nodejs-podcast-summary.json');
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const podcastData: PodcastData = JSON.parse(rawData);

    console.log(`Found ${podcastData.episodes.length} episodes`);

    const extractor = new EnhancedEntityExtractor();
    const models = ['openai', 'anthropic', 'gemini'];
    const testLimit = 1; // Test with 1 episode per model

    const allResults: { [key: string]: EpisodeData } = {};

    for (const model of models) {
      console.log(`\n=== Testing ${model.toUpperCase()} ===`);
      
      const episode = podcastData.episodes[0]; // Use first episode for testing
      
      if (!episode.text || episode.text.length < 100) {
        console.log(`Skipping - insufficient text`);
        continue;
      }

      try {
        const result = await extractor.extractFromEpisode(episode, model);
        allResults[model] = result;
        
        console.log(`✓ Extracted ${result.entities.length} entities, ${result.relationships.length} relationships`);
        
        // Show first 3 entities with Amazon products
        const amazonEntities = result.entities.filter(e => e.amazon_products && e.amazon_products.length > 0);
        console.log(`📦 Found ${amazonEntities.length} entities with Amazon products:`);
        
        if (amazonEntities.length > 0) {
          console.log(`\nFirst 3 items with Amazon products:`);
          amazonEntities.slice(0, 3).forEach((entity, index) => {
            console.log(`   ${index + 1}. ${entity.name} (${entity.type})`);
            if (entity.amazon_products) {
              entity.amazon_products.forEach((product, productIndex) => {
                console.log(`      Product ${productIndex + 1}: ${product.title}`);
                console.log(`         URL: ${product.url}`);
                if (product.thumbnail) {
                  console.log(`         Thumbnail: ${product.thumbnail}`);
                }
              });
            }
          });
        } else {
          console.log(`   (No Amazon products found)`);
        }

        // Rate limiting between models
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`✗ Failed with ${model}:`, error);
      }
    }

    // Save test results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    
    for (const [model, data] of Object.entries(allResults)) {
      const outputFile = path.join(process.cwd(), 'data', `test-enhanced-entities-${model}-${timestamp}.json`);
      
      const output = {
        test_metadata: {
          model: model,
          timestamp: timestamp,
          total_entities: data.entities.length,
          total_relationships: data.relationships.length,
          amazon_searchable: data.entities.filter(e => e.amazon_searchable).length,
          amazon_products_found: data.entities.filter(e => e.amazon_products && e.amazon_products.length > 0).length
        },
        episode_data: data
      };
      
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`\n✓ Saved ${model} results to ${outputFile}`);
    }

    console.log('\n🎉 Enhanced entity extraction test completed!');
    console.log('\nSummary:');
    Object.entries(allResults).forEach(([model, data]) => {
      const amazonEntities = data.entities.filter(e => e.amazon_products && e.amazon_products.length > 0).length;
      const totalProducts = data.entities.reduce((sum, e) => sum + (e.amazon_products?.length || 0), 0);
      console.log(`${model}: ${data.entities.length} entities, ${amazonEntities} items with Amazon products (${totalProducts} total products)`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();