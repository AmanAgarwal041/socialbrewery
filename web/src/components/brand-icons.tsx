import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

export function YoutubeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function LinkedinIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 10.5V16M8 7.6v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1 1 2.1 2.6V16" />
    </svg>
  )
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.2 6.8v.1" />
    </svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M7.5 7.5h2.6l6.4 9h-2.6zM16.3 7.5l-3.3 3.7M11 12.8l-3.3 3.7" />
    </svg>
  )
}

export function HashnodeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" {...props}>
      <path d="M9.2 3.6a4 4 0 0 1 5.6 0l5.6 5.6a4 4 0 0 1 0 5.6l-5.6 5.6a4 4 0 0 1-5.6 0l-5.6-5.6a4 4 0 0 1 0-5.6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function SlackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...props}>
      <path d="M9.5 3.5v7M14.5 13.5v7M3.5 14.5h7M13.5 9.5h7" strokeWidth={3} />
    </svg>
  )
}

export function RedditIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <ellipse cx="12" cy="14.5" rx="7.5" ry="5" />
      <path d="M12 9.5l1.2-5 3.8.9" />
      <circle cx="18" cy="5.6" r="1.3" />
      <circle cx="19.2" cy="10.6" r="1.6" />
      <circle cx="4.8" cy="10.6" r="1.6" />
      <path d="M9.2 13.6v.1M14.8 13.6v.1M9.5 16.6c1.5 1 3.5 1 5 0" />
    </svg>
  )
}

export function BrewIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M16 11h1.6a2.2 2.2 0 0 1 0 4.4H16" />
      <path d="M8.5 3.5c.8.8.8 1.7 0 2.5M12 3.5c.8.8.8 1.7 0 2.5" />
    </svg>
  )
}

export function GithubIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.38-3.37-1.38-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.1 10.1 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  )
}

export function GoogleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.34Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8V7.51H3.07a10 10 0 0 0 0 8.98l3.34-2.59Z" />
      <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.51l3.34 2.59C7.2 7.74 9.4 5.98 12 5.98Z" />
    </svg>
  )
}
