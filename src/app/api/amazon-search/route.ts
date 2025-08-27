import { NextRequest, NextResponse } from 'next/server'

// Add affiliate tag to Amazon URLs
function addAffiliateTag(url: string): string {
  if (!url || !url.includes('amazon.com')) return url
  
  const affiliateTag = 'tag=chanelmunezer-20'
  
  // If URL already has query parameters, add affiliate tag
  if (url.includes('?')) {
    return url.includes(affiliateTag) ? url : `${url}&${affiliateTag}`
  } else {
    return `${url}?${affiliateTag}`
  }
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const serpApiKey = process.env.SERPAPI_KEY

    if (!serpApiKey) {
      return NextResponse.json({ error: 'SerpAPI key not configured' }, { status: 500 })
    }

    const apiUrl = `https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(query)}&api_key=${serpApiKey}`
    console.log('SerpAPI URL:', apiUrl.replace(serpApiKey, '[REDACTED]'))
    
    const response = await fetch(apiUrl)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('SerpAPI error response:', response.status, response.statusText, errorText)
      throw new Error(`SerpAPI request failed: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    
    // Process results to add affiliate tags and format for frontend
    const results = data.organic_results?.map((item: any) => ({
      title: item.title,
      thumbnail: item.image || item.thumbnail,
      link_clean: addAffiliateTag(item.link || '')
    })) || []

    console.log('SerpAPI success, processed results:', results.length)
    return NextResponse.json({ results })
  } catch (error) {
    console.error('Amazon search error:', error)
    return NextResponse.json({ error: 'Failed to search Amazon' }, { status: 500 })
  }
}

// Keep GET for backwards compatibility
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query')

  if (!query) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
  }

  const serpApiKey = process.env.SERPAPI_KEY

  if (!serpApiKey) {
    return NextResponse.json({ error: 'SerpAPI key not configured' }, { status: 500 })
  }

  try {
    const apiUrl = `https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(query)}&api_key=${serpApiKey}`
    console.log('SerpAPI URL:', apiUrl.replace(serpApiKey, '[REDACTED]'))
    
    const response = await fetch(apiUrl)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('SerpAPI error response:', response.status, response.statusText, errorText)
      throw new Error(`SerpAPI request failed: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    console.log('SerpAPI success, result count:', data.organic_results?.length || 0)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Amazon search error:', error)
    return NextResponse.json({ error: 'Failed to search Amazon' }, { status: 500 })
  }
}