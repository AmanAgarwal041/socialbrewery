// Markdown for Brew's replies and tool results. It builds React elements only (never raw HTML), so text
// the assistant quoted from a web page cannot inject markup. Links are http(s) or mailto and open in a new
// tab. Media shows inline: Markdown images and bare image links over https, video files (https or the
// organisation's own `/api/media/<id>`), and YouTube links as a thumbnail card. Images load without a
// referrer.

import { Fragment, useState, type ReactNode } from 'react'
import { Play } from 'lucide-react'

const SAFE_URL = /^(https?:\/\/|mailto:)/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?[^\s]*)?$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?[^\s]*)?$/i
const OWN_MEDIA = /^\/api\/media\/[0-9a-f-]{36}$/i

function safeHref(url: string) {
  const trimmed = url.trim().replace(/^<|>$/g, '')
  return SAFE_URL.test(trimmed) ? trimmed : null
}

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    let id = ''
    if (host === 'youtu.be') id = u.pathname.slice(1)
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') || (/^\/(shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[2] ?? '')
    }
    return /^[\w-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

type Media = { kind: 'image' | 'video' | 'youtube'; url: string; id?: string; alt?: string }

function mediaFor(url: string): Media | null {
  if (OWN_MEDIA.test(url)) return { kind: 'video', url }
  if (!/^https:\/\//i.test(url)) return null
  const yt = youtubeId(url)
  if (yt) return { kind: 'youtube', url, id: yt }
  if (VIDEO_EXT.test(url)) return { kind: 'video', url }
  if (IMAGE_EXT.test(url)) return { kind: 'image', url }
  return null
}

function InlineImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="text-p1-ink underline underline-offset-2 break-all">
        {alt || src}
      </a>
    )
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="my-1 block w-fit">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="max-h-80 max-w-full rounded-xl border bg-muted/40 object-contain"
      />
    </a>
  )
}

function MediaView({ media }: { media: Media }) {
  if (media.kind === 'image') return <InlineImage src={media.url} alt={media.alt || ''} />
  if (media.kind === 'video') {
    return <video controls preload="metadata" src={media.url} className="max-h-80 max-w-full rounded-xl border bg-black/5" />
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block w-64 max-w-full overflow-hidden rounded-xl border bg-black/5"
      aria-label="Open on YouTube"
    >
      <img
        src={`https://i.ytimg.com/vi/${media.id}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="aspect-video w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover:bg-black/25">
        <span className="flex size-10 items-center justify-center rounded-full bg-black/70 text-white">
          <Play className="size-4 fill-current" />
        </span>
      </span>
    </a>
  )
}

// ---------- inline ----------

type Ctx = { media: Media[]; seen: Set<string> }
type InlineRule = { re: RegExp; render: (m: RegExpExecArray, key: string, ctx: Ctx) => ReactNode }

function collect(ctx: Ctx, url: string) {
  const media = mediaFor(url)
  if (media && !ctx.seen.has(url)) {
    ctx.seen.add(url)
    ctx.media.push(media)
  }
}

const LINK_CLASS = 'text-p1-ink underline underline-offset-2'

const INLINE: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, key) => <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[1]}</code> },
  {
    // ![alt](url): an image (https only), shown where it is written.
    re: /!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/,
    render: (m, key, ctx) => {
      const href = safeHref(m[2])
      if (href && /^https:\/\//i.test(href)) {
        ctx.seen.add(href)
        return <InlineImage key={key} src={href} alt={m[1]} />
      }
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer" className={`${LINK_CLASS} break-words`}>
          {m[1] || href}
        </a>
      ) : (
        <Fragment key={key}>{m[1]}</Fragment>
      )
    },
  },
  {
    re: /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/,
    render: (m, key, ctx) => {
      const href = safeHref(m[2]) || (OWN_MEDIA.test(m[2].trim()) ? m[2].trim() : null)
      const label = inline(m[1], key, ctx)
      if (!href) return <Fragment key={key}>{label}</Fragment>
      collect(ctx, href)
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer" className={`${LINK_CLASS} break-words`}>
          {label}
        </a>
      )
    },
  },
  {
    re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]*_]/,
    render: (m, key, ctx) => {
      collect(ctx, m[0])
      return (
        <a key={key} href={m[0]} target="_blank" rel="noreferrer" className={`${LINK_CLASS} break-all`}>
          {m[0]}
        </a>
      )
    },
  },
  { re: /\*\*([^\n]+?)\*\*|__([^\n]+?)__/, render: (m, key, ctx) => <strong key={key} className="font-semibold">{inline(m[1] ?? m[2], key, ctx)}</strong> },
  { re: /~~([^\n]+?)~~/, render: (m, key, ctx) => <del key={key}>{inline(m[1], key, ctx)}</del> },
  {
    re: /(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])|(?<!\w)_(?!\s)([^_\n]+?)_(?!\w)/,
    render: (m, key, ctx) => <em key={key}>{inline(m[1] ?? m[2], key, ctx)}</em>,
  },
]

function inline(text: string, prefix: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    let best: { rule: InlineRule; m: RegExpExecArray } | null = null
    for (const rule of INLINE) {
      const m = rule.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { rule, m }
    }
    if (!best) {
      out.push(rest)
      break
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index))
    out.push(best.rule.render(best.m, `${prefix}.${n++}`, ctx))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return out
}

// ---------- blocks ----------

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

type ListNode = { ordered: boolean; start: number; items: { text: string[]; children: ListNode[] }[] }

function parseList(lines: string[]): ListNode {
  const first = LIST_ITEM.exec(lines[0])!
  const baseIndent = first[1].length
  const ordered = /\d/.test(first[2])
  const list: ListNode = { ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] }
  let i = 0
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i])
    if (m && m[1].length <= baseIndent) {
      list.items.push({ text: [m[3]], children: [] })
      i++
      continue
    }
    const item = list.items[list.items.length - 1]
    if (m) {
      const nested: string[] = []
      while (i < lines.length) {
        const nm = LIST_ITEM.exec(lines[i])
        if (nm && nm[1].length <= baseIndent) break
        nested.push(lines[i])
        i++
      }
      item.children.push(parseList(nested))
      continue
    }
    item.text.push(lines[i].trim())
    i++
  }
  return list
}

function renderList(list: ListNode, key: string, ctx: Ctx): ReactNode {
  const items = list.items.map((item, i) => (
    <li key={i} className="pl-0.5">
      {item.text.map((line, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {inline(line, `${key}.${i}.${j}`, ctx)}
        </Fragment>
      ))}
      {item.children.map((child, j) => renderList(child, `${key}.${i}.c${j}`, ctx))}
    </li>
  ))
  return list.ordered ? (
    <ol key={key} start={list.start} className="my-1 list-decimal space-y-1 pl-5">
      {items}
    </ol>
  ) : (
    <ul key={key} className="my-1 list-disc space-y-1 pl-5">
      {items}
    </ul>
  )
}

const HEADING_CLASS = ['text-lg font-semibold', 'text-base font-semibold', 'text-[15px] font-semibold', 'text-sm font-semibold', 'text-sm font-medium', 'text-sm font-medium']

function blocks(source: string, ctx: Ctx): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const key = () => `b${out.length}`

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++])
      i++
      out.push(
        <pre key={key()} className="my-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line)
    if (heading) {
      out.push(
        <p key={key()} role="heading" aria-level={heading[1].length} className={`mt-2 ${HEADING_CLASS[heading[1].length - 1]}`}>
          {inline(heading[2], key(), ctx)}
        </p>,
      )
      i++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key()} className="my-2 border-border" />)
      i++
      continue
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(
        <blockquote key={key()} className="my-1 border-l-2 border-p1 pl-3 text-muted-foreground">
          {blocks(quoted.join('\n'), ctx)}
        </blockquote>,
      )
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      const k = key()
      out.push(
        <div key={k} className="my-1 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th key={c} className="border-b border-border px-2 py-1 text-left font-semibold">
                    {inline(cell, `${k}.h${c}`, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, c) => (
                    <td key={c} className="border-b border-border/60 px-2 py-1 align-top">
                      {inline(row[c] || '', `${k}.${r}.${c}`, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (LIST_ITEM.test(line)) {
      const listLines: string[] = []
      const first = LIST_ITEM.exec(line)!
      const ordered = /\d/.test(first[2])
      while (i < lines.length) {
        const current = lines[i]
        const marker = LIST_ITEM.exec(current)
        if (listLines.length && marker && marker[1].length <= first[1].length && /\d/.test(marker[2]) !== ordered) break
        if (!current.trim()) {
          const next = lines[i + 1]
          if (next !== undefined && (LIST_ITEM.test(next) || /^\s{2,}\S/.test(next))) {
            i++
            continue
          }
          break
        }
        if (listLines.length && !LIST_ITEM.test(current) && !/^\s+\S/.test(current)) break
        listLines.push(current)
        i++
      }
      out.push(renderList(parseList(listLines), key(), ctx))
      continue
    }

    // A paragraph runs until a blank line or another block. Single newlines stay as line breaks.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !(para.length && (/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) || LIST_ITEM.test(lines[i])))
    ) {
      para.push(lines[i++])
    }
    const k = key()
    out.push(
      <p key={k} className="my-0.5">
        {para.map((text, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(text, `${k}.${j}`, ctx)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return out
}

/** Renders Markdown, then any images, videos, and YouTube links it mentions as media below the text. */
export function Markdown({ text, className, media = true }: { text: string; className?: string; media?: boolean }) {
  const ctx: Ctx = { media: [], seen: new Set() }
  const body = blocks(text || '', ctx)
  return (
    <div className={`space-y-1.5 break-words ${className || ''}`}>
      {body}
      {media && ctx.media.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {ctx.media.slice(0, 6).map((m) => (
            <MediaView key={m.url} media={m} />
          ))}
        </div>
      )}
    </div>
  )
}
