// Finding `! commands` in one block of a reply, and deciding how the block is drawn.
// Pure: no `$`, nothing but strings in and plain data out, so every rule here is covered
// by tests/commands.test.ts. register.tsx only draws what `parseBlock()` returns.

export type Options = { bashBlocks: boolean }

// How [ Copy all ] and [ Run all ] join commands: the `joinWith` option's values.
export type Joiner = '&&' | ';' | 'newline'

// One command with buttons. `text` is exactly what the row shows and, after its bang,
// what Copy copies and Run runs. `isFromBash`: a line of a plain bash fence (the `bashBlocks`
// option), which had no `!` of its own. `n` counts the block's commands from 0.
export type Command = { text: string; n: number; isFromBash: boolean; isMultiline: boolean }

// Commands drawn together as rows: a fence of commands (`isFramed` with two or more), a
// list of commands, or command lines that follow one another. `g` counts the block's
// groups from 0; `hasAll`: two or more commands, none of them multi-line.
export type Group = { g: number; commands: Command[]; isFramed: boolean; hasAll: boolean }

export type Part = { kind: 'markdown'; text: string } | { kind: 'commands'; group: Group }

// `inline`: the block cut between top-level blocks, commands drawn as rows where they
// stood. `footer`: some command sits where the block must not be cut (a span
// mid-sentence, a list item among others, a table, a fence with other lines), so the
// block is drawn whole and the commands follow it. `none`: no command, the engine draws.
export type Parsed =
  | { layout: 'none' }
  | { layout: 'inline'; hash: string; parts: Part[]; commands: Command[] }
  | { layout: 'footer'; hash: string; commands: Command[] }

export const MAX_COMMAND_CHARS = 4000
export const MAX_COMMANDS = 30

// Fences whose lines are data, never commands, whatever they start with.
const DATA_LANGS = ['diff', 'patch', 'json', 'yaml', 'text', 'markdown', 'md']
// Fences the `bashBlocks` option reads line by line.
const BASH_LANGS = ['bash', 'sh', 'shell', 'zsh', 'console', 'terminal']
// Transcripts: a line with a prompt is a command, one without is its output.
const TRANSCRIPT_LANGS = ['console', 'terminal']

// A command outside a fence: bang, space, then a word - so `![img](x)`, `!=`,
// `!important` and `!!` never count.
const BANG_LINE = /^!\s+\S/
// Inside a fence the space is optional (`!git status`), but a bang that starts another
// syntax is not a command: `!=`, `![`, `!!`, `!$`, `!-1`.
const FENCE_BANG = /^!\s?(?![=[!$]|-\d)\S/
const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/
const QUOTE = /^ {0,3}>/
const TABLE = /^ {0,3}\|/
const WHOLE_SPAN = /^ {0,3}(`+)\s*(![^`]*?)\s*\1\s*$/
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/

type Found = { text: string; isFromBash: boolean }
type Block =
  | { kind: 'md'; lines: string[]; nested: Found[] }
  | { kind: 'rows'; lines: string[]; found: Found[]; isFence: boolean; isAdjacent: boolean }

// FNV-1a over the text's code points, as 8 hex digits: a block's buttons keep their keys
// across redraws, and two replies' buttons never share one.
export function blockHash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Characters, not UTF-16 units: an emoji is one.
const charCount = (text: string) => [...text].length

// A command gets a button only when what the box would take is what the row shows: no
// control character but tab and newline, and no longer than anything a person types.
export function isPlaceable(text: string): boolean {
  return text.trim() !== '' && !CONTROL.test(text) && charCount(text) <= MAX_COMMAND_CHARS
}

// The command that starts at `lines[i]` (already a command line), with the lines a shell
// would read as part of it: ` \` continuations and a heredoc up to its terminator.
// Returns the joined text and the index after its last line.
function takeCommand(lines: string[], i: number, first: string): { text: string; next: number } {
  const taken = [first]
  let k = i + 1
  let last = first
  while (/ \\$/.test(last) && k < lines.length) {
    last = lines[k] ?? ''
    taken.push(last)
    k += 1
  }
  const doc = HEREDOC.exec(taken.join('\n'))
  if (doc) {
    const tag = doc[2] ?? ''
    const isDash = /<<-/.test(doc[0])
    while (k < lines.length) {
      const line = lines[k] ?? ''
      taken.push(line)
      k += 1
      if ((isDash ? line.trim() : line) === tag) break
    }
  }
  return { text: taken.join('\n').trimEnd(), next: k }
}

// The commands among a fence's lines, and whether they are all it holds (blank lines
// aside): only then may the fence be redrawn as rows.
function fenceCommands(body: string[], lang: string, options: Options): { found: Found[]; isAll: boolean } {
  if (DATA_LANGS.includes(lang)) return { found: [], isAll: false }
  const isBash = options.bashBlocks && BASH_LANGS.includes(lang)
  const isTranscript = isBash && TRANSCRIPT_LANGS.includes(lang) && body.some(line => /^\s*[$%] \S/.test(line))
  const found: Found[] = []
  let others = 0
  let i = 0
  while (i < body.length) {
    const line = (body[i] ?? '').trimStart()
    if (line.trim() === '') {
      i += 1
    } else if (FENCE_BANG.test(line)) {
      const cmd = takeCommand(body, i, line)
      found.push({ text: cmd.text, isFromBash: false })
      i = cmd.next
    } else if (isBash && !line.startsWith('#') && (!isTranscript || /^[$%] \S/.test(line))) {
      const bare = isTranscript || /^[$%] \S/.test(line) ? line.slice(2) : line
      const cmd = takeCommand(body, i, bare)
      found.push({ text: `! ${cmd.text}`, isFromBash: true })
      i = cmd.next
    } else {
      others += 1
      i += 1
    }
  }
  return { found, isAll: found.length > 0 && others === 0 }
}

// A fence opening at `lines[i]`: its info string's language and the index of its closing
// line, or -1 while it is still open (a reply that is streaming).
function fenceAt(lines: string[], i: number): { lang: string; close: number } | undefined {
  const open = FENCE_OPEN.exec(lines[i] ?? '')
  if (!open) return undefined
  const marks = open[2] ?? '```'
  if (marks.startsWith('`') && (open[3] ?? '').includes('`')) return undefined
  const lang = ((open[3] ?? '').trim().split(/\s+/)[0] ?? '').toLowerCase()
  const closing = new RegExp(`^ *${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`)
  for (let k = i + 1; k < lines.length; k += 1) {
    if (closing.test(lines[k] ?? '')) return { lang, close: k }
  }
  return { lang, close: -1 }
}

// The `! ...` code spans of one line: `` `! npm login` `` mid-sentence.
function spansIn(line: string): Found[] {
  const found: Found[] = []
  for (const span of line.matchAll(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) {
    const text = (span[2] ?? '').trim()
    if (BANG_LINE.test(text)) found.push({ text, isFromBash: false })
  }
  return found
}

// Every command inside lines that must not be cut (a list, a table, an indented block):
// fences at any depth, command lines after their indentation or list marker, and spans.
// Quote lines hold none.
function nestedIn(lines: string[], options: Options): Found[] {
  const found: Found[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = fenceAt(lines, i)
    if (fence) {
      const end = fence.close === -1 ? lines.length : fence.close
      found.push(...fenceCommands(lines.slice(i + 1, end), fence.lang, options).found)
      i = end + 1
      continue
    }
    if (QUOTE.test(line)) {
      i += 1
      continue
    }
    const content = (LIST_ITEM.exec(line)?.[4] ?? line).trimStart()
    if (BANG_LINE.test(content)) {
      const cmd = takeCommand(lines, i, content)
      found.push({ text: cmd.text, isFromBash: false })
      i = cmd.next
      continue
    }
    found.push(...spansIn(line))
    i += 1
  }
  return found
}

// The command a list item or a top-level line is by itself, if it is one: a command line,
// or a line that is one `! ...` span and nothing else.
function lineCommand(content: string): string | undefined {
  if (BANG_LINE.test(content)) return content.trimEnd()
  const span = WHOLE_SPAN.exec(content)
  if (span && BANG_LINE.test(span[2] ?? '')) return (span[2] ?? '').trim()
  return undefined
}

// The list that starts at `lines[i]`: its items, each with the lines that belong to it,
// and the index after it. Blank lines inside stay with the list only when more of it
// follows.
function listAt(lines: string[], i: number): { items: string[][]; next: number } {
  const items: string[][] = []
  let k = i
  while (k < lines.length) {
    const line = lines[k] ?? ''
    if (LIST_ITEM.test(line)) {
      items.push([line])
      k += 1
      continue
    }
    const item = items[items.length - 1]
    if (!item) break
    if (line.trim() === '') {
      let m = k
      while (m < lines.length && (lines[m] ?? '').trim() === '') m += 1
      const after = lines[m] ?? ''
      if (m >= lines.length || !(LIST_ITEM.test(after) || /^\s{2,}\S/.test(after))) break
      for (; k < m; k += 1) item.push(lines[k] ?? '')
      continue
    }
    const isIndented = /^\s+\S/.test(line)
    const isLazy = (lines[k - 1] ?? '').trim() !== '' && !FENCE_OPEN.test(line) && !QUOTE.test(line)
    if (!isIndented && !isLazy) break
    const fence = isIndented ? fenceAt(lines, k) : undefined
    const end = fence ? (fence.close === -1 ? lines.length - 1 : fence.close) : k
    for (; k <= end; k += 1) item.push(lines[k] ?? '')
  }
  return { items, next: k }
}

// The block cut into top-level blocks: markdown (with the commands nested in it) and rows.
function splitBlocks(lines: string[], options: Options): Block[] {
  const blocks: Block[] = []
  const md = (taken: string[], nested: Found[] = []) => blocks.push({ kind: 'md', lines: taken, nested })
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = fenceAt(lines, i)
    if (fence) {
      const end = fence.close === -1 ? lines.length - 1 : fence.close
      const taken = lines.slice(i, end + 1)
      const body = lines.slice(i + 1, fence.close === -1 ? lines.length : end)
      const { found, isAll } = fenceCommands(body, fence.lang, options)
      const indent = /^ */.exec(line)?.[0].length ?? 0
      if (isAll && indent <= 3 && fence.close !== -1) {
        blocks.push({ kind: 'rows', lines: taken, found, isFence: true, isAdjacent: false })
      } else {
        md(taken, found)
      }
      i = end + 1
    } else if (QUOTE.test(line)) {
      md([line])
      i += 1
    } else if (LIST_ITEM.test(line)) {
      const list = listAt(lines, i)
      const taken = lines.slice(i, list.next)
      const own = list.items.map(item => {
        const rest = item.slice(1).filter(l => l.trim() !== '')
        return rest.length === 0 ? lineCommand(LIST_ITEM.exec(item[0] ?? '')?.[4] ?? '') : undefined
      })
      if (own.every(cmd => cmd !== undefined)) {
        const found = own.map(text => ({ text: text ?? '', isFromBash: false }))
        blocks.push({ kind: 'rows', lines: taken, found, isFence: false, isAdjacent: false })
      } else {
        md(taken, nestedIn(taken, options))
      }
      i = list.next
    } else if (TABLE.test(line) || /^ {4,}\S/.test(line)) {
      md([line], nestedIn([line], options))
      i += 1
    } else {
      const own = lineCommand(line.trimStart())
      if (own !== undefined) {
        const cmd = BANG_LINE.test(line.trimStart()) ? takeCommand(lines, i, own) : { text: own, next: i + 1 }
        const prev = blocks[blocks.length - 1]
        const taken = lines.slice(i, cmd.next)
        // a blank line between would be a markdown block of its own
        const isAdjacent = prev?.kind === 'rows' && !prev.isFence
        blocks.push({ kind: 'rows', lines: taken, found: [{ text: cmd.text, isFromBash: false }], isFence: false, isAdjacent })
        i = cmd.next
      } else {
        md([line], spansIn(line))
        i += 1
      }
    }
  }
  return blocks
}

// Top-level command lines with nothing between them are one group: one block of
// commands, so [ ↓ All to prompt ] can join them. A blank line between keeps them apart.
function mergeAdjacent(blocks: Block[]): Block[] {
  const merged: Block[] = []
  for (const block of blocks) {
    const prev = merged[merged.length - 1]
    if (block.kind === 'rows' && block.isAdjacent && prev?.kind === 'rows') {
      merged[merged.length - 1] = { ...prev, lines: [...prev.lines, ...block.lines], found: [...prev.found, ...block.found] }
    } else {
      merged.push(block)
    }
  }
  return merged
}

// Applies the limits: a command that cannot be placed gets no button, and at most
// MAX_COMMANDS per block do. Rows that lose a command go back to being markdown, drawn as
// the model wrote them, and their placeable commands follow the block.
function applyLimits(blocks: Block[]): Block[] {
  let room = MAX_COMMANDS
  return blocks.map(block => {
    const found = block.kind === 'md' ? block.nested : block.found
    const placeable = found.filter(f => isPlaceable(f.text))
    const kept = placeable.slice(0, Math.max(0, room))
    room -= kept.length
    if (block.kind === 'rows' && kept.length === found.length) return block
    return { kind: 'md', lines: block.lines, nested: kept }
  })
}

const asMarkdown = (lines: string[]) => lines.join('\n').replace(/^\n+|\n+$/g, '')

// One block of a reply, as markdown, read for commands and laid out for drawing.
export function parseBlock(markdown: string, options: Options): Parsed {
  const lines = markdown.split(/\r?\n/)
  const blocks = applyLimits(mergeAdjacent(splitBlocks(lines, options)))
  const hash = blockHash(markdown)
  let n = 0
  const toCommand = (f: Found): Command => ({
    text: f.text,
    n: n++,
    isFromBash: f.isFromBash,
    isMultiline: f.text.includes('\n'),
  })

  if (blocks.some(block => block.kind === 'md' && block.nested.length > 0)) {
    const commands = blocks.flatMap(block => (block.kind === 'md' ? block.nested : block.found)).map(toCommand)
    return { layout: 'footer', hash, commands }
  }
  if (!blocks.some(block => block.kind === 'rows')) return { layout: 'none' }

  const parts: Part[] = []
  const commands: Command[] = []
  let pending: string[] = []
  let g = 0
  const flush = () => {
    const text = asMarkdown(pending)
    if (text.trim() !== '') parts.push({ kind: 'markdown', text })
    pending = []
  }
  for (const block of blocks) {
    if (block.kind === 'md') {
      pending.push(...block.lines)
      continue
    }
    flush()
    const group = block.found.map(toCommand)
    commands.push(...group)
    parts.push({
      kind: 'commands',
      group: {
        g: g++,
        commands: group,
        isFramed: block.isFence && group.length > 1,
        hasAll: group.length > 1 && group.every(cmd => !cmd.isMultiline),
      },
    })
  }
  flush()
  return { layout: 'inline', hash, parts, commands }
}

// [ ↓ All to prompt ]: one command line for the whole group, `! a && b && c`. Undefined
// when any command spans lines: joining those blindly could change what they do.
export function joinAll(commands: readonly Command[], joiner: Joiner): string | undefined {
  if (commands.length === 0 || commands.some(cmd => cmd.isMultiline)) return undefined
  const bodies = commands.map(cmd => cmd.text.replace(/^!\s*/, ''))
  const glue = joiner === 'newline' ? '\n' : joiner === ';' ? '; ' : ' && '
  return `! ${bodies.join(glue)}`
}

// The `joinWith` option's value as a Joiner; anything else is the default.
export function joinerOf(value: unknown): Joiner {
  return value === ';' || value === 'newline' ? value : '&&'
}

// The run's row in the transcript is one line: the engine draws a line break in it as a
// stray glyph. The full output is in the plugin's message to the model, right below.
const LOG_LINES = 3
const LOG_CHARS = 120
const LOG_COMMAND_CHARS = 60
const LOG_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f]/g

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// `ran \`cmd\` → what it printed`: up to three short lines inline, joined with ⏎; more,
// or output the run cut at `maxChars`, as a count of lines.
export function runLog(command: string, output: string, opts: { isError: boolean; maxChars: number }): string {
  const shown = clip(command.split('\n')[0] + (command.includes('\n') ? ' …' : ''), LOG_COMMAND_CHARS)
  const head = `ran \`${shown}\`${opts.isError ? ' · failed' : ''}`
  const text = output.replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '')
  if (text === '') return `${head} → no output`
  const lines = text.split('\n')
  const isCut = output.length > opts.maxChars
  if (lines.length <= LOG_LINES && !isCut) {
    const inline = lines.map(line => line.replace(/\t/g, ' ').replace(LOG_CONTROLS, '').trim()).join(' ⏎ ')
    return `${head} → ${clip(inline, LOG_CHARS)}`
  }
  const count = `${grouped(lines.length)} ${lines.length === 1 ? 'line' : 'lines'}`
  return `${head} → ${count}, ${isCut ? `first ${grouped(opts.maxChars)} chars ` : ''}sent to Claude`
}

// What a refused run says to the person. The engine's reason is written for the model
// ("Issue the action again once…"), so it never reaches the screen: the register module
// sends it to the debug log. Auto mode's classifier judges a call against the model
// request that asked for it; a press has none, so the classifier gives no verdict and the
// engine refuses. Anything else is a deny rule or a No in the permission dialog. The
// first clause carries the point: a toast box cuts the rest off.
export const REFUSED = {
  noVerdict: "Not run: auto mode can't approve a button press. Run it in your terminal, or add an allow rule for it.",
  denied: "Not run: Claude Code's permission check refused it - a deny rule, or No in the dialog.",
}

export function refusalToast(reason: string): string {
  return /classifier/i.test(reason) && /no verdict/i.test(reason) ? REFUSED.noVerdict : REFUSED.denied
}
