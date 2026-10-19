// Drives one tab: page reading through injected functions, and trusted input (clicks, typing, keys)
// and screenshots through the Chrome DevTools Protocol. Chrome shows a "started debugging this
// browser" bar while attached, which is the user's signal that the agent is at work.

import { attachFile, describePoint, focusedElement, locateRef, receiveFileChunk, scrollPage, snapshotPage, type ElementBox, type PageSnapshot } from './page'

const PROTOCOL = '1.3'
const CHUNK = 768 * 1024

type Target = chrome.debugger.Debuggee

function cdp<T = unknown>(target: Target, method: string, params?: Record<string, unknown>): Promise<T> {
  return chrome.debugger.sendCommand(target, method, params) as unknown as Promise<T>
}

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
}

// CDP modifier bits.
const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 }

export type ParsedKey = { key: string; modifiers: number; letter?: string }

/** "Enter", "Shift+Enter", "Mod+A" (Cmd on macOS, Ctrl elsewhere). */
export function parseKey(combo: string): ParsedKey {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop() || ''
  const mac = navigator.platform.toLowerCase().includes('mac')
  let modifiers = 0
  for (const p of parts) modifiers |= p === 'Mod' ? (mac ? 4 : 2) : MODIFIERS[p] || 0
  if (/^[a-z]$/i.test(key)) return { key: key.toLowerCase(), modifiers, letter: key.toUpperCase() }
  if (!KEYS[key]) throw new Error(`Unknown key "${key}". Use Enter, Tab, Escape, Backspace, Delete, arrows, Home, End, PageUp, PageDown, Space, or a letter with modifiers.`)
  return { key, modifiers }
}

export class AgentTab {
  tabId: number
  private target: Target
  private attached = false
  private onEvent?: (source: Target, method: string, params?: object) => void
  private onDetach?: (source: Target) => void
  /** Set when the site tried to open the OS file picker, which the agent cannot use. */
  fileChooserRequested = false
  /** Scale from the last screenshot's pixels to viewport CSS pixels. */
  private shotScale = 1

  constructor(tabId: number) {
    this.tabId = tabId
    this.target = { tabId }
  }

  async attach() {
    if (this.attached) return
    try {
      await chrome.debugger.attach(this.target, PROTOCOL)
    } catch (err) {
      const message = (err as Error).message || String(err)
      if (!/already attached/i.test(message)) throw new Error(`Couldn't take control of this tab: ${message}. Close DevTools on it and try again.`)
    }
    this.attached = true
    this.onEvent = (source, method, params) => {
      if (source.tabId !== this.tabId || method !== 'Page.fileChooserOpened') return
      this.fileChooserRequested = true
      const nodeId = (params as { backendNodeId?: number })?.backendNodeId
      if (nodeId) void this.markFileChooser(nodeId)
    }
    this.onDetach = (source) => {
      if (source.tabId === this.tabId) this.attached = false
    }
    chrome.debugger.onEvent.addListener(this.onEvent)
    chrome.debugger.onDetach.addListener(this.onDetach)
    await cdp(this.target, 'Page.enable')
    // The native file dialog would block the agent; catch it and hand the file over instead.
    await cdp(this.target, 'Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {})
  }

  async detach() {
    if (this.onEvent) chrome.debugger.onEvent.removeListener(this.onEvent)
    if (this.onDetach) chrome.debugger.onDetach.removeListener(this.onDetach)
    if (this.attached) await chrome.debugger.detach(this.target).catch(() => {})
    this.attached = false
  }

  private async markFileChooser(backendNodeId: number) {
    const { object } = await cdp<{ object: { objectId?: string } }>(this.target, 'DOM.resolveNode', { backendNodeId })
    if (!object.objectId) return
    await cdp(this.target, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { this.setAttribute("data-sb-filechooser", "1") }',
    })
  }

  private async run<A extends unknown[], R>(func: (...args: A) => R, args: A): Promise<R> {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func, args })
    return result?.result as R
  }

  async tab() {
    return chrome.tabs.get(this.tabId)
  }

  async snapshot(): Promise<PageSnapshot> {
    await this.waitForLoad()
    return this.run(snapshotPage, [250, 5000])
  }

  async locate(ref: number): Promise<ElementBox> {
    const box = await this.run(locateRef, [ref])
    if (!box) throw new Error(`Element [${ref}] is gone. Call read_page again to get fresh refs.`)
    return box
  }

  async focused() {
    return this.run(focusedElement, [])
  }

  async clickAt(x: number, y: number) {
    await this.attach()
    const base = { x, y, button: 'left', clickCount: 1 }
    await cdp(this.target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp(this.target, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await cdp(this.target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  }

  /** Converts a point in the last screenshot's pixels to viewport CSS pixels. */
  toViewport(x: number, y: number) {
    return { x: Math.round(x * this.shotScale), y: Math.round(y * this.shotScale) }
  }

  async describeAt(x: number, y: number) {
    return this.run(describePoint, [x, y])
  }

  async press(combo: string) {
    await this.attach()
    const { key, modifiers, letter } = parseKey(combo)
    if (letter) {
      const event = { key, code: `Key${letter}`, windowsVirtualKeyCode: letter.charCodeAt(0), modifiers }
      // On macOS, Cmd shortcuts only edit text when the editing command is named.
      const command = modifiers & 4 ? { a: 'selectAll', z: 'undo', x: 'cut', c: 'copy', v: 'paste' }[key] : undefined
      const extra = command ? { commands: [command] } : modifiers & ~8 ? {} : { text: modifiers & 8 ? letter : key }
      await cdp(this.target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...extra })
      await cdp(this.target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event })
      return
    }
    const k = KEYS[key]
    const event = { key: key === 'Space' ? ' ' : key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers }
    // Shift+Enter needs its text event too, or editors never insert the line break.
    const withText = k.text && (!modifiers || (key === 'Enter' && modifiers === 8))
    await cdp(this.target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...(withText ? { text: k.text } : {}) })
    await cdp(this.target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event })
  }

  /** Types into whatever has focus. Line breaks become Shift+Enter, which adds a line without sending. */
  async typeText(text: string) {
    await this.attach()
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await cdp(this.target, 'Input.insertText', { text: lines[i] })
      if (i < lines.length - 1) await this.press('Shift+Enter')
    }
  }

  async scroll(dy: number) {
    return this.run(scrollPage, [dy])
  }

  async navigate(url: string) {
    await chrome.tabs.update(this.tabId, { url })
    await new Promise((r) => setTimeout(r, 300))
    await this.waitForLoad()
  }

  async waitForLoad(timeoutMs = 15000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const tab = await chrome.tabs.get(this.tabId)
      if (tab.status === 'complete') return
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  /** JPEG of the viewport, scaled to at most 1280 px wide; also remembers the scale for click_point. */
  async screenshot(): Promise<{ data: string; width: number; height: number }> {
    await this.attach()
    const { data } = await cdp<{ data: string }>(this.target, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 })
    const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const metrics = await cdp<{ cssVisualViewport: { clientWidth: number } }>(this.target, 'Page.getLayoutMetrics')
    const width = Math.min(1280, bitmap.width)
    const height = Math.round((bitmap.height * width) / bitmap.width)
    this.shotScale = metrics.cssVisualViewport.clientWidth / width
    if (width === bitmap.width) return { data, width, height }
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    const scaled = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
    const bytes = new Uint8Array(await scaled.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { data: btoa(binary), width, height }
  }

  async uploadFile(ref: number, file: Blob, name: string) {
    const id = crypto.randomUUID()
    const bytes = new Uint8Array(await file.arrayBuffer())
    let index = 0
    for (let offset = 0; offset < bytes.length; offset += CHUNK, index++) {
      const slice = bytes.subarray(offset, offset + CHUNK)
      let binary = ''
      for (let i = 0; i < slice.length; i += 0x8000) binary += String.fromCharCode(...slice.subarray(i, i + 0x8000))
      await this.run(receiveFileChunk, [id, index, btoa(binary)])
    }
    const result = await this.run(attachFile, [id, ref, name, file.type || 'application/octet-stream'])
    if (result !== 'ok') throw new Error(result)
    this.fileChooserRequested = false
  }
}
