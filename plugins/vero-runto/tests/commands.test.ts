import { describe, expect, test } from 'claude-code/testing'

import { MAX_COMMANDS, blockHash, isPlaceable, joinAll, joinerOf, parseBlock, runLog } from '../hooks/commands'
import type { Command, Parsed } from '../hooks/commands'

// The parser's table: which text is a command, which is not, and how a block is laid
// out. Each case is one test, named by what it holds.

const OFF = { bashBlocks: false }
const ON = { bashBlocks: true }

const commandsOf = (parsed: Parsed): string[] => (parsed.layout === 'none' ? [] : parsed.commands.map(c => c.text))
const fence = (lang: string, ...lines: string[]) => ['```' + lang, ...lines, '```'].join('\n')

// [name, markdown, the commands found, the layout]
type Case = [string, string, string[], Parsed['layout']]

const FOUND: Case[] = [
  ['a command line of its own', 'Please log in:\n\n! gcloud auth login\n\nThen tell me.', ['! gcloud auth login'], 'inline'],
  ['a command line right under prose', 'Please log in:\n! gh auth login', ['! gh auth login'], 'inline'],
  ['a command alone in the block', '! npm login', ['! npm login'], 'inline'],
  ['two commands in two paragraphs', '! a one\n\n! b two', ['! a one', '! b two'], 'inline'],
  ['a command indented up to three spaces', '   ! ls -la', ['! ls -la'], 'inline'],
  ['several spaces after the bang', '!   make test', ['!   make test'], 'inline'],
  ['a single-item list of a command', '- ! gh auth login', ['! gh auth login'], 'inline'],
  ['a numbered list of commands', '1. ! npm ci\n2. ! npm test', ['! npm ci', '! npm test'], 'inline'],
  ['a loose list of commands', '- ! npm ci\n\n- ! npm test', ['! npm ci', '! npm test'], 'inline'],
  ['a list item that is one span', '* `! docker login`', ['! docker login'], 'inline'],
  ['a line that is one span', '`! npm login`', ['! npm login'], 'inline'],
  ['a span mid-sentence', 'Please run `! npm login` and retry.', ['! npm login'], 'footer'],
  ['two spans in one sentence', 'Run `! npm login`; if that fails, `! npm whoami` shows the account.', ['! npm login', '! npm whoami'], 'footer'],
  ['a span in a table cell', '| step | command |\n| --- | --- |\n| 1 | `! make` |', ['! make'], 'footer'],
  ['a span in a list among prose items', '- first read the docs\n- then run `! make docs`', ['! make docs'], 'footer'],
  ['a command item among prose items', '- read the docs\n- ! make docs', ['! make docs'], 'footer'],
  ['a command in a nested list', '- setup\n  - ! npm ci', ['! npm ci'], 'footer'],
  ['a fence of one command', fence('', '! gh auth login'), ['! gh auth login'], 'inline'],
  ['a fence of commands', fence('bash', '! sudo apt-get update', '! sudo apt-get install -y build-essential'), ['! sudo apt-get update', '! sudo apt-get install -y build-essential'], 'inline'],
  ['a fence command with no space after the bang', fence('', '!git status'), ['!git status'], 'inline'],
  ['a fence of any language', fence('python', '! pip install -r requirements.txt'), ['! pip install -r requirements.txt'], 'inline'],
  ['a tilde fence', ['~~~', '! make', '~~~'].join('\n'), ['! make'], 'inline'],
  ['blank lines inside a fence of commands', fence('', '! make', '', '! make test'), ['! make', '! make test'], 'inline'],
  ['a fence with commands and other lines', fence('', '# first', '! make'), ['! make'], 'footer'],
  ['a fence inside a list item', '1. Log in:\n   ```\n   ! gh auth login\n   ```', ['! gh auth login'], 'footer'],
  ['a backslash continuation', '! docker run \\\n  --rm alpine', ['! docker run \\\n  --rm alpine'], 'inline'],
  ['a continuation inside a fence', fence('', '! docker run \\', '  --rm \\', '  alpine'), ['! docker run \\\n  --rm \\\n  alpine'], 'inline'],
  ['a heredoc inside a fence', fence('', "! cat > a.txt <<'EOF'", 'hello', 'EOF'), ["! cat > a.txt <<'EOF'\nhello\nEOF"], 'inline'],
  ['an indented heredoc terminator with <<-', fence('', '! cat <<-END', '\tx', '\tEND'), ['! cat <<-END\n\tx\n\tEND'], 'inline'],
  ['Cyrillic in a command', '! git commit -m "исправление"', ['! git commit -m "исправление"'], 'inline'],
  ['an emoji in a command', '! echo "done 🎉"', ['! echo "done 🎉"'], 'inline'],
  ['Cyrillic prose around a command', 'Выполните:\n\n! gh auth login\n\nи продолжим.', ['! gh auth login'], 'inline'],
  ['trailing whitespace trimmed', '! npm login   ', ['! npm login'], 'inline'],
  ['a CRLF reply', 'Run:\r\n\r\n! make\r\n', ['! make'], 'inline'],
]

const NOT_FOUND: Case[] = [
  ['plain prose', 'Nothing to run here.', [], 'none'],
  ['a markdown image', '![diagram](https://example.com/a.png)', [], 'none'],
  ['an inequality', 'Use `a != b` here, and !=.', [], 'none'],
  ['a CSS !important', 'color: red !important;', [], 'none'],
  ['!! history expansion', '!! is the last command', [], 'none'],
  ['!$ in prose', '!$ is the last argument', [], 'none'],
  ['a bang with no space', '!gh auth login', [], 'none'],
  ['a bang alone', '!', [], 'none'],
  ['a quote block', '> ! rm -rf build', [], 'none'],
  ['a quote block line after prose', 'You wrote:\n> ! npm publish', [], 'none'],
  ['a diff fence', fence('diff', '! not a command'), [], 'none'],
  ['a json fence', fence('json', '!x'), [], 'none'],
  ['a yaml fence', fence('yaml', '! tag'), [], 'none'],
  ['a text fence', fence('text', '! output'), [], 'none'],
  ['a markdown fence', fence('markdown', '! gh auth login'), [], 'none'],
  ['an md fence', fence('md', '! gh auth login'), [], 'none'],
  ['!= inside a fence', fence('js', 'if (a', '!= b) {}'), [], 'none'],
  ['![ inside a fence', fence('', '![img](x)'), [], 'none'],
  ['!! inside a fence', fence('', '!!'), [], 'none'],
  ['!$ inside a fence', fence('', '!$'), [], 'none'],
  ['!-1 inside a fence', fence('', '!-1'), [], 'none'],
  ['a span that is not a command', 'Use `!important` sparingly.', [], 'none'],
  ['a span with a bang and no space', 'Type `!ls` in the box.', [], 'none'],
  ['a plain bash fence, option off', fence('bash', 'npm ci', 'npm test'), [], 'none'],
  ['a console fence, option off', fence('console', '$ npm test'), [], 'none'],
  ['prose that names a command without a bang', 'Run gcloud auth login, then continue.', [], 'none'],
]

describe('commands found', () => {
  for (const [name, markdown, expected, layout] of FOUND) {
    test(name, () => {
      const parsed = parseBlock(markdown, OFF)
      expect(commandsOf(parsed)).toEqual(expected)
      expect(parsed.layout).toBe(layout)
    })
  }
})

describe('never a command', () => {
  for (const [name, markdown, expected, layout] of NOT_FOUND) {
    test(name, () => {
      const parsed = parseBlock(markdown, OFF)
      expect(commandsOf(parsed)).toEqual(expected)
      expect(parsed.layout).toBe(layout)
    })
  }
})

const BASH: Case[] = [
  ['a bash fence', fence('bash', 'npm ci', 'npm test'), ['! npm ci', '! npm test'], 'inline'],
  ['an sh fence', fence('sh', 'make'), ['! make'], 'inline'],
  ['a shell fence', fence('shell', 'make'), ['! make'], 'inline'],
  ['a zsh fence', fence('zsh', 'make'), ['! make'], 'inline'],
  ['a $ prompt stripped', fence('bash', '$ npm test'), ['! npm test'], 'inline'],
  ['a % prompt stripped', fence('sh', '% make'), ['! make'], 'inline'],
  ['console output skipped', fence('console', '$ npm test', '> passed 12', '$ npm run lint'), ['! npm test', '! npm run lint'], 'footer'],
  ['a terminal fence', fence('terminal', '$ ls', 'a.txt'), ['! ls'], 'footer'],
  ['comments skipped', fence('bash', '# install', 'npm ci'), ['! npm ci'], 'footer'],
  ['a continuation in a bash fence', fence('bash', 'docker run \\', '  alpine'), ['! docker run \\\n  alpine'], 'inline'],
  ['a ! line in a bash fence keeps its own bang', fence('bash', '! make'), ['! make'], 'inline'],
  ['not in a python fence', fence('python', 'print(1)'), [], 'none'],
  ['not in a fence with no language', fence('', 'npm ci'), [], 'none'],
]

describe('bashBlocks on', () => {
  for (const [name, markdown, expected, layout] of BASH) {
    test(name, () => {
      const parsed = parseBlock(markdown, ON)
      expect(commandsOf(parsed)).toEqual(expected)
      expect(parsed.layout).toBe(layout)
    })
  }

  test('bash lines are marked as such, ! lines are not', () => {
    const parsed = parseBlock(fence('bash', 'npm ci', '! make'), ON)
    if (parsed.layout === 'none') throw new Error('no commands')
    expect(parsed.commands.map(c => c.isFromBash)).toEqual([true, false])
  })
})

describe('limits', () => {
  test(`a command of ${4000} characters gets a button`, () => {
    const cmd = `! echo ${'x'.repeat(3993)}`
    expect([...cmd].length).toBe(4000)
    expect(commandsOf(parseBlock(cmd, OFF))).toEqual([cmd])
  })

  test('a longer one gets none, and the block is the engine\'s', () => {
    expect(parseBlock(`! echo ${'x'.repeat(3994)}`, OFF).layout).toBe('none')
  })

  test('the limit counts characters, not UTF-16 units', () => {
    const cmd = `! echo ${'🎉'.repeat(3993)}`
    expect(cmd.length).toBeGreaterThan(4000)
    expect(isPlaceable(cmd)).toBe(true)
  })

  test('a control character takes the button away', () => {
    expect(isPlaceable('! echo \u001b[31mred')).toBe(false)
    expect(parseBlock('! echo \u0007bell', OFF).layout).toBe('none')
  })

  test('a tab is no control character here', () => {
    expect(isPlaceable('! printf "a\tb"')).toBe(true)
  })

  test(`at most ${MAX_COMMANDS} buttons per block`, () => {
    const lines = Array.from({ length: MAX_COMMANDS + 5 }, (_, i) => `! echo ${i}`)
    const parsed = parseBlock(fence('', ...lines), OFF)
    expect(commandsOf(parsed).length).toBe(MAX_COMMANDS)
    // the fence lost commands, so it is drawn whole and the buttons follow it
    expect(parsed.layout).toBe('footer')
  })

  test('a fence with an unplaceable command is drawn whole', () => {
    const parsed = parseBlock(fence('', '! make', '! echo \u0007'), OFF)
    expect(parsed.layout).toBe('footer')
    expect(commandsOf(parsed)).toEqual(['! make'])
  })

  test('an unclosed fence (still streaming) is not cut', () => {
    const parsed = parseBlock('```\n! make\n! make test', OFF)
    expect(parsed.layout).toBe('footer')
    expect(commandsOf(parsed)).toEqual(['! make', '! make test'])
  })
})

describe('layout', () => {
  test('inline: markdown, the command, markdown', () => {
    const parsed = parseBlock('Please log in:\n\n! gcloud auth login\n\nAfter that I deploy.', OFF)
    if (parsed.layout !== 'inline') throw new Error(parsed.layout)
    expect(parsed.parts.map(p => (p.kind === 'markdown' ? p.text : p.group.commands.map(c => c.text)))).toEqual([
      'Please log in:',
      ['! gcloud auth login'],
      'After that I deploy.',
    ])
  })

  test('a fence of commands is one framed group with All', () => {
    const parsed = parseBlock(fence('', '! a', '! b'), OFF)
    if (parsed.layout !== 'inline') throw new Error(parsed.layout)
    const part = parsed.parts[0]
    if (part?.kind !== 'commands') throw new Error('no group')
    expect(part.group.isFramed).toBe(true)
    expect(part.group.hasAll).toBe(true)
  })

  test('a fence of one command is not framed and has no All', () => {
    const parsed = parseBlock(fence('', '! a'), OFF)
    const part = parsed.layout === 'inline' ? parsed.parts[0] : undefined
    expect(part?.kind === 'commands' && part.group.isFramed).toBe(false)
    expect(part?.kind === 'commands' && part.group.hasAll).toBe(false)
  })

  test('command lines that touch are one group', () => {
    const parsed = parseBlock('! a\n! b\n! c', OFF)
    if (parsed.layout !== 'inline') throw new Error(parsed.layout)
    expect(parsed.parts.length).toBe(1)
    const part = parsed.parts[0]
    expect(part?.kind === 'commands' && part.group.commands.length).toBe(3)
    expect(part?.kind === 'commands' && part.group.hasAll).toBe(true)
  })

  test('a blank line keeps command lines apart', () => {
    const parsed = parseBlock('! a\n\n! b', OFF)
    if (parsed.layout !== 'inline') throw new Error(parsed.layout)
    expect(parsed.parts.filter(p => p.kind === 'commands').length).toBe(2)
  })

  test('a multi-line command in a group takes All away', () => {
    const parsed = parseBlock(fence('', '! docker run \\', '  alpine', '! make'), OFF)
    const part = parsed.layout === 'inline' ? parsed.parts[0] : undefined
    expect(part?.kind === 'commands' && part.group.hasAll).toBe(false)
  })

  test('commands are numbered in order across groups', () => {
    const parsed = parseBlock('! a\n\nThen:\n\n' + fence('', '! b', '! c'), OFF)
    if (parsed.layout === 'none') throw new Error('no commands')
    expect(parsed.commands.map(c => c.n)).toEqual([0, 1, 2])
  })

  test('the footer keeps every command in the order written', () => {
    const parsed = parseBlock('! first\n\nRun `! second` too.', OFF)
    expect(parsed.layout).toBe('footer')
    expect(commandsOf(parsed)).toEqual(['! first', '! second'])
  })

  test('a list of commands drops into rows, a list with prose does not', () => {
    expect(parseBlock('- ! a\n- ! b', OFF).layout).toBe('inline')
    expect(parseBlock('- ! a\n- b', OFF).layout).toBe('footer')
  })

  test('a list item with a continuation line is not cut', () => {
    expect(parseBlock('- ! npm ci\n  then wait', OFF).layout).toBe('footer')
  })
})

describe('joinAll', () => {
  const cmds = (...texts: string[]): Command[] =>
    texts.map((text, n) => ({ text, n, isFromBash: false, isMultiline: text.includes('\n') }))

  test('&& by default', () => {
    expect(joinAll(cmds('! a', '! b', '! c'), '&&')).toBe('! a && b && c')
  })

  test(';', () => {
    expect(joinAll(cmds('! a', '! b'), ';')).toBe('! a; b')
  })

  test('newline', () => {
    expect(joinAll(cmds('! a', '! b'), 'newline')).toBe('! a\nb')
  })

  test('a bang with no space is joined the same', () => {
    expect(joinAll(cmds('!a', '! b'), '&&')).toBe('! a && b')
  })

  test('none with a multi-line command', () => {
    expect(joinAll(cmds('! a \\\n  b', '! c'), '&&')).toBe(undefined)
  })

  test('none with no commands', () => {
    expect(joinAll([], '&&')).toBe(undefined)
  })

  test('the option value is read safely', () => {
    expect(joinerOf(';')).toBe(';')
    expect(joinerOf('newline')).toBe('newline')
    expect(joinerOf('&&')).toBe('&&')
    expect(joinerOf('||')).toBe('&&')
    expect(joinerOf(undefined)).toBe('&&')
  })
})

describe('blockHash', () => {
  test('is stable and short', () => {
    expect(blockHash('! a')).toBe(blockHash('! a'))
    expect(blockHash('! a')).toMatch(/^[0-9a-f]{8}$/)
  })

  test('differs between blocks', () => {
    expect(blockHash('! a')).not.toBe(blockHash('! b'))
  })
})

describe('runLog', () => {
  const ok = { isError: false, maxChars: 10000 }
  const LOGGED: [string, string, string, boolean, string][] = [
    ['one line', 'pwd', '/repo\n', false, 'ran `pwd` → /repo'],
    ['three lines inline', 'ls', 'a\nb\nc\n', false, 'ran `ls` → a ⏎ b ⏎ c'],
    ['CRLF and blank edges', 'ls', '\r\na\r\nb\r\n\r\n', false, 'ran `ls` → a ⏎ b'],
    ['no output', 'touch x', '', false, 'ran `touch x` → no output'],
    ['only blank lines', 'true', '\n \n', false, 'ran `true` → no output'],
    ['failed', 'ls /nope', 'ls: no such file\n', true, 'ran `ls /nope` · failed → ls: no such file'],
    ['four lines as a count', 'seq 4', '1\n2\n3\n4\n', false, 'ran `seq 4` → 4 lines, sent to Claude'],
    ['a failed count', 'npm test', 'a\nb\nc\nd', true, 'ran `npm test` · failed → 4 lines, sent to Claude'],
    ['controls and tabs dropped', 'x', 'a\tb\u001b[0m', false, 'ran `x` → a b[0m'],
  ]
  for (const [name, command, output, isError, line] of LOGGED) {
    test(name, () => {
      expect(runLog(command, output, { isError, maxChars: 10000 })).toBe(line)
    })
  }

  test('a wide line is clipped', () => {
    const line = runLog('cat f', 'x'.repeat(500), ok)
    expect(line).toBe(`ran \`cat f\` → ${'x'.repeat(119)}…`)
  })

  test('cut output is a count, with the limit', () => {
    expect(runLog('seq 1 20000', Array.from({ length: 20000 }, (_, i) => i + 1).join('\n'), ok))
      .toBe('ran `seq 1 20000` → 20 000 lines, first 10 000 chars sent to Claude')
  })

  test('a multi-line command shows its first line', () => {
    expect(runLog('cat <<EOF\nhi\nEOF', 'hi\n', ok)).toBe('ran `cat <<EOF …` → hi')
  })

  test('a long command is clipped', () => {
    const line = runLog('echo ' + 'a'.repeat(100), 'a', ok)
    expect(line).toBe(`ran \`echo ${'a'.repeat(54)}…\` → a`)
  })

  test('never holds a line break', () => {
    expect(runLog('a\nb', 'x\ny\r\nz', ok)).not.toMatch(/[\r\n]/)
  })
})
