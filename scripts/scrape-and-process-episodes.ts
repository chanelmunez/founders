import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import * as he from 'he';
import { v4 as uuidv4 } from 'uuid';

interface Episode {
  title: string;
  url: string;
  description: string;
  time_info: string;
  date: string;
  duration: string;
  type: string;
  episode_number?: number;
  has_play_button: boolean;
  play_button_label: string;
  text: string;
  episode_id: string;
}

interface PodcastSummary {
  podcast_name: string;
  source_url: string;
  extracted_at: string;
  total_episodes: number;
  episodes: Episode[];
}

class ComprehensiveEpisodeScraper {
  private browser: Browser | null = null;
  private testMode: boolean = false;
  private episodeLimit: number = 0;

  constructor(testMode: boolean = false, episodeLimit: number = 0) {
    this.testMode = testMode;
    this.episodeLimit = episodeLimit;
  }

  async initialize(): Promise<void> {
    console.log('🚀 Initializing browser...');
    this.browser = await chromium.launch({
      headless: true,
      timeout: 60000
    });
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      console.log('✅ Browser closed');
    }
  }

  /**
   * Generate consistent episode ID
   */
  private generateEpisodeId(episode: Partial<Episode>): string {
    if (episode.episode_number) {
      const shortUuid = uuidv4().substring(0, 8);
      return `ep_${episode.episode_number}_${shortUuid}`;
    } else {
      let timestamp: number;
      try {
        timestamp = new Date(episode.date || Date.now()).getTime();
      } catch {
        timestamp = Date.now();
      }
      
      const shortUuid = uuidv4().substring(0, 8);
      return `ep_${timestamp}_${shortUuid}`;
    }
  }

  /**
   * Extract episode number from title
   */
  private extractEpisodeNumber(title: string): number | undefined {
    const match = title.match(/#(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  /**
   * Parse time info to extract date, duration, and type
   */
  private parseTimeInfo(timeInfo: string): { date: string; duration: string; type: string } {
    const parts = timeInfo.split(' | ');
    let date = '';
    let duration = '';
    let type = '';

    if (parts.length >= 2) {
      const datePart = parts[0];
      duration = parts[1] || '';
      type = parts[2] || '';

      // Parse date
      try {
        const dateMatch = datePart.match(/(\w+)\s+(\d+)\w*,?\s+(\d{4})/);
        if (dateMatch) {
          const [, month, day, year] = dateMatch;
          const monthMap: { [key: string]: number } = {
            'January': 0, 'February': 1, 'March': 2, 'April': 3,
            'May': 4, 'June': 5, 'July': 6, 'August': 7,
            'September': 8, 'October': 9, 'November': 10, 'December': 11,
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3,
            'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
          };
          
          const monthNum = monthMap[month];
          if (monthNum !== undefined) {
            const dateObj = new Date(parseInt(year), monthNum, parseInt(day));
            date = dateObj.toISOString();
          }
        }
      } catch (error) {
        console.warn(`Failed to parse date from: ${datePart}`);
      }
    }

    return { date, duration, type };
  }

  /**
   * Clean and format text content with proper line breaks
   */
  private cleanText(text: string): string {
    if (!text) return '';

    // Decode HTML entities
    let cleaned = he.decode(text);
    
    // Remove script and style content
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
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
    
    // Convert newlines to <br> tags for HTML display
    cleaned = cleaned.replace(/\n{2,}/g, '<br>'); // Double newlines to <br>
    cleaned = cleaned.replace(/\n/g, '<br>'); // Single newlines to <br>
    
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

  /**
   * Scrape episodes list from the main page
   */
  async scrapeEpisodesList(): Promise<Episode[]> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();
    const episodes: Episode[] = [];

    try {
      console.log('📋 Fetching episodes list...');
      await page.goto('https://www.founderspodcast.com/episodes', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      await page.waitForSelector('.episode-item', { timeout: 10000 });

      const episodeElements = await page.$$('.episode-item');
      const totalEpisodes = this.testMode 
        ? Math.min(this.episodeLimit, episodeElements.length)
        : episodeElements.length;

      console.log(`📊 Found ${episodeElements.length} episodes (processing ${totalEpisodes})`);

      for (let i = 0; i < totalEpisodes; i++) {
        const element = episodeElements[i];
        
        try {
          const title = await element.$eval('.episode-title', el => el.textContent?.trim() || '');
          const url = await element.$eval('a', el => el.getAttribute('href') || '');
          const description = await element.$eval('.episode-description', el => el.textContent?.trim() || '');
          const timeInfo = await element.$eval('.episode-time', el => el.textContent?.trim() || '');
          
          const hasPlayButton = await element.$('.play-button') !== null;
          const playButtonLabel = hasPlayButton 
            ? await element.$eval('.play-button', el => el.textContent?.trim() || 'Play')
            : '';

          const fullUrl = url.startsWith('http') ? url : `https://www.founderspodcast.com${url}`;
          const episodeNumber = this.extractEpisodeNumber(title);
          const { date, duration, type } = this.parseTimeInfo(timeInfo);

          // Generate episode ID
          const episodeData: Partial<Episode> = {
            title,
            episode_number: episodeNumber,
            date: date || new Date().toISOString()
          };
          const episodeId = this.generateEpisodeId(episodeData);

          const episode: Episode = {
            title,
            url: fullUrl,
            description: this.cleanText(description),
            time_info: timeInfo,
            date: date || new Date().toISOString(),
            duration,
            type,
            episode_number: episodeNumber,
            has_play_button: hasPlayButton,
            play_button_label: playButtonLabel,
            text: '', // Will be filled by scrapeEpisodeText
            episode_id: episodeId
          };

          episodes.push(episode);
          
          if (this.testMode) {
            console.log(`📝 Episode ${i + 1}: ${title} (${episodeId})`);
          }

        } catch (error) {
          console.error(`❌ Error processing episode ${i + 1}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error scraping episodes list:', error);
      throw error;
    } finally {
      await page.close();
    }

    return episodes;
  }

  /**
   * Scrape individual episode text content
   */
  async scrapeEpisodeText(episode: Episode): Promise<string> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      console.log(`📖 Scraping episode: ${episode.title}`);
      
      await page.goto(episode.url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Wait for content to load
      await page.waitForTimeout(2000);

      // Try different selectors for episode content
      const contentSelectors = [
        '.episode-content',
        '.post-content', 
        '.entry-content',
        '.episode-description',
        '.content',
        'main'
      ];

      let episodeText = '';

      for (const selector of contentSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            // Get the inner HTML to preserve structure for cleaning
            const rawHTML = await element.innerHTML();
            episodeText = this.cleanText(rawHTML);
            
            if (episodeText.length > 100) {
              console.log(`✅ Found content using selector: ${selector} (${episodeText.length} characters)`);
              break;
            }
          }
        } catch (error) {
          // Continue to next selector
          continue;
        }
      }

      // Fallback: get all text content from body
      if (!episodeText || episodeText.length < 100) {
        try {
          const bodyHTML = await page.$eval('body', el => el.innerHTML);
          episodeText = this.cleanText(bodyHTML);
          console.log(`⚠️ Used body fallback for ${episode.title} (${episodeText.length} characters)`);
        } catch (error) {
          console.error(`❌ Failed to extract text for ${episode.title}`);
          episodeText = episode.description; // Use description as fallback
        }
      }

      return episodeText;

    } catch (error) {
      console.error(`❌ Error scraping episode ${episode.title}:`, error);
      return episode.description; // Return description as fallback
    } finally {
      await page.close();
    }
  }

  /**
   * Process all episodes with text content
   */
  async processAllEpisodes(): Promise<PodcastSummary> {
    const episodes = await this.scrapeEpisodesList();
    
    console.log(`\n🔄 Processing episode text content...`);
    
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      
      try {
        const text = await this.scrapeEpisodeText(episode);
        episode.text = text;
        
        console.log(`✅ ${i + 1}/${episodes.length}: ${episode.title} (${text.length} chars)`);
        
        // Rate limiting
        if (i < episodes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`❌ Failed to process episode ${episode.title}:`, error);
        episode.text = episode.description; // Fallback to description
      }
    }

    const podcastSummary: PodcastSummary = {
      podcast_name: 'Founders Podcast',
      source_url: 'https://www.founderspodcast.com/episodes',
      extracted_at: new Date().toISOString(),
      total_episodes: episodes.length,
      episodes
    };

    return podcastSummary;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isTestMode = args.includes('--test') || args.includes('-t');
  const episodeLimitArg = args.find(arg => arg.startsWith('--limit='));
  const episodeLimit = episodeLimitArg ? parseInt(episodeLimitArg.split('=')[1]) : 3;

  console.log('🎯 Comprehensive Episode Scraper and Processor');
  console.log('=============================================');
  
  if (isTestMode) {
    console.log(`🧪 TEST MODE: Processing ${episodeLimit} episodes only`);
  }

  const scraper = new ComprehensiveEpisodeScraper(isTestMode, episodeLimit);

  try {
    await scraper.initialize();
    
    const podcastData = await scraper.processAllEpisodes();
    
    const outputFile = isTestMode 
      ? 'nodejs-podcast-summary-test.json'
      : 'nodejs-podcast-summary.json';
    
    const outputPath = path.join(process.cwd(), outputFile);
    
    console.log(`\n💾 Saving results to ${outputFile}...`);
    fs.writeFileSync(outputPath, JSON.stringify(podcastData, null, 2));
    
    console.log('\n📊 Processing Summary:');
    console.log(`   Episodes processed: ${podcastData.episodes.length}`);
    console.log(`   Total characters: ${podcastData.episodes.reduce((sum, ep) => sum + ep.text.length, 0)}`);
    console.log(`   Episodes with content > 1000 chars: ${podcastData.episodes.filter(ep => ep.text.length > 1000).length}`);
    console.log(`   Episodes with episode numbers: ${podcastData.episodes.filter(ep => ep.episode_number).length}`);
    
    console.log(`\n✅ Successfully saved to: ${outputPath}`);

    // Show sample episode for review
    if (podcastData.episodes.length > 0) {
      const sampleEpisode = podcastData.episodes[0];
      console.log(`\n📋 Sample Episode Preview:`);
      console.log(`   Title: ${sampleEpisode.title}`);
      console.log(`   Episode ID: ${sampleEpisode.episode_id}`);
      console.log(`   Episode Number: ${sampleEpisode.episode_number}`);
      console.log(`   Content Length: ${sampleEpisode.text.length} characters`);
      console.log(`   Content Preview: ${sampleEpisode.text.substring(0, 200)}...`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await scraper.cleanup();
  }
}

main();