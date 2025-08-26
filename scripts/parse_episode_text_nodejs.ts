#!/usr/bin/env node

import * as fs from 'fs';
import he from 'he';
import { chromium } from 'playwright';

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

function cleanText(text: string | undefined): string {
  if (!text) return '';
  
  const unescaped = he.decode(text);
  const cleaned = unescaped.replace(/\s+/g, ' ');
  return cleaned.trim();
}

async function fetchEpisodeText(page: any, url: string): Promise<string> {
  try {
    console.log(`  -> Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    console.log('  -> Waiting for content to load...');
    // Wait for the episode details body to appear
    await page.waitForSelector('.sc-episode-details-body', { timeout: 15000 });
    
    console.log('  -> Extracting text content...');
    const text = await page.$eval('.sc-episode-details-body', (element: any) => {
      return element.textContent || '';
    });
    
    return cleanText(text);
    
  } catch (error) {
    console.log(`  -> Error: ${error}`);
    
    // Try alternative selectors if the main one fails
    const altSelectors = [
      '.episode-details-body',
      '.episode-content',
      '.sc-episode-body',
      '[class*="episode"][class*="body"]',
      'main [class*="content"]'
    ];
    
    for (const selector of altSelectors) {
      try {
        console.log(`  -> Trying alternative selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });
        const text = await page.$eval(selector, (element: any) => {
          return element.textContent || '';
        });
        if (text.trim()) {
          return cleanText(text);
        }
      } catch (altError) {
        // Continue to next selector
      }
    }
    
    throw error;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processEpisodes(inputFile: string, outputFile: string) {
  console.log(`Loading podcast data from ${inputFile}...`);
  
  let podcastData: PodcastData;
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    podcastData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to load ${inputFile}: ${error}`);
  }
  
  console.log(`Processing ${podcastData.episodes.length} episodes...`);
  console.log('Starting browser...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-dev-shm-usage', '--disable-extensions']
  });
  
  const page = await browser.newPage();
  
  // Set a reasonable viewport
  await page.setViewportSize({ width: 1280, height: 720 });
  
  const processedEpisodes: Episode[] = [];
  let processed = 0;
  let failed = 0;
  
  try {
    for (const episode of podcastData.episodes) {
      try {
        if (!episode.url) {
          console.log(`Skipping episode without URL: ${episode.title}`);
          processedEpisodes.push({ ...episode, text: '' });
          continue;
        }
        
        console.log(`[${processed + 1}/${podcastData.episodes.length}] Fetching: ${episode.title}`);
        
        const episodeText = await fetchEpisodeText(page, episode.url);
        
        processedEpisodes.push({
          ...episode,
          text: episodeText
        });
        
        processed++;
        console.log(`  -> Successfully extracted ${episodeText.length} characters`);
        
        // Add delay between requests to be respectful
        if (processed % 5 === 0) {
          console.log(`Processed ${processed} episodes, taking a brief pause...`);
          await delay(3000); // 3 second pause every 5 requests
        } else {
          await delay(1000); // 1 second delay between requests
        }
        
      } catch (error) {
        console.error(`Failed to fetch ${episode.url}: ${error}`);
        
        // Add episode with empty text if fetch fails
        processedEpisodes.push({
          ...episode,
          text: ''
        });
        
        failed++;
        
        // Continue with a delay even on error
        await delay(2000);
      }
    }
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
  
  // Create the output data structure
  const outputData: PodcastData = {
    ...podcastData,
    extracted_at: new Date().toISOString(),
    episodes: processedEpisodes
  };
  
  // Write the output file
  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
  
  console.log(`\nCompleted processing!`);
  console.log(`Successfully processed: ${processed - failed} episodes`);
  console.log(`Failed to fetch: ${failed} episodes`);
  console.log(`Total episodes: ${processedEpisodes.length}`);
  console.log(`Output saved to: ${outputFile}`);
}

async function main() {
  const inputFile = 'nodejs-podcast.json';
  const outputFile = 'nodejs-podcast-text.json';
  
  try {
    await processEpisodes(inputFile, outputFile);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        console.error(`Error: Could not find ${inputFile}`);
      } else {
        console.error(`Error: ${error.message}`);
      }
    } else {
      console.error('An unknown error occurred:', error);
    }
    process.exit(1);
  }
}

// Run if this file is executed directly
main();