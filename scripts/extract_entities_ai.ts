#!/usr/bin/env node

import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

interface Episode {
  title?: string;
  url?: string;
  description?: string;
  date?: string;
  duration?: string;
  type?: string;
  episode_number?: number;
  time_info?: string;
  has_play_button?: boolean;
  play_button_label?: string;
  text?: string;
}

interface PodcastData {
  podcast_name: string;
  source_url: string;
  extracted_at: string;
  total_episodes: number;
  episodes: Episode[];
}

interface AIEntity {
  id: string;
  name: string;
  type: 'PERSON' | 'PLACE' | 'EVENT' | 'OBJECT' | 'MEDIA' | 'PRODUCT' | 'COMPANY' | 'CONCEPT';
  episode_id: string;
  confidence: number;
  context: string;
  amazon_searchable: boolean;
  category?: string;
  description?: string;
  aliases?: string[];
}

interface AIRelationship {
  id: string;
  source_entity: string;
  target_entity: string;
  relationship_type: string;
  confidence: number;
  context: string;
  episode_id: string;
}

interface AIEpisodeData {
  episode_id: string;
  episode_number?: number;
  title: string;
  entities: AIEntity[];
  relationships: AIRelationship[];
  processing_timestamp: string;
  model_used: string;
  token_usage?: number;
}

class AIEntityExtractor {
  private openaiApiKey: string;
  private anthropicApiKey: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  generateEpisodeId(episode: Episode): string {
    return `ep_${episode.episode_number || 'bonus'}_${uuidv4().substring(0, 8)}`;
  }

  generateEntityId(): string {
    return `ent_ai_${uuidv4()}`;
  }

  generateRelationshipId(): string {
    return `rel_ai_${uuidv4()}`;
  }

  // Create the prompt for AI entity extraction
  createExtractionPrompt(text: string, episodeTitle: string): string {
    return `You are an expert entity extraction system. Analyze the following podcast episode transcript and extract structured information.

EPISODE TITLE: "${episodeTitle}"

EPISODE TRANSCRIPT:
${text.substring(0, 12000)} ${text.length > 12000 ? '...[TRUNCATED]' : ''}

INSTRUCTIONS:
Extract entities in the following categories with HIGH ACCURACY:

1. PERSON - Names of individuals (founders, entrepreneurs, historical figures, etc.)
2. COMPANY - Business entities, organizations, corporations
3. PRODUCT - Specific products, especially those available on Amazon (books, electronics, etc.)
4. MEDIA - Books, movies, documentaries, podcasts, articles
5. PLACE - Geographic locations, cities, countries, buildings
6. EVENT - Historical events, business milestones, significant occurrences
7. CONCEPT - Business concepts, strategies, principles, methodologies

For PRODUCTS and MEDIA, prioritize items that could be found on Amazon for affiliate marketing.

Also extract RELATIONSHIPS between entities (who founded what, who worked with whom, what happened where, etc.).

Return your response as a JSON object with this EXACT structure:

{
  "entities": [
    {
      "name": "Entity Name",
      "type": "PERSON|COMPANY|PRODUCT|MEDIA|PLACE|EVENT|CONCEPT",
      "confidence": 0.0-1.0,
      "context": "Brief context from text",
      "amazon_searchable": true/false,
      "category": "Books|Electronics|Business|etc",
      "description": "Brief description",
      "aliases": ["Alternative names"]
    }
  ],
  "relationships": [
    {
      "source_entity": "Entity Name 1",
      "target_entity": "Entity Name 2", 
      "relationship_type": "FOUNDED_BY|AUTHORED_BY|WORKED_WITH|BASED_IN|RELATED_TO|etc",
      "confidence": 0.0-1.0,
      "context": "Context from text showing this relationship"
    }
  ]
}

Focus on:
- High-confidence entities only (confidence > 0.7)
- Amazon-searchable products and media (books especially)
- Clear, unambiguous relationships
- Proper categorization for affiliate linking

Return ONLY the JSON object, no other text.`;
  }

  // Call OpenAI API
  async callOpenAI(prompt: string): Promise<any> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not found in .env.local');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-1106-preview',
        messages: [
          {
            role: 'system',
            content: 'You are an expert entity extraction system that returns only valid JSON responses.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }

  // Call Anthropic API
  async callAnthropic(prompt: string): Promise<any> {
    if (!this.anthropicApiKey) {
      throw new Error('Anthropic API key not found in .env.local');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicApiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    return {
      content: data.content[0].text,
      usage: data.usage
    };
  }

  // Process extraction result
  processAIResponse(response: any, episodeId: string, modelName: string): AIEpisodeData {
    try {
      let jsonContent = response.content;
      
      // Clean up the response to ensure it's valid JSON
      jsonContent = jsonContent.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const parsed = JSON.parse(jsonContent);
      
      const entities: AIEntity[] = (parsed.entities || []).map((entity: any) => ({
        id: this.generateEntityId(),
        name: entity.name,
        type: entity.type,
        episode_id: episodeId,
        confidence: entity.confidence || 0.8,
        context: entity.context || '',
        amazon_searchable: entity.amazon_searchable || false,
        category: entity.category,
        description: entity.description,
        aliases: entity.aliases || []
      }));

      const relationships: AIRelationship[] = (parsed.relationships || []).map((rel: any) => ({
        id: this.generateRelationshipId(),
        source_entity: rel.source_entity,
        target_entity: rel.target_entity,
        relationship_type: rel.relationship_type,
        confidence: rel.confidence || 0.8,
        context: rel.context || '',
        episode_id: episodeId
      }));

      return {
        episode_id: episodeId,
        title: '',
        entities,
        relationships,
        processing_timestamp: new Date().toISOString(),
        model_used: modelName,
        token_usage: response.usage?.total_tokens
      };

    } catch (error) {
      console.error(`❌ Failed to parse AI response for ${modelName}:`, error);
      console.error('Raw response:', response.content?.substring(0, 500));
      
      return {
        episode_id: episodeId,
        title: '',
        entities: [],
        relationships: [],
        processing_timestamp: new Date().toISOString(),
        model_used: modelName,
        token_usage: 0
      };
    }
  }

  // Process single episode with AI
  async processEpisodeWithAI(episode: Episode, episodeId: string, modelName: 'openai' | 'anthropic'): Promise<AIEpisodeData> {
    const text = episode.text || '';
    if (!text || text.length < 100) {
      console.log(`⚠️  Insufficient text content for episode: ${episode.title}`);
      return {
        episode_id: episodeId,
        episode_number: episode.episode_number,
        title: episode.title || 'Untitled',
        entities: [],
        relationships: [],
        processing_timestamp: new Date().toISOString(),
        model_used: modelName,
        token_usage: 0
      };
    }

    const prompt = this.createExtractionPrompt(text, episode.title || 'Untitled');
    
    try {
      console.log(`🤖 [${modelName.toUpperCase()}] Processing: ${episode.title}`);
      
      let response;
      if (modelName === 'openai') {
        response = await this.callOpenAI(prompt);
      } else {
        response = await this.callAnthropic(prompt);
      }

      const result = this.processAIResponse(response, episodeId, modelName);
      result.episode_number = episode.episode_number;
      result.title = episode.title || 'Untitled';

      console.log(`   📋 Extracted ${result.entities.length} entities, ${result.relationships.length} relationships`);
      console.log(`   💰 Tokens used: ${result.token_usage || 'N/A'}`);

      return result;

    } catch (error) {
      console.error(`❌ AI processing error for ${episode.title} with ${modelName}:`, error);
      
      return {
        episode_id: episodeId,
        episode_number: episode.episode_number,
        title: episode.title || 'Untitled',
        entities: [],
        relationships: [],
        processing_timestamp: new Date().toISOString(),
        model_used: modelName,
        token_usage: 0
      };
    }
  }
}

// Main processing function
async function processAllEpisodesWithAI() {
  const inputFile = 'nodejs-podcast-summary.json';
  
  console.log(`📖 Loading podcast data from ${inputFile}...`);
  
  let podcastData: PodcastData;
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    podcastData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`❌ Failed to load ${inputFile}: ${error}`);
  }

  const extractor = new AIEntityExtractor();
  
  // Check which AI models are available
  const availableModels: Array<'openai' | 'anthropic'> = [];
  if (process.env.OPENAI_API_KEY) availableModels.push('openai');
  if (process.env.ANTHROPIC_API_KEY) availableModels.push('anthropic');
  
  if (availableModels.length === 0) {
    throw new Error('❌ No AI API keys found in .env.local. Please add OPENAI_API_KEY or ANTHROPIC_API_KEY');
  }

  console.log(`🤖 Available AI models: ${availableModels.join(', ').toUpperCase()}`);
  
  // Process a subset of episodes for testing (first 5 episodes)
  const testEpisodes = podcastData.episodes.slice(0, 5);
  console.log(`📊 Processing ${testEpisodes.length} episodes for testing...`);

  // Process with each available model
  for (const modelName of availableModels) {
    console.log(`\n🚀 Starting ${modelName.toUpperCase()} processing...`);
    
    const modelResults: AIEpisodeData[] = [];
    let totalTokens = 0;
    let processedCount = 0;
    
    for (const episode of testEpisodes) {
      try {
        const episodeId = extractor.generateEpisodeId(episode);
        const result = await extractor.processEpisodeWithAI(episode, episodeId, modelName);
        
        modelResults.push(result);
        totalTokens += result.token_usage || 0;
        processedCount++;
        
        // Add delay between API calls to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Error processing episode with ${modelName}:`, error);
      }
    }
    
    // Save results for this model
    const outputData = {
      metadata: {
        source_file: inputFile,
        model_used: modelName,
        total_episodes: processedCount,
        total_entities: modelResults.reduce((sum, ep) => sum + ep.entities.length, 0),
        total_relationships: modelResults.reduce((sum, ep) => sum + ep.relationships.length, 0),
        amazon_searchable_entities: modelResults.reduce((sum, ep) => 
          sum + ep.entities.filter(e => e.amazon_searchable).length, 0
        ),
        total_tokens_used: totalTokens,
        extraction_timestamp: new Date().toISOString(),
        extraction_method: `AI-powered with ${modelName}`
      },
      episodes: modelResults
    };

    const outputFile = `nodejs-podcast-${modelName}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    
    console.log(`✅ ${modelName.toUpperCase()} results saved to: ${outputFile}`);
    console.log(`📊 ${modelName.toUpperCase()} Statistics:`);
    console.log(`   📝 Episodes processed: ${processedCount}`);
    console.log(`   🏷️  Entities extracted: ${outputData.metadata.total_entities}`);
    console.log(`   🔗 Relationships found: ${outputData.metadata.total_relationships}`);
    console.log(`   🛒 Amazon searchable: ${outputData.metadata.amazon_searchable_entities}`);
    console.log(`   💰 Total tokens used: ${totalTokens}`);
  }
}

// Main function
async function main() {
  try {
    await processAllEpisodesWithAI();
    
    console.log(`\n🎉 AI-powered entity extraction completed!`);
    console.log(`💡 To process all 407 episodes, increase the testEpisodes slice in the code`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();