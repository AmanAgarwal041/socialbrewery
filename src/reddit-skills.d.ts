// Types for reddit-skills.js, which the Chrome extension (TypeScript) imports too.
export type RedditSkill = { title: string; summary: string; text: string }
export declare const REDDIT_SKILLS: Record<'reddit-lead-research' | 'reddit-user-research', RedditSkill>
export declare const REDDIT_SKILL_NAMES: string[]
export declare function redditSkill(name: string): RedditSkill & { name: string; uri: string }
export declare function intentSignals(...texts: unknown[]): string[]
