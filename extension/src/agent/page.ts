// Functions that run inside the page, injected with chrome.scripting.executeScript({ func }).
// Chrome serializes each function's source, so every one must be self-contained: no imports, no
// references to anything outside its own body. They run in the extension's isolated world, which
// keeps its globals (the ref map) across calls until the page navigates.

export type PageElement = {
  ref: number
  tag: string
  role: string
  name: string
  type?: string
  value?: string
  editable?: boolean
  disabled?: boolean
  checked?: boolean
  offscreen?: boolean
}

export type PageSnapshot = {
  url: string
  title: string
  elements: PageElement[]
  text: string
  scrollY: number
  scrollHeight: number
  viewportHeight: number
}

export type ElementBox = {
  x: number
  y: number
  tag: string
  role: string
  name: string
  type: string
  editable: boolean
  fileInput: boolean
  formSubmit: boolean
}

/** Lists the page's interactive elements (numbered refs) and its visible text. */
export function snapshotPage(maxElements: number, maxText: number): PageSnapshot {
  type W = Window & { __sbRefs?: Map<number, WeakRef<Element>>; __sbNext?: number; __sbIds?: WeakMap<Element, number> }
  const w = window as W
  w.__sbRefs ??= new Map()
  w.__sbIds ??= new WeakMap()
  w.__sbNext ??= 1

  const INTERACTIVE = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=textbox],[role=menuitem],[role=menuitemradio],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=option],[role=searchbox],[contenteditable=""],[contenteditable=true],[contenteditable=plaintext-only]'

  const all: Element[] = []
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(INTERACTIVE)) all.push(el)
      const shadow = (el as HTMLElement).shadowRoot
      if (shadow) walk(shadow)
    }
  }
  walk(document)

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }
  const clean = (s: string | null | undefined, n = 90) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n)
  const labelFor = (el: Element) => {
    const h = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> | null; placeholder?: string; alt?: string }
    const by = el.getAttribute('aria-labelledby')
    const labelled = by
      ? by
          .split(/\s+/)
          .map((id) => (el.getRootNode() as Document | ShadowRoot).getElementById?.(id)?.textContent || '')
          .join(' ')
      : ''
    return clean(
      el.getAttribute('aria-label') ||
        labelled ||
        h.labels?.[0]?.textContent ||
        (el.tagName === 'INPUT' ? '' : h.innerText) ||
        h.placeholder ||
        el.getAttribute('title') ||
        el.getAttribute('data-placeholder') ||
        el.getAttribute('aria-placeholder') ||
        h.alt ||
        el.getAttribute('name') ||
        '',
    )
  }

  const vh = window.innerHeight
  const elements: PageElement[] = []
  for (const el of all) {
    if (elements.length >= maxElements) break
    const isFile = el instanceof HTMLInputElement && el.type === 'file'
    // File inputs are usually hidden behind a styled button; list them anyway so upload_file can find them.
    if (!isFile && !visible(el)) continue
    let ref = w.__sbIds.get(el)
    if (!ref) {
      ref = w.__sbNext++
      w.__sbIds.set(el, ref)
      w.__sbRefs.set(ref, new WeakRef(el))
    }
    const h = el as HTMLInputElement
    const tag = el.tagName.toLowerCase()
    const editable = (el as HTMLElement).isContentEditable || tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(h.type))
    const r = el.getBoundingClientRect()
    const item: PageElement = { ref, tag, role: el.getAttribute('role') || '', name: labelFor(el) }
    if (tag === 'input') item.type = h.type
    if (editable) {
      item.editable = true
      const v = (el as HTMLElement).isContentEditable ? (el as HTMLElement).innerText : h.value
      if (v) item.value = clean(v, 200)
    }
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true
    if (h.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') item.checked = true
    if (!isFile && (r.bottom < 0 || r.top > vh)) item.offscreen = true
    elements.push(item)
  }

  return {
    url: location.href,
    title: document.title,
    elements,
    text: clean(document.body?.innerText, maxText),
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: vh,
  }
}

/** Scrolls a ref'd element into view and returns where to click it (viewport CSS pixels). */
export function locateRef(ref: number): ElementBox | null {
  const w = window as Window & { __sbRefs?: Map<number, WeakRef<Element>> }
  const el = w.__sbRefs?.get(ref)?.deref()
  if (!el || !el.isConnected) return null
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const r = el.getBoundingClientRect()
  const h = el as HTMLElement
  const input = el as HTMLInputElement
  const tag = el.tagName.toLowerCase()
  const text = (el.getAttribute('aria-label') || h.innerText || input.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 90)
  const formSubmit = (tag === 'button' && (input.type === 'submit' || !el.getAttribute('type')) && !!el.closest('form')) || (tag === 'input' && input.type === 'submit')
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    tag,
    role: el.getAttribute('role') || '',
    name: text,
    type: input.type || '',
    editable: h.isContentEditable || tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file'].includes(input.type)),
    fileInput: tag === 'input' && input.type === 'file',
    formSubmit,
  }
}

/** What has keyboard focus, looking through shadow roots. */
export function focusedElement(): { editable: boolean; tag: string; name: string } {
  let el: Element | null = document.activeElement
  while (el && (el as HTMLElement).shadowRoot?.activeElement) el = (el as HTMLElement).shadowRoot!.activeElement
  if (!el) return { editable: false, tag: '', name: '' }
  const h = el as HTMLElement
  const tag = el.tagName.toLowerCase()
  const input = el as HTMLInputElement
  const textInput = tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(input.type)
  return {
    editable: h.isContentEditable || tag === 'textarea' || textInput,
    tag,
    name: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || (textInput ? '' : h.innerText || input.value) || '').replace(/\s+/g, ' ').trim().slice(0, 90),
  }
}

/** Files are handed to the page in base64 pieces, then set on the file input as one File. */
export function receiveFileChunk(id: string, index: number, data: string): number {
  const w = window as Window & { __sbUploads?: Map<string, string[]> }
  w.__sbUploads ??= new Map()
  const parts = w.__sbUploads.get(id) || []
  parts[index] = data
  w.__sbUploads.set(id, parts)
  return parts.length
}

export function attachFile(id: string, ref: number, name: string, mime: string): string {
  const w = window as Window & { __sbUploads?: Map<string, string[]>; __sbRefs?: Map<number, WeakRef<Element>> }
  const parts = w.__sbUploads?.get(id)
  w.__sbUploads?.delete(id)
  if (!parts) return 'The file did not arrive in the page.'
  let input = w.__sbRefs?.get(ref)?.deref() as HTMLInputElement | undefined
  if (!input || !(input instanceof HTMLInputElement) || input.type !== 'file') {
    // A file picker the site opened is marked by the extension; use that input.
    input = document.querySelector('input[type=file][data-sb-filechooser]') as HTMLInputElement | undefined
  }
  if (!input) return 'That element is not a file input.'
  const bytes = parts.map((p) => Uint8Array.from(atob(p), (c) => c.charCodeAt(0)))
  const file = new File(bytes, name, { type: mime })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.removeAttribute('data-sb-filechooser')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
}

export function scrollPage(dy: number): { scrollY: number; scrollHeight: number } {
  window.scrollBy({ top: dy, behavior: 'instant' })
  return { scrollY: Math.round(window.scrollY), scrollHeight: Math.round(document.documentElement.scrollHeight) }
}

/** The clickable element under a viewport point, for checking coordinate clicks like ref clicks. */
export function describePoint(x: number, y: number): { name: string; tag: string; role: string } {
  let el: Element | null = document.elementFromPoint(x, y)
  while (el && (el as HTMLElement).shadowRoot) {
    const inner: Element | null = (el as HTMLElement).shadowRoot!.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  const target = el?.closest('button,a,[role=button],[role=link],[role=menuitem],input,[tabindex]') || el
  if (!target) return { name: '', tag: '', role: '' }
  const text = (target.getAttribute('aria-label') || (target as HTMLElement).innerText || (target as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 90)
  return { name: text, tag: target.tagName.toLowerCase(), role: target.getAttribute('role') || '' }
}
