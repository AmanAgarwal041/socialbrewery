// Types for the Chrome extension, which bundles studio-compose.js to render compositions in the browser.

export type Brand = {
  id?: string
  name?: string
  colors: Record<string, string>
  fonts?: { sans?: string; mono?: string }
  cta?: { label?: string; url?: string }
  [key: string]: unknown
}

export type ComposeOptions = {
  format?: '9x16' | '16x9'
  brand: Brand
  scenes: Record<string, unknown>[]
  cta?: { label?: string; url?: string }
  question?: string
  audio?: string
}

export declare const FORMATS: Record<'9x16' | '16x9', { w: number; h: number }>
export declare const EFFECTS: string[]
export declare const SCENE_SCHEMA: Record<string, unknown>
export declare function normalizeBrand(input: Record<string, unknown> | undefined, base: Brand): Brand
export declare function composeHtml(template: string, options: ComposeOptions): { html: string; duration: number; width: number; height: number; scenes: unknown[] }
