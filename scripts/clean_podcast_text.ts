#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

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

function cleanEpisodeText(text: string | undefined): string {
  if (!text || text.trim() === '') {
    return '';
  }
  
  // Find the first occurrence of '-----' and remove everything after it
  const delimiter = '-----';
  const delimiterIndex = text.indexOf(delimiter);
  
  if (delimiterIndex === -1) {
    // No delimiter found, return the original text
    return text.trim();
  }
  
  // Return everything before the delimiter, trimmed
  const cleanedText = text.substring(0, delimiterIndex).trim();
  return cleanedText;
}

function processPodcastData(inputFile: string, outputFile: string): void {
  console.log(`📖 Loading podcast data from ${inputFile}...`);
  
  let podcastData: PodcastData;
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    podcastData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`❌ Failed to load ${inputFile}: ${error}`);
  }
  
  console.log(`📊 Processing ${podcastData.episodes.length} episodes...`);
  
  let processedCount = 0;
  let cleanedCount = 0;
  let emptyCount = 0;
  let unchangedCount = 0;
  
  // Process each episode
  const cleanedEpisodes: Episode[] = podcastData.episodes.map((episode, index) => {
    const originalText = episode.text || '';
    const cleanedText = cleanEpisodeText(episode.text);
    
    processedCount++;
    
    if (!originalText.trim()) {
      emptyCount++;
    } else if (originalText !== cleanedText) {
      cleanedCount++;
      console.log(`🧹 [${index + 1}] Cleaned: ${episode.title}`);
      console.log(`   Original length: ${originalText.length} characters`);
      console.log(`   Cleaned length: ${cleanedText.length} characters`);
      console.log(`   Removed: ${originalText.length - cleanedText.length} characters`);
    } else {
      unchangedCount++;
    }
    
    // Return the episode with cleaned text
    return {
      ...episode,
      text: cleanedText
    };
  });
  
  // Create the output data structure
  const outputData: PodcastData = {
    ...podcastData,
    extracted_at: new Date().toISOString(),
    episodes: cleanedEpisodes
  };
  
  // Write the cleaned data to output file
  console.log(`\n💾 Writing cleaned data to ${outputFile}...`);
  try {
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`❌ Failed to write ${outputFile}: ${error}`);
  }
  
  // Display summary statistics
  console.log(`\n🎉 Processing completed!`);
  console.log(`📊 Summary Statistics:`);
  console.log(`   📝 Total episodes processed: ${processedCount}`);
  console.log(`   🧹 Episodes cleaned (ads removed): ${cleanedCount}`);
  console.log(`   ⚠️  Episodes with empty text: ${emptyCount}`);
  console.log(`   ✅ Episodes unchanged: ${unchangedCount}`);
  console.log(`   📁 Output saved to: ${outputFile}`);
  
  // Calculate file size difference
  try {
    const inputStats = fs.statSync(inputFile);
    const outputStats = fs.statSync(outputFile);
    const sizeDifference = inputStats.size - outputStats.size;
    const percentageReduction = ((sizeDifference / inputStats.size) * 100).toFixed(1);
    
    console.log(`\n📏 File Size Comparison:`);
    console.log(`   📥 Input file size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   📤 Output file size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   💾 Space saved: ${(sizeDifference / 1024 / 1024).toFixed(2)} MB (${percentageReduction}%)`);
  } catch (error) {
    console.log(`⚠️  Could not calculate file size difference: ${error}`);
  }
}

function main() {
  const inputFile = 'nodejs-podcast-text.json';
  const outputFile = 'nodejs-podcast-summary.json';
  
  try {
    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
      throw new Error(`❌ Input file not found: ${inputFile}`);
    }
    
    // Process the podcast data
    processPodcastData(inputFile, outputFile);
    
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`);
    } else {
      console.error('❌ An unknown error occurred:', error);
    }
    process.exit(1);
  }
}

// Example usage demonstration
function demonstrateTextCleaning() {
  console.log('🔍 Example of text cleaning:');
  console.log('');
  
  const exampleText = `Episode Summary
This is the main content about the founder and their story.
Key insights and lessons learned from their journey.

-----
Ramp gives you everything you need to control spend...
Join my free email newsletter...
Founders Notes gives you access...`;
  
  const cleanedExample = cleanEpisodeText(exampleText);
  
  console.log('📝 Original text:');
  console.log(exampleText);
  console.log('');
  console.log('🧹 Cleaned text:');
  console.log(cleanedExample);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

// Run the script
demonstrateTextCleaning();
main();