import { NextRequest, NextResponse } from 'next/server'

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