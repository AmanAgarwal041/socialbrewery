// The whole platform is colored from these four swatches (light → accent order:
// primary, secondary, info, success). Change this array to re-skin everything.
export const PALETTE: Palette = ['#9FA1FF', '#B5BAFF', '#AEE2FF', '#D9F9DF']

export type Palette = [string, string, string, string]

export const PRESETS: { name: string; palette: Palette }[] = [
  { name: 'Periwinkle (default)', palette: PALETTE },
  { name: 'Peach', palette: ['#FFB38E', '#FFCF9D', '#FFE5CF', '#DEF9C4'] },
  { name: 'Rose', palette: ['#F4A4C0', '#F8C8DC', '#FFE3E1', '#D3F6F3'] },
  { name: 'Matcha', palette: ['#9ED2BE', '#C8E4B2', '#FFF4C4', '#B5D5FF'] },
]

const STORAGE_KEY = 'socialbrewery.palette'
const HEX = /^#[0-9a-f]{6}$/i

export function savedPalette(): Palette {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (Array.isArray(raw) && raw.length === 4 && raw.every((c) => HEX.test(c))) return raw as Palette
  } catch {
    // Fall back to the default palette.
  }
  return PALETTE
}

export function applyPalette(palette: Palette, persist = false) {
  const root = document.documentElement
  palette.forEach((color, index) => root.style.setProperty(`--p${index + 1}`, color))
  if (persist) localStorage.setItem(STORAGE_KEY, JSON.stringify(palette))
}

export function resetPalette() {
  localStorage.removeItem(STORAGE_KEY)
  applyPalette(PALETTE)
}
