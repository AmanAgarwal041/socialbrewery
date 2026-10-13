import type { ComponentType, SVGProps } from 'react'
import { HashnodeIcon, InstagramIcon, LinkedinIcon, RedditIcon, SlackIcon, XIcon, YoutubeIcon } from '@/components/brand-icons'
import type { Connectors, Health, NetworkId } from '@/lib/api'

export type Slot = 'p1' | 'p2' | 'p3' | 'p4'

export type NetworkMeta = {
  id: NetworkId
  name: string
  noun: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  slot: Slot
  blurb: string
}

// Each connector takes one palette slot so the pastel palette drives its accent everywhere.
export const NETWORKS: NetworkMeta[] = [
  { id: 'youtube', name: 'YouTube', noun: 'Short', icon: YoutubeIcon, slot: 'p1', blurb: 'Shorts, channel stats, and AI reviews.' },
  { id: 'linkedin', name: 'LinkedIn', noun: 'post', icon: LinkedinIcon, slot: 'p3', blurb: 'Text and video posts to your profile.' },
  { id: 'instagram', name: 'Instagram', noun: 'Reel', icon: InstagramIcon, slot: 'p2', blurb: 'Reels to a professional account.' },
  { id: 'x', name: 'X', noun: 'post', icon: XIcon, slot: 'p4', blurb: 'Posts, video, and reply threads on X.' },
  { id: 'hashnode', name: 'Hashnode', noun: 'article', icon: HashnodeIcon, slot: 'p1', blurb: 'Markdown articles and drafts on your blog.' },
  { id: 'slack', name: 'Slack', noun: 'message', icon: SlackIcon, slot: 'p2', blurb: 'Messages, clips, and thread replies in your workspace.' },
  { id: 'reddit', name: 'Reddit', noun: 'post', icon: RedditIcon, slot: 'p3', blurb: 'Text and link posts to subreddits you choose.' },
]

export const networkById = Object.fromEntries(NETWORKS.map((n) => [n.id, n])) as Record<NetworkId, NetworkMeta>

export const SLOT_CLASSES: Record<Slot, { chip: string; soft: string; ink: string; ring: string; solid: string }> = {
  p1: { chip: 'bg-p1-soft text-p1-ink', soft: 'bg-p1-soft', ink: 'text-p1-ink', ring: 'ring-p1', solid: 'bg-p1' },
  p2: { chip: 'bg-p2-soft text-p2-ink', soft: 'bg-p2-soft', ink: 'text-p2-ink', ring: 'ring-p2', solid: 'bg-p2' },
  p3: { chip: 'bg-p3-soft text-p3-ink', soft: 'bg-p3-soft', ink: 'text-p3-ink', ring: 'ring-p3', solid: 'bg-p3' },
  p4: { chip: 'bg-p4-soft text-p4-ink', soft: 'bg-p4-soft', ink: 'text-p4-ink', ring: 'ring-p4', solid: 'bg-p4' },
}

export function networkState(id: NetworkId, health: Health | null, connectors: Connectors | null) {
  const ready = health?.[`${id}App`]
  const connected = health?.[`${id}Connected`]
  const account = {
    youtube: connectors?.youtube.channel,
    linkedin: connectors?.linkedin.profile,
    instagram: connectors?.instagram.account,
    x: connectors?.x?.account,
    hashnode: connectors?.hashnode?.account,
    slack: connectors?.slack?.account,
    reddit: connectors?.reddit?.account,
  }[id]
  return {
    loading: !health,
    ready: Boolean(ready),
    connected: Boolean(connected),
    accountName: account?.title || (account as { customUrl?: string } | null | undefined)?.customUrl || '',
    picture:
      (account as { thumbnail?: string } | null | undefined)?.thumbnail ||
      (account as { picture?: string } | null | undefined)?.picture ||
      '',
  }
}
