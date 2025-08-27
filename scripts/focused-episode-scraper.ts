import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface EpisodeResult {
  episode_number: number;
  title: string;
  url: string;
  content_length: number;
  formatted_text: string;
  scraping_notes: string;
}

async function scrapeSpecificEpisodes() {
  console.log('🎯 Focused Episode Scraper - Testing 3 Episodes');
  
  // Target specific episode URLs that we know exist
  const targetEpisodes = [
    {
      number: 389,
      title: "The Founder of Jimmy Choo: Tamara Mellon",
      url: "https://www.founderspodcast.com/episodes/389-the-founder-of-jimmy-choo-tamara-mellon"
    },
    {
      number: 388, 
      title: "Jeff Bezos's Shareholder Letters: All of Them!",
      url: "https://www.founderspodcast.com/episodes/388-jeff-bezoss-shareholder-letters-all-of-them"
    },
    {
      number: 387,
      title: "The Man Who Solved the Market: Jim Simons and Renaissance Technologies",
      url: "https://www.founderspodcast.com/episodes/387-the-man-who-solved-the-market-jim-simons-and-renaissance-technologies"
    }
  ];
  
  const browser = await chromium.launch({ 
    headless: true,
    timeout: 60000
  });
  
  const results: EpisodeResult[] = [];
  
  for (const episode of targetEpisodes) {
    console.log(`\n📖 Scraping Episode #${episode.number}: ${episode.title}`);
    
    const page = await browser.newPage();
    
    try {
      // Load the episode page
      await page.goto(episode.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 45000 
      });
      
      // Wait for dynamic content to load
      await page.waitForTimeout(3000);
      
      // Extract the main content
      const content = await page.evaluate(() => {
        // Try different content selectors in priority order
        const contentSelectors = [
          '.episode-content',
          '.post-content', 
          '.entry-content',
          '[class*="episode"][class*="content"]',
          '[class*="post"][class*="content"]',
          '.content',
          'main article',
          'main',
          '.container .content',
          '[role="main"]'
        ];
        
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent && element.textContent.length > 1000) {
            return {
              selector: selector,
              rawText: element.textContent,
              innerHTML: element.innerHTML,
              length: element.textContent.length
            };
          }
        }
        
        // Fallback: try to find the largest text block
        const allElements = Array.from(document.querySelectorAll('*'));
        let largestElement = null;
        let maxLength = 0;
        
        for (const el of allElements) {
          if (el.textContent && el.textContent.length > maxLength && 
              el.textContent.length > 1000) {
            maxLength = el.textContent.length;
            largestElement = el;
          }
        }
        
        if (largestElement) {
          return {
            selector: 'largest-text-block',
            rawText: largestElement.textContent || '',
            innerHTML: largestElement.innerHTML || '',
            length: largestElement.textContent?.length || 0
          };
        }
        
        return {
          selector: 'body-fallback',
          rawText: document.body.textContent || '',
          innerHTML: document.body.innerHTML || '',
          length: document.body.textContent?.length || 0
        };
      });
      
      // Clean and format the text to preserve paragraph structure
      const formattedText = cleanAndFormatEpisodeText(content.rawText);
      
      const result: EpisodeResult = {
        episode_number: episode.number,
        title: episode.title,
        url: episode.url,
        content_length: formattedText.length,
        formatted_text: formattedText,
        scraping_notes: `Extracted using selector: ${content.selector}, Original length: ${content.length} chars`
      };
      
      results.push(result);
      
      console.log(`✅ Episode #${episode.number}: ${formattedText.length} characters extracted`);
      console.log(`   Method: ${content.selector}`);
      console.log(`   Preview: ${formattedText.substring(0, 150)}...`);
      
    } catch (error) {
      console.error(`❌ Error scraping episode #${episode.number}:`, error);
      
      // Add a failed result
      results.push({
        episode_number: episode.number,
        title: episode.title,
        url: episode.url,
        content_length: 0,
        formatted_text: '',
        scraping_notes: `Failed to scrape: ${error}`
      });
      
    } finally {
      await page.close();
    }
    
    // Rate limiting between requests
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  await browser.close();
  
  // Save results
  const outputData = {
    scraped_at: new Date().toISOString(),
    episodes_attempted: targetEpisodes.length,
    episodes_successful: results.filter(r => r.content_length > 0).length,
    episodes: results
  };
  
  const outputFile = path.join(process.cwd(), 'episode-scraping-test-results.json');
  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
  
  console.log(`\n💾 Results saved to: episode-scraping-test-results.json`);
  console.log(`\n📊 Summary:`);
  console.log(`   Episodes attempted: ${targetEpisodes.length}`);
  console.log(`   Episodes successful: ${outputData.episodes_successful}`);
  console.log(`   Total characters: ${results.reduce((sum, ep) => sum + ep.content_length, 0)}`);
  
  // Show sample from the best result
  const bestResult = results.find(r => r.content_length > 1000);
  if (bestResult) {
    console.log(`\n📋 Best Episode Sample (#${bestResult.episode_number}):`);
    console.log(`Title: ${bestResult.title}`);
    console.log(`Length: ${bestResult.content_length} characters`);
    console.log(`\nFormatted Content Preview:`);
    console.log('=' .repeat(60));
    console.log(bestResult.formatted_text.substring(0, 800));
    console.log('=' .repeat(60));
    console.log('...(truncated)');
    
    // Show paragraph structure
    const paragraphs = bestResult.formatted_text.split('<br>').filter(p => p.trim());
    console.log(`\n📝 Paragraph Structure: ${paragraphs.length} paragraphs`);
    console.log(`   First paragraph: ${paragraphs[0]?.substring(0, 100)}...`);
    console.log(`   Second paragraph: ${paragraphs[1]?.substring(0, 100)}...`);
  }
}

function cleanAndFormatEpisodeText(rawText: string): string {
  if (!rawText) return '';
  
  let cleaned = rawText;
  
  // Remove common web artifacts
  cleaned = cleaned.replace(/\s*Skip to content\s*/gi, '');
  cleaned = cleaned.replace(/\s*Subscribe\s*/gi, '');
  cleaned = cleaned.replace(/\s*Share\s*/gi, '');
  cleaned = cleaned.replace(/\s*Follow\s*/gi, '');
  
  // Remove navigation and header/footer content
  cleaned = cleaned.replace(/Home\s+Episodes\s+About\s+Contact/gi, '');
  cleaned = cleaned.replace(/\s*Copyright.*$/gim, '');
  cleaned = cleaned.replace(/\s*All rights reserved.*$/gim, '');
  
  // Remove podcast-specific artifacts
  cleaned = cleaned.replace(/Join my free email newsletter.*$/gim, '');
  cleaned = cleaned.replace(/Founders Notes gives you.*$/gim, '');
  cleaned = cleaned.replace(/Get access to Founders Notes here.*$/gim, '');
  cleaned = cleaned.replace(/All the books featured on Founders Podcast.*$/gim, '');
  cleaned = cleaned.replace(/"I have listened to every episode.*$/gim, '');
  
  // Clean up excessive whitespace while preserving paragraph structure
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces to single
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n'); // Remove spaces after newlines
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n'); // Remove spaces before newlines
  
  // Create proper paragraph breaks with <br> tags for HTML display
  // Look for sentence endings followed by capital letters (likely new paragraphs)
  cleaned = cleaned.replace(/([.!?])\s+([A-Z][^.!?]*[a-z])/g, '$1<br>$2');
  
  // Handle explicit paragraph markers - convert newlines to <br> tags
  cleaned = cleaned.replace(/\n{2,}/g, '<br>'); // Multiple newlines to single <br>
  cleaned = cleaned.replace(/\n/g, '<br>'); // Single newlines to <br>
  
  // Fix common punctuation spacing
  cleaned = cleaned.replace(/([.!?])([A-Z])/g, '$1 $2'); // Space after punctuation
  cleaned = cleaned.replace(/\s*—\s*/g, ' — '); // Em dashes
  cleaned = cleaned.replace(/\s*–\s*/g, ' – '); // En dashes
  cleaned = cleaned.replace(/\s*\.\.\.\s*/g, '... '); // Ellipsis
  
  // Remove any remaining artifacts at start/end
  cleaned = cleaned.replace(/^\s*[-=_*]{3,}.*$/gm, ''); // Remove separator lines
  cleaned = cleaned.replace(/^\s*\d+:\d+.*$/gm, ''); // Remove timestamps at line start
  
  // Final cleanup
  cleaned = cleaned.trim();
  
  // Ensure we have reasonable paragraph structure with <br> tags
  if (cleaned && !cleaned.includes('<br>')) {
    // If no paragraph breaks exist, try to create them at sentence boundaries
    // for every 3-4 sentences
    const sentences = cleaned.split(/[.!?]+\s+/);
    if (sentences.length > 6) {
      const paragraphs = [];
      for (let i = 0; i < sentences.length; i += 3) {
        const paragraph = sentences.slice(i, i + 3).join('. ').trim();
        if (paragraph) paragraphs.push(paragraph);
      }
      cleaned = paragraphs.join('<br>');
    }
  }
  
  return cleaned;
}

scrapeSpecificEpisodes().catch(console.error);