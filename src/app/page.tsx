'use client'

import { useEffect, useRef, useState } from 'react'
import episodesData from '../data-episodes-claude.json'
import relationshipsData from '../data-relationships-claude.json'
import episodesTextData from '../data-episodes-text.json'

interface AmazonProduct {
  url: string
  title: string
  thumbnail?: string
}

interface Entity {
  id: string
  name: string
  type: string
  context: string
  episode_id: string
  confidence_score: number
  amazon_searchable?: boolean
  amazon_keywords?: string[]
  amazon_products?: AmazonProduct[]
}

interface Relationship {
  id: string
  episode_id: string
  entity1_id?: string
  entity1_name: string
  entity2_id?: string
  entity2_name: string
  relationship_type: string
  description: string
  confidence_score: number
}

interface Episode {
  episode_id: string
  episode_title: string
  episode_number?: number
  date: string
  url: string
  entities: Entity[]
}

interface SearchResult {
  id: string
  type: 'episode' | 'entity' | 'relationship'
  title: string
  description: string
  url?: string
  episode_id?: string
  relevanceScore: number
}

interface ModalData {
  id: string
  type: 'episode' | 'entity' | 'relationship'
  isOpen: boolean
}

interface AmazonSearchResult {
  title: string
  thumbnail?: string
  link_clean?: string
}

// Static Amazon Products Component (no real-time search needed)
function AmazonProductsComponent({ entity }: { entity: Entity }) {
  // Don't render if entity has no Amazon products
  if (!entity.amazon_products || entity.amazon_products.length === 0) {
    return null
  }

  return (
    <div className="modal-section">
      <h3 className="modal-section-title">Available on Amazon</h3>
      <div className="amazon-products-grid">
        {entity.amazon_products.map((product, index) => (
          <div key={index} className="amazon-product">
            <a 
              href={product.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="amazon-product-link"
            >
              {product.thumbnail && (
                <img 
                  src={product.thumbnail} 
                  alt={product.title}
                  className="amazon-thumbnail"
                />
              )}
              <div className="amazon-title">{product.title}</div>
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [modalData, setModalData] = useState<ModalData>({ id: '', type: 'episode', isOpen: false })
  const [amazonSearchResults, setAmazonSearchResults] = useState<{ [entityId: string]: AmazonSearchResult }>({})
  const [randomEpisodes, setRandomEpisodes] = useState<Episode[]>([])

  useEffect(() => {
    // Focus the search input when the page loads
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
    
    // Set random episodes on client side to avoid hydration mismatch
    const shuffled = [...episodesData.episodes].sort(() => 0.5 - Math.random())
    setRandomEpisodes(shuffled.slice(0, 3))
  }, [])

  // Auto-search with debounce
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        setIsSearching(true)
        const results = performSearch(searchQuery)
        setSearchResults(results)
      }, 500) // 0.5 second delay
    } else {
      setIsSearching(false)
      setSearchResults([])
    }

    // Cleanup timeout on component unmount
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && modalData.isOpen) {
        closeModal()
      }
    }

    if (modalData.isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modalData.isOpen])

  const performSearch = (query: string): SearchResult[] => {
    if (!query.trim()) return []

    const results: SearchResult[] = []
    const searchTerm = query.toLowerCase().trim()

    // Search Episodes
    episodesData.episodes.forEach((episode: Episode) => {
      let relevanceScore = 0
      let matchFound = false

      // Check title
      if (episode.episode_title.toLowerCase().includes(searchTerm)) {
        relevanceScore += 10
        matchFound = true
      }

      // Check entities context
      episode.entities?.forEach((entity: Entity) => {
        if (entity.name.toLowerCase().includes(searchTerm)) {
          relevanceScore += 8
          matchFound = true
        }
        if (entity.context.toLowerCase().includes(searchTerm)) {
          relevanceScore += 3
          matchFound = true
        }
      })

      if (matchFound) {
        results.push({
          id: episode.episode_id,
          type: 'episode',
          title: episode.episode_title,
          description: extractDescription(episode),
          url: episode.url,
          episode_id: episode.episode_id,
          relevanceScore
        })
      }
    })

    // Search All Entities
    episodesData.all_entities?.forEach((entity: Entity) => {
      let relevanceScore = 0
      let matchFound = false

      if (entity.name.toLowerCase().includes(searchTerm)) {
        relevanceScore += 10
        matchFound = true
      }
      if (entity.context.toLowerCase().includes(searchTerm)) {
        relevanceScore += 5
        matchFound = true
      }

      if (matchFound) {
        results.push({
          id: entity.id,
          type: 'entity',
          title: entity.name,
          description: entity.context.length > 200 ? entity.context.substring(0, 200) + '...' : entity.context,
          episode_id: entity.episode_id,
          relevanceScore
        })
      }
    })

    // Search Relationships
    relationshipsData.relationships.forEach((rel: Relationship) => {
      let relevanceScore = 0
      let matchFound = false

      if (rel.relationship_type.toLowerCase().includes(searchTerm)) {
        relevanceScore += 8
        matchFound = true
      }
      if (rel.entity1_name.toLowerCase().includes(searchTerm)) {
        relevanceScore += 6
        matchFound = true
      }
      if (rel.entity2_name.toLowerCase().includes(searchTerm)) {
        relevanceScore += 6
        matchFound = true
      }
      if (rel.description.toLowerCase().includes(searchTerm)) {
        relevanceScore += 3
        matchFound = true
      }

      if (matchFound) {
        results.push({
          id: rel.id,
          type: 'relationship',
          title: `${rel.entity1_name} ${rel.relationship_type} ${rel.entity2_name}`,
          description: rel.description,
          episode_id: rel.episode_id,
          relevanceScore
        })
      }
    })

    // Sort by relevance score (highest first)
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchQuery(value)
  }

  // Modal functions
  const openModal = (id: string, type: 'episode' | 'entity' | 'relationship') => {
    setModalData({ id, type, isOpen: true })
    document.body.style.overflow = 'hidden' // Prevent background scrolling
  }

  const closeModal = () => {
    setModalData({ id: '', type: 'episode', isOpen: false })
    document.body.style.overflow = 'unset' // Restore scrolling
  }

  // Helper functions to get related items
  const getRelatedItemsForEntity = (entityId: string) => {
    const relatedEpisodes: Episode[] = []
    const relatedEntities: Entity[] = []
    const relatedRelationships: Relationship[] = []

    // Find relationships involving this entity
    const entityRelationships = relationshipsData.relationships.filter((rel: Relationship) => 
      rel.entity1_id === entityId || rel.entity2_id === entityId
    )

    entityRelationships.forEach((rel: Relationship) => {
      // Add the relationship itself
      relatedRelationships.push(rel)
      
      // Find the other entity in the relationship
      const otherEntityId = rel.entity1_id === entityId ? rel.entity2_id : rel.entity1_id
      const otherEntity = episodesData.all_entities?.find((entity: Entity) => entity.id === otherEntityId)
      if (otherEntity && !relatedEntities.find(e => e.id === otherEntity.id)) {
        relatedEntities.push(otherEntity)
      }
    })

    // Find episodes that contain this entity
    episodesData.episodes.forEach((episode: Episode) => {
      if (episode.entities.some((entity: Entity) => entity.id === entityId)) {
        relatedEpisodes.push(episode)
      }
    })

    return {
      episodes: relatedEpisodes.slice(0, 5),
      entities: relatedEntities.slice(0, 5),
      relationships: relatedRelationships.slice(0, 5)
    }
  }

  const getRelatedItemsForRelationship = (relationshipId: string) => {
    const relationship = relationshipsData.relationships.find((rel: Relationship) => rel.id === relationshipId)
    if (!relationship) return { episodes: [], entities: [], relationships: [] }

    const relatedEpisodes: Episode[] = []
    const relatedEntities: Entity[] = []
    const relatedRelationships: Relationship[] = []

    // Find the entities involved in this relationship
    const entity1 = episodesData.all_entities?.find((entity: Entity) => entity.id === relationship.entity1_id)
    const entity2 = episodesData.all_entities?.find((entity: Entity) => entity.id === relationship.entity2_id)
    
    if (entity1) relatedEntities.push(entity1)
    if (entity2) relatedEntities.push(entity2)

    // Find episode containing this relationship
    const episode = episodesData.episodes.find((ep: Episode) => ep.episode_id === relationship.episode_id)
    if (episode) relatedEpisodes.push(episode)

    // Find other relationships involving the same entities
    const otherRelationships = relationshipsData.relationships.filter((rel: Relationship) => 
      rel.id !== relationshipId && 
      (rel.entity1_id === relationship.entity1_id || 
       rel.entity1_id === relationship.entity2_id ||
       rel.entity2_id === relationship.entity1_id || 
       rel.entity2_id === relationship.entity2_id)
    )
    relatedRelationships.push(...otherRelationships)

    return {
      episodes: relatedEpisodes.slice(0, 5),
      entities: relatedEntities.slice(0, 5),
      relationships: relatedRelationships.slice(0, 5)
    }
  }


  const extractDescription = (episode: Episode): string => {
    // Get description from the first entity's context or use a fallback
    const firstEntity = episode.entities?.[0]
    if (firstEntity?.context) {
      // Take first sentence or first 150 characters
      const sentences = firstEntity.context.split('. ')
      return sentences[0].length > 150 
        ? firstEntity.context.substring(0, 150) + '...'
        : sentences[0] + (sentences.length > 1 ? '.' : '')
    }
    return 'Explore the entrepreneurial journey and business insights from this episode.'
  }

  // Format text for better display (replace _ with space and capitalize words)
  const formatDisplayText = (text: string): string => {
    return text
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  // Get full episode text
  const getEpisodeFullText = (episodeId: string): string => {
    const episodeText = episodesTextData.episodes.find((ep: any) => {
      // Match by episode number since the text data structure might be different
      const episode = episodesData.episodes.find((e: Episode) => e.episode_id === episodeId)
      return episode && ep.episode_number === episode.episode_number
    })
    
    const text = episodeText?.text || 'Full episode text not available.'
    
    // If text already contains <br> tags (from new scraper), return as-is
    // Otherwise, convert newlines to <br> tags for legacy data
    if (text.includes('<br>')) {
      return text
    }
    return text.replace(/\n/g, '<br>')
  }

  // Get modal content data
  const getModalContent = () => {
    if (!modalData.isOpen) return null

    switch (modalData.type) {
      case 'episode':
        return episodesData.episodes.find((ep: Episode) => ep.episode_id === modalData.id)
      case 'entity':
        return episodesData.all_entities?.find((entity: Entity) => entity.id === modalData.id)
      case 'relationship':
        return relationshipsData.relationships.find((rel: Relationship) => rel.id === modalData.id)
      default:
        return null
    }
  }

  // Render modal content
  const renderModalContent = () => {
    const content = getModalContent()
    if (!content) return null

    if (modalData.type === 'episode') {
      const episode = content as Episode
      const relatedItems = {
        entities: episode.entities || [],
        relationships: relationshipsData.relationships.filter((rel: Relationship) => 
          rel.episode_id === episode.episode_id
        )
      }

      return (
        <div className="modal-content">
          <h2 className="modal-title">{episode.episode_title}</h2>
          
          {/* Relationships at top for episodes */}
          {relatedItems.relationships.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Relationships</h3>
              <div className="modal-pills-grid">
                {relatedItems.relationships.map((rel: Relationship) => (
                  <span
                    key={rel.id}
                    className="relationship-pill modal-pill"
                    data-id={rel.id}
                    data-type="relationship"
                    onClick={() => openModal(rel.id, 'relationship')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(rel.relationship_type)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entities */}
          {relatedItems.entities.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Entities</h3>
              <div className="modal-pills-grid">
                {relatedItems.entities.map((entity: Entity) => (
                  <span
                    key={entity.id}
                    className="entity-pill modal-pill"
                    data-id={entity.id}
                    data-type="entity"
                    onClick={() => openModal(entity.id, 'entity')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(entity.name)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Episode full text/description */}
          <div className="modal-section">
            <h3 className="modal-section-title">Full Episode Content</h3>
            <div 
              className="modal-text-content"
              dangerouslySetInnerHTML={{ __html: getEpisodeFullText(episode.episode_id) }}
            />
          </div>

          {episode.url && (
            <div className="modal-section">
              <a 
                href={episode.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent modal-play-button"
              >
                Listen to Episode
              </a>
            </div>
          )}
        </div>
      )
    }

    if (modalData.type === 'entity') {
      const entity = content as Entity
      const relatedItems = getRelatedItemsForEntity(entity.id)

      return (
        <div className="modal-content">
          <div className="modal-type-badge entity-badge">
            {formatDisplayText(entity.type)}
          </div>
          <h2 className="modal-title">{formatDisplayText(entity.name)}</h2>
          
          <div className="modal-section">
            <h3 className="modal-section-title">Description</h3>
            <div className="modal-text-content">
              {entity.context}
            </div>
          </div>

          {/* Amazon Products (pre-fetched) */}
          <AmazonProductsComponent entity={entity} />

          {/* Related Episodes */}
          {relatedItems.episodes.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Episodes</h3>
              <div className="modal-pills-grid">
                {relatedItems.episodes.map((episode: Episode) => (
                  <span
                    key={episode.episode_id}
                    className="episode-pill modal-pill"
                    data-id={episode.episode_id}
                    data-type="episode"
                    onClick={() => openModal(episode.episode_id, 'episode')}
                  >
                    {episode.episode_number 
                      ? `#${episode.episode_number}` 
                      : episode.episode_title.length > 15 
                        ? `${episode.episode_title.substring(0, 15)}...`
                        : episode.episode_title
                    }
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Entities */}
          {relatedItems.entities.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Related Entities</h3>
              <div className="modal-pills-grid">
                {relatedItems.entities.map((relEntity: Entity) => (
                  <span
                    key={relEntity.id}
                    className="entity-pill modal-pill"
                    data-id={relEntity.id}
                    data-type="entity"
                    onClick={() => openModal(relEntity.id, 'entity')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(relEntity.name)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {relatedItems.relationships.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Relationships</h3>
              <div className="modal-pills-grid">
                {relatedItems.relationships.map((rel: Relationship) => (
                  <span
                    key={rel.id}
                    className="relationship-pill modal-pill"
                    data-id={rel.id}
                    data-type="relationship"
                    onClick={() => openModal(rel.id, 'relationship')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(rel.relationship_type)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    }

    if (modalData.type === 'relationship') {
      const relationship = content as Relationship
      const relatedItems = getRelatedItemsForRelationship(relationship.id)

      return (
        <div className="modal-content">
          <div className="modal-type-badge relationship-badge">
            {formatDisplayText(relationship.relationship_type)}
          </div>
          <h2 className="modal-title">{formatDisplayText(relationship.entity1_name)} → {formatDisplayText(relationship.entity2_name)}</h2>
          
          <div className="modal-section">
            <h3 className="modal-section-title">Description</h3>
            <div className="modal-text-content">
              {relationship.description}
            </div>
          </div>

          {/* Related Episodes */}
          {relatedItems.episodes.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Episodes</h3>
              <div className="modal-pills-grid">
                {relatedItems.episodes.map((episode: Episode) => (
                  <span
                    key={episode.episode_id}
                    className="episode-pill modal-pill"
                    data-id={episode.episode_id}
                    data-type="episode"
                    onClick={() => openModal(episode.episode_id, 'episode')}
                  >
                    {episode.episode_number 
                      ? `#${episode.episode_number}` 
                      : episode.episode_title.length > 15 
                        ? `${episode.episode_title.substring(0, 15)}...`
                        : episode.episode_title
                    }
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Entities */}
          {relatedItems.entities.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Entities</h3>
              <div className="modal-pills-grid">
                {relatedItems.entities.map((entity: Entity) => (
                  <span
                    key={entity.id}
                    className="entity-pill modal-pill"
                    data-id={entity.id}
                    data-type="entity"
                    onClick={() => openModal(entity.id, 'entity')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(entity.name)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Other Relationships */}
          {relatedItems.relationships.length > 0 && (
            <div className="modal-section">
              <h3 className="modal-section-title">Related Relationships</h3>
              <div className="modal-pills-grid">
                {relatedItems.relationships.map((rel: Relationship) => (
                  <span
                    key={rel.id}
                    className="relationship-pill modal-pill"
                    data-id={rel.id}
                    data-type="relationship"
                    onClick={() => openModal(rel.id, 'relationship')}
                  >
                    {(() => {
                      const formatted = formatDisplayText(rel.relationship_type)
                      return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                    })()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className="container">
      <header className="header">
        <h1 className="text-white">Founders Search</h1>
      </header>
      
      <div className="search-section">
        <div className="search-container">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search episodes, founders, companies..."
            onChange={handleInputChange}
            value={searchQuery}
          />
        </div>
      </div>

      {isSearching ? (
        <div className="episodes-section">
          {searchResults.length > 0 ? (
            <>
              <div className="search-results-header">
                Found {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
              </div>
{searchResults.map((result: SearchResult) => {
                if (result.type === 'episode') {
                  // Find the full episode data
                  const episode = episodesData.episodes.find((ep: Episode) => ep.episode_id === result.id)
                  if (!episode) return null
                  
                  return (
                    <div key={result.id} className="episode-card">
                      <div className="episode-header">
                        <div 
                          className="title-with-maximize"
                          data-id={episode.episode_id}
                          data-type="episode"
                          onClick={() => openModal(episode.episode_id, 'episode')}
                        >
                          <h3 className="episode-title">{episode.episode_title}</h3>
                          <span className="maximize-icon">
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M16 3H19C20.1046 3 21 3.89543 21 5V8M3 16V19C3 20.1046 3.89543 21 5 21H8M21 16V19C21 20.1046 20.1046 21 19 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </span>
                        </div>
                        <a 
                          href={episode.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="play-button"
                        >
                          Play
                        </a>
                      </div>
                      
                      <p className="episode-description">
                        {extractDescription(episode)}
                      </p>
                      
                      <div className="pills-section">
                        {episode.entities && episode.entities.length > 0 && (
                          <div>
                            <div className="pills-label">Entities</div>
                            <div className="pills-row">
                              {episode.entities.slice(0, 5).map((entity: Entity) => (
                                <span 
                                  key={entity.id} 
                                  className="entity-pill"
                                  data-id={entity.id}
                                  data-type="entity"
                                  onClick={() => openModal(entity.id, 'entity')}
                                >
                                  {(() => {
                                    const formatted = formatDisplayText(entity.name)
                                    return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                                  })()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div>
                          <div className="pills-label">Episodes</div>
                          <div className="pills-row">
                            {episodesData.episodes
                              .filter((otherEpisode: Episode) => otherEpisode.episode_id !== episode.episode_id)
                              .slice(0, 4)
                              .map((relatedEpisode: Episode) => (
                                <span 
                                  key={relatedEpisode.episode_id} 
                                  className="episode-pill"
                                  onClick={() => openModal(relatedEpisode.episode_id, 'episode')}
                                >
                                  {relatedEpisode.episode_number 
                                    ? `#${relatedEpisode.episode_number}` 
                                    : relatedEpisode.episode_title.length > 10 
                                      ? `${relatedEpisode.episode_title.substring(0, 10)}...`
                                      : relatedEpisode.episode_title
                                  }
                                </span>
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }
                
                if (result.type === 'entity') {
                  const relatedItems = getRelatedItemsForEntity(result.id)
                  const entity = episodesData.all_entities?.find((e: Entity) => e.id === result.id)
                  const entityType = entity?.type || 'entity'
                  
                  return (
                    <div key={result.id} className="entity-card">
                      <div className="result-type-badge">
                        {entityType.charAt(0).toUpperCase() + entityType.slice(1).toLowerCase()}
                      </div>
                      
                      <div 
                        className="title-with-maximize"
                        data-id={result.id}
                        data-type="entity"
                        onClick={() => openModal(result.id, 'entity')}
                      >
                        <h3 className="search-result-title">{result.title}</h3>
                        <span className="maximize-icon">
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M16 3H19C20.1046 3 21 3.89543 21 5V8M3 16V19C3 20.1046 3.89543 21 5 21H8M21 16V19C21 20.1046 20.1046 21 19 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      </div>
                      
                      <p className="search-result-description">
                        {result.description}
                      </p>
                      
                      <div className="pills-section">
                        {relatedItems.episodes.length > 0 && (
                          <div>
                            <div className="pills-label">Episodes</div>
                            <div className="pills-row">
                              {relatedItems.episodes.map((episode: Episode) => (
                                <span 
                                  key={episode.episode_id} 
                                  className="episode-pill"
                                  data-id={episode.episode_id}
                                  data-type="episode"
                                  onClick={() => openModal(episode.episode_id, 'episode')}
                                >
                                  {episode.episode_number 
                                    ? `#${episode.episode_number}` 
                                    : episode.episode_title.length > 15 
                                      ? `${episode.episode_title.substring(0, 15)}...`
                                      : episode.episode_title
                                  }
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {relatedItems.entities.length > 0 && (
                          <div>
                            <div className="pills-label">Related Entities</div>
                            <div className="pills-row">
                              {relatedItems.entities.map((entity: Entity) => (
                                <span 
                                  key={entity.id} 
                                  className="entity-pill"
                                  data-id={entity.id}
                                  data-type="entity"
                                  onClick={() => openModal(entity.id, 'entity')}
                                >
                                  {(() => {
                                    const formatted = formatDisplayText(entity.name)
                                    return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                                  })()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {relatedItems.relationships.length > 0 && (
                          <div>
                            <div className="pills-label">Relationships</div>
                            <div className="pills-row">
                              {relatedItems.relationships.map((rel: Relationship) => (
                                <span 
                                  key={rel.id} 
                                  className="relationship-pill"
                                  data-id={rel.id}
                                  data-type="relationship"
                                  onClick={() => openModal(rel.id, 'relationship')}
                                >
                                  {(() => {
                                    const formatted = formatDisplayText(rel.relationship_type)
                                    return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                                  })()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                
                if (result.type === 'relationship') {
                  const relatedItems = getRelatedItemsForRelationship(result.id)
                  const relationship = relationshipsData.relationships.find((rel: Relationship) => rel.id === result.id)
                  const relationshipType = relationship?.relationship_type || 'relationship'
                  
                  return (
                    <div key={result.id} className="relationship-card">
                      <div className="result-type-badge">
                        {relationshipType.split('_').map((word: string) => 
                          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                        ).join(' ')}
                      </div>
                      
                      <div 
                        className="title-with-maximize"
                        data-id={result.id}
                        data-type="relationship"
                        onClick={() => openModal(result.id, 'relationship')}
                      >
                        <h3 className="search-result-title">{result.title}</h3>
                        <span className="maximize-icon">
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M16 3H19C20.1046 3 21 3.89543 21 5V8M3 16V19C3 20.1046 3.89543 21 5 21H8M21 16V19C21 20.1046 20.1046 21 19 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </span>
                      </div>
                      
                      <p className="search-result-description">
                        {result.description}
                      </p>
                      
                      <div className="pills-section">
                        {relatedItems.episodes.length > 0 && (
                          <div>
                            <div className="pills-label">Episodes</div>
                            <div className="pills-row">
                              {relatedItems.episodes.map((episode: Episode) => (
                                <span 
                                  key={episode.episode_id} 
                                  className="episode-pill"
                                  data-id={episode.episode_id}
                                  data-type="episode"
                                  onClick={() => openModal(episode.episode_id, 'episode')}
                                >
                                  {episode.episode_number 
                                    ? `#${episode.episode_number}` 
                                    : episode.episode_title.length > 15 
                                      ? `${episode.episode_title.substring(0, 15)}...`
                                      : episode.episode_title
                                  }
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {relatedItems.entities.length > 0 && (
                          <div>
                            <div className="pills-label">Entities</div>
                            <div className="pills-row">
                              {relatedItems.entities.map((entity: Entity) => (
                                <span 
                                  key={entity.id} 
                                  className="entity-pill"
                                  data-id={entity.id}
                                  data-type="entity"
                                  onClick={() => openModal(entity.id, 'entity')}
                                >
                                  {(() => {
                                    const formatted = formatDisplayText(entity.name)
                                    return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                                  })()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {relatedItems.relationships.length > 0 && (
                          <div>
                            <div className="pills-label">Related Relationships</div>
                            <div className="pills-row">
                              {relatedItems.relationships.map((rel: Relationship) => (
                                <span 
                                  key={rel.id} 
                                  className="relationship-pill"
                                  data-id={rel.id}
                                  data-type="relationship"
                                  onClick={() => openModal(rel.id, 'relationship')}
                                >
                                  {(() => {
                                    const formatted = formatDisplayText(rel.relationship_type)
                                    return formatted.length > 15 ? `${formatted.substring(0, 15)}...` : formatted
                                  })()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                
                return null
              })}
            </>
          ) : (
            <div className="no-results">
              No results found for "{searchQuery}"
            </div>
          )}
        </div>
      ) : (
        <div className="episodes-section">
          {randomEpisodes.length > 0 ? randomEpisodes.map((episode: Episode) => {
            const description = extractDescription(episode)
            
            return (
              <div key={episode.episode_id} className="episode-card">
                <div className="episode-header">
                  <div 
                    className="title-with-maximize"
                    data-id={episode.episode_id}
                    data-type="episode"
                    onClick={() => openModal(episode.episode_id, 'episode')}
                  >
                    <h3 className="episode-title">{episode.episode_title}</h3>
                    <span className="maximize-icon">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 3H5C3.89543 3 3 3.89543 3 5V8M16 3H19C20.1046 3 21 3.89543 21 5V8M3 16V19C3 20.1046 3.89543 21 5 21H8M21 16V19C21 20.1046 20.1046 21 19 21H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </div>
                  <a 
                    href={episode.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="play-button"
                  >
                    Play
                  </a>
                </div>
                
                <p className="episode-description">
                  {description}
                </p>
                
                <div className="pills-section">
                  {episode.entities && episode.entities.length > 0 && (
                    <div>
                      <div className="pills-label">Entities</div>
                      <div className="pills-row">
                        {episode.entities.slice(0, 5).map((entity: Entity) => (
                          <span 
                            key={entity.id} 
                            className="entity-pill"
                            data-id={entity.id}
                            data-type="entity"
                            onClick={() => openModal(entity.id, 'entity')}
                          >
                            {formatDisplayText(entity.name)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <div className="pills-label">Episodes</div>
                    <div className="pills-row">
                      {episodesData.episodes
                        .filter((otherEpisode: Episode) => otherEpisode.episode_id !== episode.episode_id)
                        .slice(0, 4)
                        .map((relatedEpisode: Episode) => (
                          <span 
                            key={relatedEpisode.episode_id} 
                            className="episode-pill"
                            data-id={relatedEpisode.episode_id}
                            data-type="episode"
                            onClick={() => openModal(relatedEpisode.episode_id, 'episode')}
                          >
                            {relatedEpisode.episode_number 
                              ? `#${relatedEpisode.episode_number}` 
                              : relatedEpisode.episode_title.length > 15 
                                ? `${relatedEpisode.episode_title.substring(0, 15)}...`
                                : relatedEpisode.episode_title
                            }
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          }) : (
            <div className="loading-episodes">
              Loading random episodes...
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modalData.isOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-button" onClick={closeModal}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {renderModalContent()}
          </div>
        </div>
      )}
    </div>
  )
}