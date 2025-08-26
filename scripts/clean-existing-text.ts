import * as fs from 'fs';
import * as path from 'path';
import he from 'he';

interface Episode {
  title: string;
  text: string;
  episode_id: string;
  [key: string]: any;
}

interface PodcastData {
  episodes: Episode[];
  [key: string]: any;
}

function cleanText(text: string): string {
  if (!text) return '';

  // Decode HTML entities
  let cleaned = he.decode(text);
  
  // Remove script and style content
  cleaned = cleaned.replace(/<script[^>]*>.*?<\/script>/gis, '');
  cleaned = cleaned.replace(/<style[^>]*>.*?<\/style>/gis, '');
  
  // Convert block elements to line breaks with space preservation
  const blockElements = [
    'div', 'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'tr', 'td', 'th', 'section', 'article', 'header', 
    'footer', 'aside', 'nav', 'main', 'blockquote', 'ul', 'ol'
  ];
  
  // Add spaces before opening tags to separate content
  for (const element of blockElements) {
    const regex = new RegExp(`<${element}[^>]*>`, 'gi');
    cleaned = cleaned.replace(regex, ' \n');
  }
  
  // Convert closing tags to line breaks
  for (const element of blockElements) {
    const closeRegex = new RegExp(`</${element}>`, 'gi');
    cleaned = cleaned.replace(closeRegex, '\n ');
  }
  
  // Handle self-closing br tags specifically
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
  
  // Remove remaining HTML tags but preserve the spacing they created
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');
  
  // Clean up common podcast artifacts and separators
  cleaned = cleaned.replace(/----+/g, ''); // Remove dash separators (-----)
  cleaned = cleaned.replace(/_{3,}/g, ''); // Remove underscore separators
  cleaned = cleaned.replace(/={3,}/g, ''); // Remove equals separators
  cleaned = cleaned.replace(/\*{3,}/g, ''); // Remove asterisk separators
  
  // Remove common footer patterns
  cleaned = cleaned.replace(/Join my free email newsletter.*$/gim, '');
  cleaned = cleaned.replace(/Founders Notes gives you.*$/gim, '');
  cleaned = cleaned.replace(/Get access to Founders Notes here.*$/gim, '');
  cleaned = cleaned.replace(/All the books featured on Founders Podcast.*$/gim, '');
  cleaned = cleaned.replace(/Be like \w+\. Buy a book:.*$/gim, '');
  cleaned = cleaned.replace(/"I have listened to every episode.*$/gim, '');
  
  // Normalize whitespace while preserving intentional line breaks
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n'); // Remove spaces after line breaks
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n'); // Remove spaces before line breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Multiple line breaks to double
  
  // Ensure proper spacing between sentences and sections
  cleaned = cleaned.replace(/([.!?])([A-Z])/g, '$1 $2'); // Add space after sentence punctuation
  cleaned = cleaned.replace(/([a-z])([A-Z][a-z])/g, '$1 $2'); // Add space between camelCase-like text
  
  // Clean up common artifacts
  cleaned = cleaned.replace(/\s*—\s*/g, ' — '); // Em dashes
  cleaned = cleaned.replace(/\s*–\s*/g, ' – '); // En dashes
  cleaned = cleaned.replace(/\s*\.\.\.\s*/g, '... '); // Ellipsis
  
  // Remove any trailing separators or artifacts
  cleaned = cleaned.replace(/\n?-{3,}\s*$/g, ''); // Remove trailing dashes
  cleaned = cleaned.replace(/\n?\s*$/, ''); // Remove trailing whitespace
  
  return cleaned.trim();
}

function main() {
  const inputFile = 'nodejs-podcast-summary.json';
  const outputFile = 'nodejs-podcast-summary-cleaned.json';
  const testFile = 'nodejs-podcast-summary-test-cleaned.json';
  
  console.log('🧹 Cleaning existing text data...');
  
  // Clean main file
  if (fs.existsSync(inputFile)) {
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const podcastData: PodcastData = JSON.parse(rawData);
    
    console.log(`Processing ${podcastData.episodes.length} episodes...`);
    
    let cleanedCount = 0;
    for (const episode of podcastData.episodes) {
      const originalLength = episode.text?.length || 0;
      episode.text = cleanText(episode.text || '');
      const cleanedLength = episode.text.length;
      
      if (originalLength !== cleanedLength) {
        cleanedCount++;
      }
    }
    
    fs.writeFileSync(outputFile, JSON.stringify(podcastData, null, 2));
    console.log(`✅ Cleaned ${cleanedCount} episodes and saved to: ${outputFile}`);
  }
  
  // Clean test file
  if (fs.existsSync('nodejs-podcast-summary-test.json')) {
    const rawData = fs.readFileSync('nodejs-podcast-summary-test.json', 'utf-8');
    const podcastData: PodcastData = JSON.parse(rawData);
    
    console.log(`Cleaning test file with ${podcastData.episodes.length} episodes...`);
    
    for (const episode of podcastData.episodes) {
      episode.text = cleanText(episode.text || '');
    }
    
    fs.writeFileSync(testFile, JSON.stringify(podcastData, null, 2));
    console.log(`✅ Cleaned test data and saved to: ${testFile}`);
    
    // Show sample of cleaned text
    if (podcastData.episodes.length > 0) {
      const sample = podcastData.episodes[0];
      console.log(`\n📋 Sample cleaned text from "${sample.title}":`);
      console.log(`Length: ${sample.text.length} characters`);
      console.log(`Preview: ${sample.text.substring(0, 300)}...`);
    }
  }
}

main();