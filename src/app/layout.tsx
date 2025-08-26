import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Founders Search',
  description: 'Search for podcast episodes, entities and relationships',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}