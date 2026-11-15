// A small Markdown renderer for the agent's replies. It builds React elements only (never raw HTML), so
// text the model copied from a web page cannot inject markup into the extension. Links are limited to
// http(s) and mailto and open in a new tab; images render as links instead of loading.

import { Fragment, type ReactNode } from 'react'

const SAFE_URL = /^(https?:\/\/|mailto:)/i

function safeHref(url: string) {
  const trimmed = url.trim().replace(/^<|>$/g, '')
  return SAFE_URL.test(trimmed) ? trimmed : null
}

// ---------- inline ----------

type InlineRule = { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode }

const INLINE: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, key) => <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{m[1]}</code> },
  {
    re: /!?\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/,
    render: (m, key) => {
      const href = safeHref(m[2])
      const label = inline(m[1], key)
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-p1-ink underline underline-offset-2 break-words">
          {label}
        </a>
      ) : (
        <Fragment key={key}>{label}</Fragment>
      )
    },
  },
  {
    re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/,
    render: (m, key) => (
      <a key={key} href={m[0]} target="_blank" rel="noreferrer" className="text-p1-ink underline underline-offset-2 break-all">
        {m[0]}
      </a>
    ),
  },
  { re: /\*\*([^\n]+?)\*\*|__([^\n]+?)__/, render: (m, key) => <strong key={key} className="font-semibold">{inline(m[1] ?? m[2], key)}</strong> },
  { re: /~~([^\n]+?)~~/, render: (m, key) => <del key={key}>{inline(m[1], key)}</del> },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])|(?<!\w)_(?!\s)([^_\n]+?)_(?!\w)/, render: (m, key) => <em key={key}>{inline(m[1] ?? m[2], key)}</em> },
]

/** Renders inline Markdown: code, links, bare URLs, bold, strikethrough, italic. */
export function inline(text: string, prefix = 'i'): ReactNode[] {
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
    out.push(best.rule.render(best.m, `${prefix}.${n++}`))
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
      // A deeper item starts a nested list that runs while lines stay indented.
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

function renderList(list: ListNode, key: string): ReactNode {
  const items = list.items.map((item, i) => (
    <li key={i} className="pl-0.5">
      {item.text.map((line, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {inline(line, `${key}.${i}.${j}`)}
        </Fragment>
      ))}
      {item.children.map((child, j) => renderList(child, `${key}.${i}.c${j}`))}
    </li>
  ))
  return list.ordered ? (
    <ol key={key} start={list.start} className="my-1 list-decimal space-y-0.5 pl-5">
      {items}
    </ol>
  ) : (
    <ul key={key} className="my-1 list-disc space-y-0.5 pl-5">
      {items}
    </ul>
  )
}

const HEADING_CLASS = ['text-base font-semibold', 'text-[15px] font-semibold', 'text-sm font-semibold', 'text-sm font-semibold', 'text-sm font-medium', 'text-sm font-medium']

function blocks(source: string): ReactNode[] {
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
        <pre key={key()} className="my-1 overflow-x-auto rounded-lg bg-muted px-2.5 py-2 font-mono text-xs leading-relaxed">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line)
    if (heading) {
      out.push(
        <p key={key()} role="heading" aria-level={heading[1].length} className={`mt-1 ${HEADING_CLASS[heading[1].length - 1]}`}>
          {inline(heading[2], key())}
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
        <blockquote key={key()} className="my-1 border-l-2 border-p1 pl-2.5 text-muted-foreground">
          {blocks(quoted.join('\n'))}
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
                    {inline(cell, `${k}.h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, c) => (
                    <td key={c} className="border-b border-border/60 px-2 py-1 align-top">
                      {inline(row[c] || '', `${k}.${r}.${c}`)}
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
        // A bullet list right after a numbered one (or the reverse) is a new list.
        const marker = LIST_ITEM.exec(current)
        if (listLines.length && marker && marker[1].length <= first[1].length && /\d/.test(marker[2]) !== ordered) break
        if (!current.trim()) {
          // A blank line ends the list unless the next line continues it.
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
      out.push(renderList(parseList(listLines), key()))
      continue
    }

    // A paragraph runs until a blank line or the start of another block. Single newlines stay as line breaks,
    // which is how chat replies are usually written.
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
            {inline(text, `${k}.${j}`)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`space-y-1.5 break-words ${className || ''}`}>{blocks(text)}</div>
}
