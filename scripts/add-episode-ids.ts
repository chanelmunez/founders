import * as fs from 'fs';
import * as path from 'path';
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
  episode_id?: string; // This will be added
}

interface PodcastSummary {
  podcast_name: string;
  source_url: string;
  extracted_at: string;
  total_episodes: number;
  episodes: Episode[];
}

interface GraphEpisodeData {
  episode_id: string;
  episode_title: string;
  episode_number?: number;
  date?: string;
  url?: string;
}

interface GraphOutput {
  episodes: GraphEpisodeData[];
}

class EpisodeIdMapper {
  private existingIds: Map<string, string> = new Map(); // key -> episode_id mapping
  private episodeNumberToId: Map<number, string> = new Map();
  private titleToId: Map<string, string> = new Map();

  constructor() {}

  /**
   * Load existing episode IDs from graph extraction files
   */
  private loadExistingIds(): void {
    const graphFiles = [
      'nodejs-podcast-openai.json',
      'nodejs-podcast-anthropic.json', 
      'nodejs-podcast-groq.json'
    ];

    for (const filename of graphFiles) {
      const filePath = path.join(process.cwd(), filename);
      
      if (fs.existsSync(filePath)) {
        try {
          console.log(`Loading existing IDs from ${filename}...`);
          const rawData = fs.readFileSync(filePath, 'utf-8');
          const graphData: GraphOutput = JSON.parse(rawData);
          
          if (graphData.episodes) {
            for (const episode of graphData.episodes) {
              // Map by episode number (primary key)
              if (episode.episode_number) {
                this.episodeNumberToId.set(episode.episode_number, episode.episode_id);
                console.log(`Mapped episode #${episode.episode_number} -> ${episode.episode_id}`);
              }
              
              // Map by title (secondary key)
              const normalizedTitle = this.normalizeTitle(episode.episode_title);
              this.titleToId.set(normalizedTitle, episode.episode_id);
              
              // Map by URL (tertiary key)
              if (episode.url) {
                this.existingIds.set(episode.url, episode.episode_id);
              }
            }
          }
        } catch (error) {
          console.warn(`Warning: Could not load IDs from ${filename}:`, error);
        }
      }
    }
    
    console.log(`Loaded ${this.episodeNumberToId.size} episode number mappings`);
    console.log(`Loaded ${this.titleToId.size} title mappings`);
    console.log(`Loaded ${this.existingIds.size} URL mappings`);
  }

  /**
   * Normalize titles for comparison
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Generate a consistent episode ID using the same format as the graph extraction
   */
  private generateEpisodeId(episode: Episode): string {
    if (episode.episode_number) {
      // Use episode number for consistent ID generation
      const shortUuid = uuidv4().substring(0, 8);
      return `ep_${episode.episode_number}_${shortUuid}`;
    } else {
      // For episodes without numbers, use timestamp-based approach
      let timestamp: number;
      try {
        timestamp = new Date(episode.date).getTime();
      } catch {
        timestamp = Date.now();
      }
      
      const shortUuid = uuidv4().substring(0, 8);
      return `ep_${timestamp}_${shortUuid}`;
    }
  }

  /**
   * Find existing episode ID or generate a new one
   */
  private findOrCreateEpisodeId(episode: Episode): string {
    // Priority 1: Match by episode number
    if (episode.episode_number && this.episodeNumberToId.has(episode.episode_number)) {
      const existingId = this.episodeNumberToId.get(episode.episode_number)!;
      console.log(`✓ Found existing ID for episode #${episode.episode_number}: ${existingId}`);
      return existingId;
    }

    // Priority 2: Match by URL
    if (episode.url && this.existingIds.has(episode.url)) {
      const existingId = this.existingIds.get(episode.url)!;
      console.log(`✓ Found existing ID for URL: ${existingId}`);
      return existingId;
    }

    // Priority 3: Match by normalized title
    const normalizedTitle = this.normalizeTitle(episode.title);
    if (this.titleToId.has(normalizedTitle)) {
      const existingId = this.titleToId.get(normalizedTitle)!;
      console.log(`✓ Found existing ID for title "${episode.title}": ${existingId}`);
      return existingId;
    }

    // Priority 4: Generate new ID
    const newId = this.generateEpisodeId(episode);
    console.log(`+ Generated new ID for "${episode.title}": ${newId}`);
    
    // Cache the new ID for consistency
    if (episode.episode_number) {
      this.episodeNumberToId.set(episode.episode_number, newId);
    }
    this.titleToId.set(normalizedTitle, newId);
    if (episode.url) {
      this.existingIds.set(episode.url, newId);
    }
    
    return newId;
  }

  /**
   * Add unique episode IDs to all episodes in the podcast summary
   */
  public addEpisodeIds(podcastSummary: PodcastSummary): PodcastSummary {
    console.log('Loading existing episode IDs from graph files...');
    this.loadExistingIds();
    
    console.log('\nProcessing episodes...');
    const updatedEpisodes = podcastSummary.episodes.map((episode, index) => {
      const episodeId = this.findOrCreateEpisodeId(episode);
      
      return {
        ...episode,
        episode_id: episodeId
      };
    });

    return {
      ...podcastSummary,
      episodes: updatedEpisodes
    };
  }

  /**
   * Generate a mapping report
   */
  public generateMappingReport(originalData: PodcastSummary, updatedData: PodcastSummary): void {
    console.log('\n📊 Episode ID Mapping Report');
    console.log('===============================');
    console.log(`Total episodes: ${updatedData.episodes.length}`);
    
    let existingMapped = 0;
    let newGenerated = 0;
    let withNumbers = 0;
    let withoutNumbers = 0;
    
    for (const episode of updatedData.episodes) {
      const wasExisting = this.episodeNumberToId.has(episode.episode_number || -1) ||
                         this.titleToId.has(this.normalizeTitle(episode.title)) ||
                         (episode.url ? this.existingIds.has(episode.url) : false);
      
      if (wasExisting) {
        existingMapped++;
      } else {
        newGenerated++;
      }
      
      if (episode.episode_number) {
        withNumbers++;
      } else {
        withoutNumbers++;
      }
    }
    
    console.log(`Episodes with existing IDs: ${existingMapped}`);
    console.log(`Episodes with new IDs: ${newGenerated}`);
    console.log(`Episodes with numbers: ${withNumbers}`);
    console.log(`Episodes without numbers: ${withoutNumbers}`);
    
    // Show sample mappings
    console.log('\n📝 Sample Episode ID Mappings:');
    updatedData.episodes.slice(0, 5).forEach(episode => {
      const episodeInfo = episode.episode_number 
        ? `#${episode.episode_number}` 
        : 'No number';
      console.log(`${episode.episode_id} <- "${episode.title}" (${episodeInfo})`);
    });
  }
}

async function main() {
  try {
    const inputFile = path.join(process.cwd(), 'nodejs-podcast-summary.json');
    const outputFile = path.join(process.cwd(), 'nodejs-podcast-summary-with-ids.json');
    const backupFile = path.join(process.cwd(), 'nodejs-podcast-summary-backup.json');
    
    // Check if input file exists
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }

    console.log('📖 Reading podcast summary data...');
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const podcastSummary: PodcastSummary = JSON.parse(rawData);
    
    console.log(`Found ${podcastSummary.episodes.length} episodes to process`);

    // Create backup of original file
    console.log('💾 Creating backup of original file...');
    fs.writeFileSync(backupFile, rawData);
    console.log(`Backup saved to: ${backupFile}`);

    // Initialize mapper and add episode IDs
    const mapper = new EpisodeIdMapper();
    const updatedSummary = mapper.addEpisodeIds(podcastSummary);
    
    // Generate and display report
    mapper.generateMappingReport(podcastSummary, updatedSummary);
    
    // Save updated file
    console.log('\n💾 Saving updated podcast summary...');
    fs.writeFileSync(outputFile, JSON.stringify(updatedSummary, null, 2));
    console.log(`✅ Updated file saved to: ${outputFile}`);
    
    // Optionally update the original file
    console.log('\n🔄 Updating original file with episode IDs...');
    fs.writeFileSync(inputFile, JSON.stringify(updatedSummary, null, 2));
    console.log(`✅ Original file updated: ${inputFile}`);
    
    console.log('\n🎉 Episode ID mapping completed successfully!');
    console.log('\n📋 Files created/updated:');
    console.log(`   • ${backupFile} (backup)`);
    console.log(`   • ${outputFile} (new file with IDs)`);
    console.log(`   • ${inputFile} (original file updated)`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();