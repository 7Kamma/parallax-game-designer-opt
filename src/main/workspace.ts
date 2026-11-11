import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, opendir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import type { WorkspaceExcerpt, WorkspaceRef, WorkspaceSearchResult } from '../shared/bridge'

const FILE_LIMIT = 512 * 1024
const SCAN_LIMIT = 24 * 1024 * 1024
const ENTRY_LIMIT = 8000
const EXCERPT_LIMIT = 6
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text'])
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })
const COMMON_WORDS = new Set('the a an is to in of for and or with how what can does please this that from on about'.split(' '))

export class WorkspaceFolders {
  private folders = new Map<string, string>()
  private pending = Promise.resolve()

  constructor(private readonly file: string) {}

  async load() {
    try {
      const entries: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!Array.isArray(entries)) return
      for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && isAbsolute(entry[1])) {
          this.folders.set(entry[0], entry[1])
        }
      }
    } catch {
      // A missing registry is normal on first launch.
    }
  }

  path(id?: string): string | undefined {
    return id === undefined ? undefined : this.folders.get(id)
  }

  async add(path: string): Promise<WorkspaceRef> {
    const root = await realpath(path)
    if (!(await lstat(root)).isDirectory()) throw new Error('Choose a workspace folder.')
    let id = ''
    const save = this.pending.catch(() => undefined).then(async () => {
      id = [...this.folders].find(([, folder]) => folder === root)?.[0] ?? ''
      if (id) return
      id = randomUUID()
      const next = new Map(this.folders).set(id, root)
      const tmp = this.file + '.tmp'
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify([...next]), { mode: 0o600 })
      await rename(tmp, this.file)
      this.folders = next
    })
    this.pending = save
    await save
    return { id, name: basename(root) || 'Workspace' }
  }

  search(id: string, queries: unknown, signal: AbortSignal): Promise<WorkspaceSearchResult> {
    const root = this.path(id)
    if (!root) throw new Error('Choose the workspace folder again on this device.')
    return searchWorkspace(root, queries, signal)
  }
}

function inside(root: string, path: string): boolean {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)
}

async function readDocument(root: string, path: string): Promise<{ text: string; bytes: number } | undefined> {
  const entry = await lstat(path, { bigint: true })
  if (!entry.isFile() || entry.nlink !== 1n || entry.size > BigInt(FILE_LIMIT)) return
  const actual = await realpath(path)
  if (!inside(root, actual)) return
  const file = await open(actual, 'r')
  try {
    const opened = await file.stat({ bigint: true })
    if (opened.dev !== entry.dev || opened.ino !== entry.ino || !opened.isFile() || opened.nlink !== 1n) return
    if (opened.size > BigInt(FILE_LIMIT) || !inside(root, await realpath(actual))) return
    const buffer = Buffer.alloc(Number(opened.size) + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, bytes)
      if (!bytesRead) break
      bytes += bytesRead
    }
    if (bytes === buffer.length) return
    const encoding = buffer[0] === 255 && buffer[1] === 254 ? 'utf-16le'
      : buffer[0] === 254 && buffer[1] === 255 ? 'utf-16be'
        : 'utf-8'
    const text = new TextDecoder(encoding, { fatal: true }).decode(buffer.subarray(0, bytes))
    if (!text.includes('\0')) return { text, bytes }
  } finally {
    await file.close()
  }
}

function matcher(queries: unknown) {
  if (!Array.isArray(queries) || queries.length > 4 || queries.some((query) => typeof query !== 'string' || query.length > 220)) {
    throw new Error('Invalid workspace search queries.')
  }
  const patterns = queries.map((query: string) => {
    const phrase = query.trim().toLowerCase()
    const terms = [...WORDS.segment(phrase)]
      .filter(({ isWordLike, segment }) => isWordLike && (segment.length > 1 || /\p{Script=Han}/u.test(segment)) && !COMMON_WORDS.has(segment))
      .map(({ segment }) => segment)
    return { phrase, terms: [...new Set(terms)].slice(0, 10) }
  }).filter(({ terms }) => terms.length > 0)
  return (value: string) => {
    const text = value.toLowerCase()
    let best = 0
    for (const { phrase, terms } of patterns) {
      let count = 0
      for (const term of terms) if (text.includes(term)) count++
      best = Math.max(best, (text.includes(phrase) ? 8 : 0) + count)
    }
    return best
  }
}

type Hit = { excerpt: WorkspaceExcerpt; score: number }

function findExcerpts(text: string, file: string, score: (text: string) => number, keep: (hit: Hit) => void) {
  const lines = text.split(/\r\n|\n|\r/)
  const headings: string[] = []
  const pathScore = score(file)
  const markdown = /\.(md|markdown)$/i.test(file)
  let fence = ''
  let start = 0
  let bestLine = 0
  let bestScore = 0
  let section = ''
  let sectionScore = 0

  const finish = (end: number) => {
    if (!bestScore || start >= end) return
    const first = Math.max(start, bestLine - 3)
    const last = Math.min(end, first + 10)
    const snippet = lines.slice(first, last).join('\n').trim()
    if (snippet) {
      keep({
        excerpt: { file, section, firstLine: first + 1, lastLine: last, text: snippet.slice(0, 1400) },
        score: bestScore,
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = markdown && line.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1].startsWith(fence) && !marker[2].trim()) fence = ''
    }
    const heading = markdown && !fence && line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/)
    const underline = markdown && !fence && i + 1 < lines.length && line.trim() && !/^[ \t]*[-=*\x60~]/.test(line)
      && lines[i + 1].match(/^ {0,3}(=+|-+)\s*$/)
    if (heading || underline) {
      finish(i)
      const level = heading ? heading[1].length : underline && underline[1][0] === '=' ? 1 : 2
      headings.length = level
      headings[level - 1] = (heading ? heading[2].replace(/[ \t]+#+$/, '') : line.trim()).slice(0, 160)
      section = headings.filter(Boolean).join(' › ').slice(0, 400)
      sectionScore = score(section)
      start = i
      bestLine = i
      bestScore = sectionScore * 2 + pathScore
      if (underline) i++
      continue
    }
    if (!line.trim()) continue
    const value = score(line) * 3 + sectionScore * 2 + pathScore
    if (value > bestScore) {
      bestScore = value
      bestLine = i
    }
  }
  finish(lines.length)
}

export async function searchWorkspace(root: string, queries: unknown, signal: AbortSignal): Promise<WorkspaceSearchResult> {
  const score = matcher(queries)
  if (await realpath(root).catch(() => '') !== root) throw new Error('Workspace folder moved or is unavailable. Choose it again.')
  const hits: Hit[] = []
  const keep = (hit: Hit) => {
    hits.push(hit)
    hits.sort((a, b) => b.score - a.score || a.excerpt.file.localeCompare(b.excerpt.file))
    if (hits.length > EXCERPT_LIMIT) hits.pop()
  }
  const dirs = [root]
  let entries = 0
  let bytes = 0
  let limited = false
  while (dirs.length) {
    signal.throwIfAborted()
    const path = dirs.pop()!
    const actual = await realpath(path).catch(() => '')
    if (!actual || !inside(root, actual)) continue
    const dir = await opendir(actual).catch(() => undefined)
    if (!dir) {
      if (path === root) throw new Error('Workspace folder cannot be read.')
      limited = true
      continue
    }
    for await (const entry of dir) {
      signal.throwIfAborted()
      if (++entries > ENTRY_LIMIT || bytes >= SCAN_LIMIT) return { excerpts: hits.map(({ excerpt }) => excerpt), limited: true }
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const child = join(actual, entry.name)
      if (entry.isDirectory()) dirs.push(child)
      else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        try {
          const document = await readDocument(root, child)
          if (document) {
            bytes += document.bytes
            findExcerpts(document.text, relative(root, child).split(sep).join('/'), score, keep)
          } else limited = true
        } catch {
          limited = true
        }
      }
    }
  }
  return { excerpts: hits.map(({ excerpt }) => excerpt), limited }
}
