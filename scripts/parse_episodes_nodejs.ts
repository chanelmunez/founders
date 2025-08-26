#!/usr/bin/env node

import * as fs from 'fs';
import * as cheerio from 'cheerio';
import he from 'he';

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
}

interface PodcastData {
  podcast_name: string;
  source_url: string;
  extracted_at: string;
  total_episodes: number;
  episodes: Episode[];
}

function parseDuration(durationText: string): string {
  const trimmed = durationText.trim();
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else if (parts.length === 3) {
      const hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = parseInt(parts[2]);
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }
  return trimmed;
}

function cleanText(text: string | undefined): string {
  if (!text) return '';
  
  const unescaped = he.decode(text);
  const cleaned = unescaped.replace(/\s+/g, ' ');
  return cleaned.trim();
}

function extractEpisodeNumber(title: string, timeInfo: string): number | undefined {
  const cleanTitle = title.trim();
  
  if (cleanTitle.startsWith('#')) {
    const match = cleanTitle.match(/^#(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }
  }
  
  if (timeInfo.includes('E')) {
    const match = timeInfo.match(/E(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }
  }
  
  if (timeInfo.includes('Bonus')) {
    return undefined;
  }
  
  return undefined;
}

function parseDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  
  try {
    if (trimmed.includes(', 2025')) {
      const cleaned = trimmed.replace(/(\d+)(st|nd|rd|th)/, '$1');
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  } catch (error) {
    // If parsing fails, return original string
  }
  
  return trimmed;
}

function extractEpisodesData(htmlFilePath: string): PodcastData {
  const episodes: Episode[] = [];
  
  try {
    const content = fs.readFileSync(htmlFilePath, 'utf-8');
    const $ = cheerio.load(content);
    
    const episodeSections = $('section.sc-episode-teaser');
    
    episodeSections.each((index, section) => {
      const episodeData: Episode = {};
      
      const titleElement = $(section).find('h2.sc-episode-teaser-title');
      if (titleElement.length) {
        const titleLink = titleElement.find('a.sc-episode-teaser-title-a');
        if (titleLink.length) {
          episodeData.title = cleanText(titleLink.text());
          const href = titleLink.attr('href');
          if (href) {
            episodeData.url = href.startsWith('http') 
              ? href 
              : `https://www.founderspodcast.com${href}`;
          }
        }
      }
      
      const descriptionElement = $(section).find('p.sc-episode-teaser-description');
      if (descriptionElement.length) {
        episodeData.description = cleanText(descriptionElement.text());
      }
      
      const timeElement = $(section).find('p.sc-episode-teaser-time');
      if (timeElement.length) {
        const timeText = cleanText(timeElement.text());
        episodeData.time_info = timeText;
        
        const parts = timeText.split('|');
        if (parts.length >= 1) {
          episodeData.date = parseDate(parts[0].trim());
        }
        
        if (parts.length >= 2) {
          const durationPart = parts[1].trim();
          
          if (parts.length >= 3) {
            const durationMatch = durationPart.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
            if (durationMatch) {
              episodeData.duration = parseDuration(durationMatch[1]);
            }
            
            episodeData.type = parts[2]?.trim() || undefined;
          } else {
            const durationMatch = durationPart.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
            if (durationMatch) {
              episodeData.duration = parseDuration(durationMatch[1]);
            }
            
            if (durationPart.includes('E') || durationPart.includes('Bonus')) {
              const typeMatch = durationPart.match(/(E\d+|Bonus)/);
              if (typeMatch) {
                episodeData.type = typeMatch[1];
              }
            }
          }
        }
      }
      
      if (episodeData.title) {
        const episodeNumber = extractEpisodeNumber(
          episodeData.title, 
          episodeData.time_info || ''
        );
        if (episodeNumber !== undefined) {
          episodeData.episode_number = episodeNumber;
        }
      }
      
      const playButton = $(section).find('button.sc-episode-teaser-play');
      if (playButton.length) {
        episodeData.has_play_button = true;
        const ariaLabel = playButton.attr('aria-label');
        if (ariaLabel) {
          episodeData.play_button_label = ariaLabel;
        }
      }
      
      if (Object.keys(episodeData).length > 0) {
        episodes.push(episodeData);
      }
    });
    
  } catch (error) {
    console.error('Error reading or parsing HTML file:', error);
    throw error;
  }
  
  return {
    podcast_name: 'Founders Podcast',
    source_url: 'https://www.founderspodcast.com/episodes',
    extracted_at: new Date().toISOString(),
    total_episodes: episodes.length,
    episodes: episodes
  };
}

async function main() {
  const htmlFile = 'episode-list-sublime.html';
  const outputFile = 'nodejs-podcast.json';
  
  try {
    const podcastData = extractEpisodesData(htmlFile);
    
    fs.writeFileSync(outputFile, JSON.stringify(podcastData, null, 2), 'utf-8');
    
    console.log(`Successfully extracted ${podcastData.total_episodes} episodes`);
    console.log(`Data saved to ${outputFile}`);
    
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        console.error(`Error: Could not find ${htmlFile}`);
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