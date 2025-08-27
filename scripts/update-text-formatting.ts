import * as fs from 'fs';
import * as path from 'path';

interface Episode {
  episode_id: string;
  episode_title: string;
  episode_number?: number;
  date: string;
  url: string;
  text: string;
  [key: string]: any;
}

interface EpisodeData {
  episodes: Episode[];
  [key: string]: any;
}

function convertTextToBrFormat(text: string): string {
  if (!text) return '';
  
  // Always process to ensure consistent double <br><br> formatting
  
  let cleaned = text;
  
  // First convert all single <br> tags to double <br><br> for consistent spacing
  // Replace isolated single <br> tags (not already part of <br><br>)
  cleaned = cleaned.replace(/(?<!<br>)<br>(?!<br>)/g, '<br><br>');
  
  // Since the existing text has no newlines, we need to add paragraph breaks
  // by looking for logical break points in the content
  
  // Remove "Episode Summary" text and add breaks after section headers
  cleaned = cleaned.replace(/Episode Summary/g, '');
  cleaned = cleaned.replace(/Episode Notes/g, '<br><br>Episode Notes<br><br>');
  
  // Add single <br> before timestamp markers like [0:01], [15:30], etc.
  // Handle both formats: [mm:ss] and [h:mm:ss]
  // Match any non-whitespace character before timestamp, but not if already preceded by <br>
  cleaned = cleaned.replace(/(?<!<br>)(\S)\s*(\[\d+:\d+(?::\d+)?[\]\}])/g, '$1<br>$2');
  
  cleaned = cleaned.replace(/(\. )([A-Z][a-z]{3,})/g, '$1<br><br>$2'); // After sentences followed by capitalized words
  cleaned = cleaned.replace(/(\w\.)([A-Z]\w+)/g, '$1<br><br>$2'); // Add breaks after periods before capitalized words
  
  // Clean up excessive whitespace while preserving new structure
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n'); // Remove spaces after line breaks
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n'); // Remove spaces before line breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Multiple line breaks to double
  
  // Convert any remaining newlines to <br> tags for HTML display
  cleaned = cleaned.replace(/\n{2,}/g, '<br><br>'); // Double newlines to <br><br>
  cleaned = cleaned.replace(/\n/g, '<br><br>'); // Single newlines to <br><br>
  
  // Clean up multiple consecutive <br> tags - ensure consistent double spacing
  cleaned = cleaned.replace(/(<br>){3,}/g, '<br><br>');
  
  // Remove leading <br> tags
  cleaned = cleaned.replace(/^(<br>)+/, '');
  
  return cleaned.trim();
}

async function updateEpisodeTextFormatting() {
  console.log('🔄 Updating Episode Text Formatting to <br> Tags');
  console.log('=' .repeat(60));
  
  // Find existing episode data files
  const dataFiles = [
    'nodejs-podcast-summary.json',
    'data/nodejs-podcast-summary.json'
  ];
  
  let inputFile: string | null = null;
  let episodeData: EpisodeData | null = null;
  
  // Try to find the episode data file
  for (const filename of dataFiles) {
    const filePath = path.join(process.cwd(), filename);
    if (fs.existsSync(filePath)) {
      console.log(`📂 Found episode data: ${filename}`);
      try {
        const rawData = fs.readFileSync(filePath, 'utf-8');
        episodeData = JSON.parse(rawData);
        inputFile = filePath;
        break;
      } catch (error) {
        console.warn(`⚠️ Could not parse ${filename}:`, error);
      }
    }
  }
  
  if (!episodeData || !inputFile) {
    console.error('❌ No episode data file found. Please run the scraper first.');
    return;
  }
  
  console.log(`📊 Processing ${episodeData.episodes.length} episodes...`);
  
  let updatedCount = 0;
  let alreadyFormattedCount = 0;
  let emptyTextCount = 0;
  
  // Process each episode
  for (const episode of episodeData.episodes) {
    if (!episode.text || episode.text.length === 0) {
      emptyTextCount++;
      continue;
    }
    
    // Always process episodes to ensure "Episode Summary" text is removed
    
    const originalText = episode.text;
    const formattedText = convertTextToBrFormat(originalText);
    
    if (formattedText !== originalText) {
      episode.text = formattedText;
      updatedCount++;
      
      if (updatedCount <= 3) {
        console.log(`\n📝 Updated Episode ${episode.episode_number || 'Unknown'}: ${episode.episode_title}`);
        console.log(`   Original length: ${originalText.length} chars`);
        console.log(`   Updated length: ${formattedText.length} chars`);
        console.log(`   <br> tags added: ${(formattedText.match(/<br>/g) || []).length}`);
        console.log(`   Preview: ${formattedText.substring(0, 200)}...`);
      }
    }
  }
  
  // Save updated data
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const outputFile = inputFile.replace('.json', `-updated-${timestamp}.json`);
  
  // Update metadata
  if (episodeData.extracted_at) {
    episodeData.extracted_at = new Date().toISOString();
  }
  if (episodeData.processing_notes) {
    episodeData.processing_notes += ` | Updated text formatting to <br> tags on ${new Date().toISOString()}`;
  } else {
    (episodeData as any).processing_notes = `Updated text formatting to <br> tags on ${new Date().toISOString()}`;
  }
  
  fs.writeFileSync(outputFile, JSON.stringify(episodeData, null, 2));
  
  console.log(`\n💾 Updated episode data saved to: ${path.basename(outputFile)}`);
  console.log('\n📊 Summary:');
  console.log(`   Total episodes: ${episodeData.episodes.length}`);
  console.log(`   Updated with <br> formatting: ${updatedCount}`);
  console.log(`   Already formatted: ${alreadyFormattedCount}`);
  console.log(`   Empty text: ${emptyTextCount}`);
  
  // Show a sample of the formatting
  const sampleEpisode = episodeData.episodes.find(ep => ep.text.includes('<br>') && ep.text.length > 500);
  if (sampleEpisode) {
    console.log(`\n📋 Sample Formatted Episode: ${sampleEpisode.episode_title}`);
    console.log('=' .repeat(60));
    const preview = sampleEpisode.text.substring(0, 400);
    const previewWithNewlines = preview.replace(/<br>/g, '\n');
    console.log(previewWithNewlines);
    console.log('=' .repeat(60));
    console.log('(Preview shows how <br> tags will render as line breaks)');
  }
  
  // Replace the original file with the updated version
  if (updatedCount > 0) {
    console.log(`\n🔄 Replacing original file: ${path.basename(inputFile)}`);
    fs.writeFileSync(inputFile, JSON.stringify(episodeData, null, 2));
    console.log('✅ Original file updated successfully!');
  }
  
  console.log('\n🎉 Text formatting update completed!');
  console.log('   Episode text is now ready for HTML display with proper paragraph breaks.');
}

updateEpisodeTextFormatting().catch(console.error);