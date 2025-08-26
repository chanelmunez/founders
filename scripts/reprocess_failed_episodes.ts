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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); // Increased timeout
    
    console.log('  -> Waiting for content to load...');
    await page.waitForSelector('.sc-episode-details-body', { timeout: 20000 }); // Increased timeout
    
    console.log('  -> Extracting text content...');
    const text = await page.$eval('.sc-episode-details-body', (element: any) => {
      return element.textContent || '';
    });
    
    return cleanText(text);
    
  } catch (error) {
    console.log(`  -> Primary selector failed, trying alternatives...`);
    
    // Try alternative selectors if the main one fails
    const altSelectors = [
      '.episode-details-body',
      '.episode-content',
      '.sc-episode-body',
      '[class*="episode"][class*="body"]',
      'main [class*="content"]',
      'article',
      'main',
      '.content'
    ];
    
    for (const selector of altSelectors) {
      try {
        console.log(`  -> Trying alternative selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 });
        const text = await page.$eval(selector, (element: any) => {
          return element.textContent || '';
        });
        if (text.trim() && text.trim().length > 100) {
          console.log(`  -> Found content with ${selector}`);
          return cleanText(text);
        }
      } catch (altError) {
        // Continue to next selector
      }
    }
    
    // Last resort - get all text from body
    try {
      console.log('  -> Trying to extract all body text as fallback...');
      const bodyText = await page.$eval('body', (element: any) => {
        return element.textContent || '';
      });
      if (bodyText && bodyText.trim().length > 500) {
        console.log('  -> Using body text as fallback');
        return cleanText(bodyText);
      }
    } catch (bodyError) {
      // Final fallback failed
    }
    
    throw new Error(`All selectors failed: ${error}`);
  }
}

async function reprocessFailedEpisodes() {
  const inputFile = 'nodejs-podcast-text.json';
  const backupFile = 'nodejs-podcast-text-backup.json';
  
  console.log(`Loading podcast data from ${inputFile}...`);
  
  let podcastData: PodcastData;
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    podcastData = JSON.parse(fileContent);
    
    // Create backup
    fs.writeFileSync(backupFile, fileContent);
    console.log(`Backup created: ${backupFile}`);
    
  } catch (error) {
    throw new Error(`Failed to load ${inputFile}: ${error}`);
  }
  
  // Find episodes with empty text
  const emptyTextEpisodes = podcastData.episodes.filter(ep => !ep.text || ep.text.trim() === '');
  
  if (emptyTextEpisodes.length === 0) {
    console.log('No episodes with empty text found!');
    return;
  }
  
  console.log(`Found ${emptyTextEpisodes.length} episodes with empty text to reprocess:`);
  emptyTextEpisodes.forEach((ep, i) => {
    console.log(`${i+1}. ${ep.title}`);
    console.log(`   URL: ${ep.url}`);
  });
  
  console.log('\nStarting browser...');
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-dev-shm-usage', '--disable-extensions']
  });
  
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  
  let processed = 0;
  let fixed = 0;
  let stillFailed = 0;
  
  try {
    for (let i = 0; i < emptyTextEpisodes.length; i++) {
      const episode = emptyTextEpisodes[i];
      const episodeIndex = podcastData.episodes.findIndex(ep => 
        ep.url === episode.url && ep.title === episode.title
      );
      
      if (!episode.url) {
        console.log(`[${i+1}/${emptyTextEpisodes.length}] Skipping episode without URL: ${episode.title}`);
        continue;
      }
      
      console.log(`\n[${i+1}/${emptyTextEpisodes.length}] Reprocessing: ${episode.title}`);
      
      try {
        const episodeText = await fetchEpisodeText(page, episode.url);
        
        if (episodeText && episodeText.trim()) {
          // Update the episode in the main data
          if (episodeIndex !== -1) {
            podcastData.episodes[episodeIndex].text = episodeText;
          }
          
          fixed++;
          console.log(`  -> ✅ Successfully extracted ${episodeText.length} characters`);
        } else {
          stillFailed++;
          console.log(`  -> ❌ Still no content extracted`);
        }
        
        processed++;
        
        // Add delay between requests
        console.log('  -> Waiting 4 seconds before next request...');
        await new Promise(resolve => setTimeout(resolve, 4000));
        
      } catch (error) {
        stillFailed++;
        console.error(`  -> ❌ Failed to reprocess: ${error}`);
        
        // Add delay even on error
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
  
  // Update the extracted_at timestamp
  podcastData.extracted_at = new Date().toISOString();
  
  // Write the updated data back to file
  fs.writeFileSync(inputFile, JSON.stringify(podcastData, null, 2), 'utf-8');
  
  console.log(`\n🎉 Reprocessing completed!`);
  console.log(`📊 Episodes processed: ${processed}`);
  console.log(`✅ Successfully fixed: ${fixed}`);
  console.log(`❌ Still failed: ${stillFailed}`);
  console.log(`📁 Updated file: ${inputFile}`);
  console.log(`💾 Backup available: ${backupFile}`);
}

reprocessFailedEpisodes().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});