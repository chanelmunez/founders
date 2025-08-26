#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Simple UUID function to avoid dependency
function generateUUID(): string {
  return crypto.randomBytes(16).toString('hex');
}

// Load environment variables from .env.local
let envConfig: any = {};
try {
  const envFile = fs.readFileSync('.env.local', 'utf-8');
  console.log('📄 .env.local content:', envFile.substring(0, 200) + '...');
  
  envFile.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      // Handle both key=value and key: value formats
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
        envConfig[key] = value;
        process.env[key] = value;
        if (key === 'gemini') {
          console.log('🔑 Found Gemini key:', value.substring(0, 10) + '...');
        }
      }
    }
  });
  
  console.log('🔧 Loaded env keys:', Object.keys(envConfig));
} catch (error) {
  console.warn('❌ No .env.local file found:', error);
}

interface Episode {
  title: string;
  text: string;
  episode_number?: number;
  date?: string;
  url?: string;
  episode_id: string;
}

interface Entity {
  id: string;
  episode_id: string;
  name: string;
  type: string;
  context: string;
  amazon_searchable: boolean;
  amazon_keywords?: string[];
  confidence_score: number;
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
  confidence_score: number;
  is_cross_episode: boolean;
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

class GeminiReprocessor {
  private geminiApiKey: string;
  private episodesToReprocess: number[];

  constructor(episodesToReprocess: number[]) {
    this.geminiApiKey = process.env.gemini || envConfig.gemini || '';
    this.episodesToReprocess = episodesToReprocess;
    
    console.log('🔑 Gemini API key found:', this.geminiApiKey ? 'Yes' : 'No');
    
    if (!this.geminiApiKey) {
      throw new Error('❌ Gemini API key not found in .env.local');
    }
  }

  private createEntityId(name: string, type: string, episodeId: string): string {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${type}_${normalized}_${episodeId.substring(0, 8)}`;
  }

  private async makeGeminiRequest(text: string, episodeTitle: string): Promise<any> {
    const prompt = this.createEnhancedExtractionPrompt(text, episodeTitle);
    
    // Using gemini-1.5-pro instead of 2.5-pro
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiApiKey}`, {
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
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096
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

Episode Title: "${episodeTitle}"

Focus on identifying:
1. PEOPLE: Entrepreneurs, founders, CEOs, historical figures
2. COMPANIES: Businesses, corporations, startups  
3. PRODUCTS: Books, software, physical products, brands
4. MEDIA: Books, documentaries, articles, other podcasts
5. PLACES: Cities, countries, offices, headquarters
6. CONCEPTS: Business strategies, methodologies, frameworks

For PRODUCTS and MEDIA entities:
- Set amazon_searchable to true if they can be purchased on Amazon
- Include amazon_keywords array with 2-3 relevant search terms
- Books should ALWAYS be amazon_searchable with keywords

Relationships should connect entities meaningfully:
- founded, acquired, invested_in, wrote_book, featured_in, partnered_with, competed_with, inspired_by

Return JSON in this exact format:
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "PERSON|COMPANY|PRODUCT|MEDIA|PLACE|CONCEPT", 
      "context": "Brief context about this entity from the episode",
      "amazon_searchable": true/false,
      "amazon_keywords": ["keyword1", "keyword2", "keyword3"],
      "confidence": 0.8
    }
  ],
  "relationships": [
    {
      "entity1": "Entity Name 1",
      "entity2": "Entity Name 2", 
      "relationship_type": "founded|acquired|wrote_book|etc",
      "description": "Brief description of the relationship",
      "confidence": 0.9
    }
  ]
}

Episode Content:
${text.substring(0, 8000)}...`;
  }

  private processExtractedEntities(extractedData: any, episodeId: string, episodeTitle: string): { entities: Entity[], relationships: Relationship[] } {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Process entities
    if (extractedData.entities && Array.isArray(extractedData.entities)) {
      extractedData.entities.forEach((entity: any) => {
        if (entity.name && entity.type) {
          const entityId = this.createEntityId(entity.name, entity.type.toLowerCase(), episodeId);
          
          entities.push({
            id: entityId,
            episode_id: episodeId,
            name: entity.name,
            type: entity.type.toLowerCase(),
            context: entity.context || '',
            amazon_searchable: entity.amazon_searchable || false,
            amazon_keywords: entity.amazon_keywords || [],
            confidence_score: entity.confidence || 0.8
          });
        }
      });
    }

    // Process relationships
    if (extractedData.relationships && Array.isArray(extractedData.relationships)) {
      extractedData.relationships.forEach((rel: any) => {
        if (rel.entity1 && rel.entity2 && rel.relationship_type) {
          const entity1Id = this.createEntityId(rel.entity1, 'entity', episodeId);
          const entity2Id = this.createEntityId(rel.entity2, 'entity', episodeId);
          
          relationships.push({
            id: generateUUID(),
            episode_id: episodeId,
            entity1_id: entity1Id,
            entity1_name: rel.entity1,
            entity2_id: entity2Id,
            entity2_name: rel.entity2,
            relationship_type: rel.relationship_type,
            description: rel.description || '',
            confidence_score: rel.confidence || 0.8,
            is_cross_episode: false
          });
        }
      });
    }

    return { entities, relationships };
  }

  async reprocessEpisodes(): Promise<void> {
    // Load original text data
    const textData = JSON.parse(fs.readFileSync('data/nodejs-podcast-summary-cleaned.json', 'utf-8'));
    
    // Load existing Gemini data
    const existingGeminiData = JSON.parse(fs.readFileSync('data/nodejs-podcast-gemini.json', 'utf-8'));
    
    console.log(`🔄 Reprocessing ${this.episodesToReprocess.length} episodes with Gemini 1.5-pro...`);
    
    for (const episodeNumber of this.episodesToReprocess) {
      console.log(`\n🎯 Processing Episode #${episodeNumber}`);
      
      // Find the episode in text data
      const textEpisode = textData.episodes.find((ep: any) => ep.episode_number === episodeNumber);
      if (!textEpisode) {
        console.log(`❌ Episode #${episodeNumber} not found in text data`);
        continue;
      }
      
      // Find existing episode in Gemini data
      const existingEpisodeIndex = existingGeminiData.episodes.findIndex((ep: any) => ep.episode_number === episodeNumber);
      if (existingEpisodeIndex === -1) {
        console.log(`❌ Episode #${episodeNumber} not found in existing Gemini data`);
        continue;
      }
      
      try {
        console.log(`   📝 Title: ${textEpisode.title}`);
        console.log(`   📊 Current entities: ${existingGeminiData.episodes[existingEpisodeIndex].entities.length}`);
        
        // Extract with Gemini 1.5-pro
        const extractedData = await this.makeGeminiRequest(textEpisode.text, textEpisode.title);
        
        const episodeId = `ep_${episodeNumber}_${Date.now().toString(36)}`;
        const { entities, relationships } = this.processExtractedEntities(
          extractedData, 
          episodeId, 
          textEpisode.title
        );
        
        // Update the episode in the existing data
        existingGeminiData.episodes[existingEpisodeIndex] = {
          episode_id: episodeId,
          episode_title: textEpisode.title,
          episode_number: episodeNumber,
          date: textEpisode.date,
          url: textEpisode.url,
          entities: entities,
          relationships: relationships,
          extracted_by: 'gemini-1.5-pro',
          extracted_at: new Date().toISOString()
        };
        
        console.log(`   ✅ Reprocessed: ${entities.length} entities, ${relationships.length} relationships`);
        
        // Add delay to respect rate limits
        console.log('   ⏳ Waiting 3 seconds before next episode...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error) {
        console.error(`   ❌ Failed to reprocess episode #${episodeNumber}:`, error);
      }
    }
    
    // Update metadata
    existingGeminiData.metadata = {
      ...existingGeminiData.metadata,
      last_reprocessed_at: new Date().toISOString(),
      reprocessed_episodes: this.episodesToReprocess,
      reprocessed_with: 'gemini-1.5-pro'
    };
    
    // Save updated data
    const backupFile = `data/nodejs-podcast-gemini-backup-${Date.now()}.json`;
    fs.writeFileSync(backupFile, JSON.stringify(existingGeminiData, null, 2));
    console.log(`\n💾 Backup saved: ${backupFile}`);
    
    fs.writeFileSync('data/nodejs-podcast-gemini.json', JSON.stringify(existingGeminiData, null, 2));
    console.log(`✅ Updated Gemini data saved to: data/nodejs-podcast-gemini.json`);
    
    // Calculate final statistics
    const totalEntities = existingGeminiData.episodes.reduce((sum: number, ep: any) => sum + ep.entities.length, 0);
    const episodesWithFewEntities = existingGeminiData.episodes.filter((ep: any) => ep.entities.length < 3).length;
    
    console.log(`\n📊 Final Statistics:`);
    console.log(`   Episodes reprocessed: ${this.episodesToReprocess.length}`);
    console.log(`   Total entities: ${totalEntities}`);
    console.log(`   Episodes with < 3 entities: ${episodesWithFewEntities}`);
  }
}

// Main execution
async function main() {
  const episodesToReprocess = [357, 318, 270, 269, 210, 207, 193, 74];
  
  console.log('🔄 Gemini 1.5-pro Reprocessing Tool');
  console.log('=================================');
  
  const reprocessor = new GeminiReprocessor(episodesToReprocess);
  await reprocessor.reprocessEpisodes();
}

// Main execution
main().catch(console.error);