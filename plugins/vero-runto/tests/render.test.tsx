import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { blockHash } from '../hooks/commands'

// Replies drawn through the plugin on both surfaces it draws on, and its buttons pressed.
// Hooks beneath the plugin stand for the clipboard, the Bash tool, the permission check,
// the model's prompt queue and the toasts: every copy, run, submit and toast is recorded.

type World = {
  // the verdict per command; `allow` for any command not named
  verdicts?: Record<string, 'allow' | 'ask' | 'deny'>
  // what the Bash tool answers
  output?: string
  isError?: boolean
  deny?: string
  cannotCopy?: boolean
  // the environment the module reads: VERO_TEST_ROOT stands in for the plugin's root
  env?: Record<string, string>
  // what each settings file holds; read on every call, so a test can change it
  settings?: Partial<Record<'user' | 'project' | 'local', Record<string, unknown>>>
  // the draft in the prompt box
  draft?: string
  // a prompt box that refuses fills (a dialog is open)
  cannotFill?: boolean
}

function fakeWorld(on: On, world: World = {}) {
  const seen = {
    copied: [] as string[],
    checked: [] as string[],
    ran: [] as string[],
    logged: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
    commands: [] as string[],
    filled: [] as { text: string; mode: string }[],
  }
  mock.store(on, {})
  // read on every call, so a test can move the copy between two turns
  on('env.get', ($, e) => ({ value: world.env?.[e.name] }))
  const clock = mock.clock(on)
  on('settings.read', ($, e) => ({ value: (e.source && world.settings?.[e.source as 'user']) ?? {} }))
  on('prompt.read', () => ({ value: { text: world.draft ?? '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    if (world.cannotFill) return { isFilled: false, text: world.draft ?? '' }
    seen.filled.push({ text: e.text, mode: e.mode ?? 'replace' })
    return { isFilled: true, text: e.text }
  })
  // the engine's own band: an empty row
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'S1' }))
  on('turn.start', () => ({ turnId: 'T1' }))
  // the engine's own drawing of a reply: one Text, so a test can tell it from the plugin's
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {e.props.text}</Text>
  })
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.logged.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    if (world.cannotCopy) return { value: { isCopied: false, reason: 'no-clipboard' } }
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('tool.check', ($, e) => {
    const command = String((e.input as { command?: string }).command)
    seen.checked.push(command)
    return { decision: world.verdicts?.[command] ?? 'allow' }
  })
  on('tool.call', ($, e) => {
    const command = String((e as { command?: string }).command)
    seen.ran.push(command)
    if (world.deny !== undefined) return { deny: world.deny }
    const text = world.output ?? `output of ${command}`
    if (world.isError) return { isError: true, result: { stdout: '', stderr: text }, text }
    return { result: { stdout: text, stderr: '' }, text }
  })
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  return { ...seen, clock }
}

const start = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  $.session.start({ cwd: '/repo', surface, isInteractive: true })

const mountReply = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop', text: string, extra: Record<string, unknown> = {}) =>
  $.ui.mount({
    plugin: 'vero-runto',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true, ...extra },
    requestId: 'msg-1',
  })

const BAND = { hasSurvey: false, isWorking: false, maxRows: 3 }
const mountBand = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'vero-runto', surface, component: 'AbovePrompt', props: BAND })

const FOREIGN = '/h/.claude/plugins/cache/some-marketplace/vero-runto/1.0.0'
const HOME = '/h/.claude/plugins/cache/vero-plugins/vero-runto/1.0.0'
const MOVE = [
  '/plugin marketplace add GomelHawk/VeroPlugins',
  '/plugin install vero-runto@vero-plugins',
  '/plugin uninstall vero-runto@some-marketplace',
]

const LOGIN = 'Please log in, then tell me to continue:\n\n! gh auth login\n\nAfter that I open the PR.'
const FENCE = '```bash\n! sudo apt-get update\n! sudo apt-get install -y build-essential\n```'
const SPANS = 'Please run `! npm login` and retry; if that fails, `! npm whoami` shows the account.'
const HIDDEN = '! gh​ auth login'

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`replies on ${surface}`, () => {
    test('a block with no command is the engine\'s own drawing', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, 'Nothing to run here.')
      expect(await ui.find({ type: 'Button' })).toBe(undefined)
      expect(await ui.find({ type: 'Text', text: 'engine: Nothing to run here.' })).toBeDefined()
    })

    test('a summary block is left alone', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, '! gh auth login', { isSummary: true })
      expect(await ui.find({ type: 'Button' })).toBe(undefined)
      expect(await ui.find({ type: 'Text', text: 'engine: ! gh auth login' })).toBeDefined()
    })

    test('one command: markdown, its row with Copy and Run, markdown', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      const md = await ui.findAll({ type: 'Markdown' })
      expect(md.map(m => m.props.text)).toEqual(['Please log in, then tell me to continue:', 'After that I open the PR.'])
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe('! gh auth login')
      expect((await ui.find({ key: `copy:${hash}:0` }))?.text).toBe('Copy')
      expect((await ui.find({ key: `run:${hash}:0` }))?.text).toBe('Run')
      // the verdict was asked for the command without its bang, and nothing ran
      expect(seen.checked).toEqual(['gh auth login'])
      expect(seen.ran).toEqual([])
    })

    test('a fence of commands: framed rows, Copy all and Run all', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, FENCE)
      const hash = blockHash(FENCE)
      expect(await ui.find({ key: `run:${hash}:0` })).toBeDefined()
      expect(await ui.find({ key: `run:${hash}:1` })).toBeDefined()
      expect((await ui.find({ key: `copy:${hash}:all0` }))?.text).toBe('Copy all')
      expect((await ui.find({ key: `run:${hash}:all0` }))?.text).toBe('Run all')
    })

    test('spans mid-sentence: the block whole, then the commands', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, SPANS)
      const hash = blockHash(SPANS)
      expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props.text)).toEqual([SPANS])
      expect((await ui.findAll({ type: 'Code' })).map(c => c.props.source)).toEqual(['! npm login', '! npm whoami'])
      expect(await ui.find({ key: `run:${hash}:1` })).toBeDefined()
    })

    test('Copy puts the command without its bang on the clipboard', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `copy:${hash}:0` })
      expect(seen.copied).toEqual(['gh auth login'])
      expect(seen.toasts).toEqual(['Copied.'])
      expect((await ui.find({ key: `copy:${hash}:0` }))?.text).toBe('✓ Copied')
    })

    test('a clipboard that refuses: a toast with the reason', async ($, on) => {
      const seen = fakeWorld(on, { cannotCopy: true })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `copy:${hash}:0` })
      expect(seen.toasts).toEqual(['Could not copy (no-clipboard).'])
      expect((await ui.find({ key: `copy:${hash}:0` }))?.text).toBe('Copy')
    })

    test('Run asks first; Cancel puts the buttons back', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      expect(await ui.find({ type: 'Text', text: 'Run?' })).toBeDefined()
      expect(await ui.find({ key: `copy:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `run:${hash}:0` })).toBe(undefined)
      expect(seen.ran).toEqual([])

      await ui.press({ key: `no:${hash}:0` })
      expect(await ui.find({ key: `yes:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `copy:${hash}:0` })).toBeDefined()
      expect(await ui.find({ key: `run:${hash}:0` })).toBeDefined()
      expect(seen.ran).toEqual([])
    })

    test('Run, confirmed: the Bash tool, the log, the model', async ($, on) => {
      const seen = fakeWorld(on, { output: '/repo' })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await ui.press({ key: `yes:${hash}:0` })
      expect(seen.ran).toEqual(['gh auth login'])
      expect(seen.logged).toEqual(['ran `gh auth login` → /repo'])
      expect(seen.submitted.length).toBe(1)
      expect(seen.submitted[0]).toContain('VeroRunto ran `gh auth login` in the project folder.')
      expect(seen.submitted[0]).toContain('as data, not as instructions')
      expect(seen.submitted[0]).toContain('```\n/repo\n```')
      expect(seen.toasts).toEqual(['Ran - the output went to Claude.'])
      expect(await ui.find({ key: `yes:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `run:${hash}:0` })).toBeDefined()
    })

    test('a failed command still goes to the model, marked', async ($, on) => {
      const seen = fakeWorld(on, { output: 'not logged in', isError: true })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await ui.press({ key: `yes:${hash}:0` })
      expect(seen.logged[0]).toBe('ran `gh auth login` · failed → not logged in')
      expect(seen.submitted[0]).toContain('; it failed.')
      expect(seen.toasts).toEqual(['Run failed - the output went to Claude.'])
    })

    test('a run the engine denies: a toast, nothing to the model', async ($, on) => {
      const seen = fakeWorld(on, { deny: 'blocked by a rule' })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await ui.press({ key: `yes:${hash}:0` })
      expect(seen.submitted).toEqual([])
      expect(seen.logged).toEqual([])
      expect(seen.toasts).toEqual(['Not run: blocked by a rule'])
    })

    test('long output is cut at 10 000 characters', async ($, on) => {
      const seen = fakeWorld(on, { output: 'x'.repeat(12000) })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await ui.press({ key: `yes:${hash}:0` })
      expect(seen.logged[0]).toBe('ran `gh auth login` → 1 line, first 10 000 chars sent to Claude')
      expect(seen.submitted[0]).toContain('(the first 10000 characters)')
      expect(seen.submitted[0]).not.toContain('x'.repeat(10001))
    })

    test('output holding a fence stays one block', async ($, on) => {
      const seen = fakeWorld(on, { output: 'a\n```\nb\n```' })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await ui.press({ key: `yes:${hash}:0` })
      expect(seen.submitted[0]).toContain('````\na\n```\nb\n```\n````')
    })

    test('a denied command has Copy and no Run', async ($, on) => {
      fakeWorld(on, { verdicts: { 'gh auth login': 'deny' } })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      expect(await ui.find({ key: `copy:${hash}:0` })).toBeDefined()
      expect(await ui.find({ key: `run:${hash}:0` })).toBe(undefined)
    })

    test('a command the engine would ask about has Run', async ($, on) => {
      fakeWorld(on, { verdicts: { 'gh auth login': 'ask' } })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      expect((await ui.find({ key: `run:${blockHash(LOGIN)}:0` }))?.text).toBe('Run')
    })

    test('hidden characters: Copy and no Run', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, HIDDEN)
      const hash = blockHash(HIDDEN)
      expect(await ui.find({ key: `copy:${hash}:0` })).toBeDefined()
      expect(await ui.find({ key: `run:${hash}:0` })).toBe(undefined)
    })

    test('an unanswered question goes back to the buttons after 30 s', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      await seen.clock.advance(29000)
      expect(await ui.find({ key: `yes:${hash}:0` })).toBeDefined()
      await seen.clock.advance(2000)
      expect(await ui.find({ key: `yes:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `run:${hash}:0` })).toBeDefined()
      expect(seen.ran).toEqual([])
    })

    test('a new turn drops the question and asks the verdicts again', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `run:${hash}:0` })
      expect(await ui.find({ key: `yes:${hash}:0` })).toBeDefined()
      await $.turn.start({ text: 'next', turnId: 'T2' })
      expect(await ui.find({ key: `yes:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `run:${hash}:0` })).toBeDefined()
      expect(seen.checked).toEqual(['gh auth login', 'gh auth login'])
    })

    test('Run all runs the joined commands', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, FENCE)
      const hash = blockHash(FENCE)
      await ui.press({ key: `run:${hash}:all0` })
      await ui.press({ key: `yes:${hash}:all0` })
      expect(seen.ran).toEqual(['sudo apt-get update && sudo apt-get install -y build-essential'])
    })

    test('Copy all copies the joined commands', async ($, on) => {
      const seen = fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, FENCE)
      await ui.press({ key: `copy:${blockHash(FENCE)}:all0` })
      expect(seen.copied).toEqual(['sudo apt-get update && sudo apt-get install -y build-essential'])
    })

    test('All is denied when one of its commands is', async ($, on) => {
      fakeWorld(on, { verdicts: { 'sudo apt-get update': 'deny' } })
      await start($, surface)
      const ui = await mountReply($, surface, FENCE)
      const hash = blockHash(FENCE)
      expect(await ui.find({ key: `run:${hash}:0` })).toBe(undefined)
      expect(await ui.find({ key: `run:${hash}:1` })).toBeDefined()
      expect(await ui.find({ key: `run:${hash}:all0` })).toBe(undefined)
      expect(await ui.find({ key: `copy:${hash}:all0` })).toBeDefined()
    })

    test('session.end clears what was copied', async ($, on) => {
      fakeWorld(on)
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      const hash = blockHash(LOGIN)
      await ui.press({ key: `copy:${hash}:0` })
      expect((await ui.find({ key: `copy:${hash}:0` }))?.text).toBe('✓ Copied')
      await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } })
      expect((await ui.find({ key: `copy:${hash}:0` }))?.text).toBe('Copy')
    })
  })
}

describe('options', () => {
  test('joinWith ; joins with ;', { options: { joinWith: ';' } }, async ($, on) => {
    const seen = fakeWorld(on)
    await start($, 'terminal')
    const ui = await mountReply($, 'terminal', FENCE)
    await ui.press({ key: `copy:${blockHash(FENCE)}:all0` })
    expect(seen.copied).toEqual(['sudo apt-get update; sudo apt-get install -y build-essential'])
  })

  test('bashBlocks off: a plain bash fence is the engine\'s', async ($, on) => {
    fakeWorld(on)
    await start($, 'terminal')
    const ui = await mountReply($, 'terminal', '```bash\nnpm ci\n```')
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
  })

  test('bashBlocks on: buttons on a plain bash fence', { options: { bashBlocks: true } }, async ($, on) => {
    const seen = fakeWorld(on)
    await start($, 'terminal')
    const text = '```bash\nnpm ci\n```'
    const ui = await mountReply($, 'terminal', text)
    const hash = blockHash(text)
    expect((await ui.find({ key: `run:${hash}:0` }))?.text).toBe('Run')
    await ui.press({ key: `copy:${hash}:0` })
    expect(seen.copied).toEqual(['npm ci'])
  })
})

describe('the command', () => {
  test('/vero-runto is registered and says what it does', async ($, on) => {
    const seen = fakeWorld(on)
    await start($, 'terminal')
    expect(seen.commands).toEqual(['vero-runto'])
    const out = await $.command.run({
      command: 'vero-runto',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 120 },
    })
    const text = (out as { text?: string }).text ?? ''
    expect(text).toContain('Click. Run. Done.')
    expect(text).toContain("Claude Code's Bash tool")
    expect(text).toContain('`bashBlocks`: **off**')
    expect(text).toContain('`joinWith`: **&&**')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`a stopped copy on ${surface}`, () => {
    test('installed from another marketplace: the reply is the engine\'s, no verdict asked, one toast', async ($, on) => {
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN } })
      await start($, surface)
      expect(seen.toasts).toEqual([
        'VeroRunto is paused: installed from some-marketplace. See the band above the prompt to move it to VeroPlugins.',
      ])
      const ui = await mountReply($, surface, LOGIN)
      expect(await ui.find({ type: 'Button' })).toBe(undefined)
      expect(await ui.find({ type: 'Text', text: `engine: ${LOGIN}` })).toBeDefined()
      expect(seen.checked).toEqual([])
      expect(seen.commands).toEqual(['vero-runto'])
      expect(seen.toasts.length).toBe(1)
    })

    test('the command answers the stopped message', async ($, on) => {
      fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN } })
      await start($, surface)
      const out = await $.command.run({
        command: 'vero-runto',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 120 },
      })
      const text = (out as { text?: string }).text ?? ''
      expect(text).toContain('**VeroRunto is paused.** It was installed from `some-marketplace`')
      for (const step of MOVE) expect(text).toContain(`    ${step}`)
      expect(text).not.toContain('Your data is kept')
      expect(text).not.toContain('Click. Run. Done.')
    })

    test('the band: the reason, three buttons, no ×, and what is drawn beneath', async ($, on) => {
      fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN } })
      await start($, surface)
      const band = await mountBand($, surface)
      expect(
        await band.find({
          type: 'Text',
          text: '⛔ VeroRunto is paused - it was installed from some-marketplace. Vero plugins install only from VeroPlugins.',
        }),
      ).toBeDefined()
      expect((await band.find({ key: 'vr-move:1' }))?.text).toBe('1 ↓ Add VeroPlugins')
      expect((await band.find({ key: 'vr-move:2' }))?.text).toBe('2 ↓ Install from VeroPlugins')
      expect((await band.find({ key: 'vr-move:3' }))?.text).toBe('3 ↓ Remove this copy')
      expect(await band.find({ type: 'Text', text: 'then restart Claude Code' })).toBeDefined()
      expect((await band.findAll({ type: 'Button' })).length).toBe(3)
      expect(await band.find({ type: 'Text', text: '×' })).toBe(undefined)
    })

    test('each button fills exactly its command, and nothing runs', async ($, on) => {
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN } })
      await start($, surface)
      const band = await mountBand($, surface)
      await band.press({ key: 'vr-move:1' })
      await band.press({ key: 'vr-move:2' })
      await band.press({ key: 'vr-move:3' })
      expect(seen.filled).toEqual(MOVE.map(text => ({ text, mode: 'replace' })))
      expect(seen.ran).toEqual([])
      expect(seen.submitted).toEqual([])
      expect(seen.toasts.length).toBe(1)
    })

    test('a draft in the prompt box: the question first; Replace fills, Cancel does not', async ($, on) => {
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN }, draft: 'my half-typed prompt' })
      await start($, surface)
      const band = await mountBand($, surface)
      await band.press({ key: 'vr-move:2' })
      expect(seen.filled).toEqual([])
      expect(await band.find({ type: 'Text', text: 'Replace your draft?' })).toBeDefined()
      expect(await band.find({ key: 'vr-move:2' })).toBe(undefined)
      await band.press({ key: 'vr-move:cancel' })
      expect(seen.filled).toEqual([])
      expect(await band.find({ key: 'vr-move:2' })).toBeDefined()

      await band.press({ key: 'vr-move:2' })
      await band.press({ key: 'vr-move:replace' })
      expect(seen.filled).toEqual([{ text: MOVE[1], mode: 'replace' }])
      expect(await band.find({ key: 'vr-move:2' })).toBeDefined()
    })

    test('a prompt box that refuses the fill: a toast', async ($, on) => {
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: FOREIGN }, cannotFill: true })
      await start($, surface)
      const band = await mountBand($, surface)
      await band.press({ key: 'vr-move:1' })
      expect(seen.filled).toEqual([])
      expect(seen.toasts[1]).toBe('VeroRunto: close the dialog and press the button again.')
    })

    test('moved during the session: the next turn brings the buttons back', async ($, on) => {
      const env = { VERO_TEST_ROOT: FOREIGN }
      const seen = fakeWorld(on, { env })
      await start($, surface)
      const ui = await mountReply($, surface, LOGIN)
      expect(await ui.find({ type: 'Button' })).toBe(undefined)
      delete (env as { VERO_TEST_ROOT?: string }).VERO_TEST_ROOT
      await $.turn.start({ text: 'next', turnId: 'T2' })
      expect(await ui.find({ key: `run:${blockHash(LOGIN)}:0` })).toBeDefined()
      expect(seen.checked).toEqual(['gh auth login'])
      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Button' })).toBe(undefined)
    })

    test('a home copy beside an old copy: paused, with the one Remove button', async ($, on) => {
      const settings = { local: { enabledPlugins: { 'vero-runto@old-place': true, 'vero-runto@vero-plugins': true } } }
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: HOME }, settings })
      await start($, surface)
      expect(seen.toasts).toEqual(['VeroRunto is paused: an old copy from old-place is still installed. See the band above the prompt.'])
      const ui = await mountReply($, surface, LOGIN)
      expect(await ui.find({ type: 'Button' })).toBe(undefined)
      const band = await mountBand($, surface)
      expect(
        await band.find({ type: 'Text', text: '⛔ VeroRunto is paused - an old copy from old-place is still installed. Remove it, then restart.' }),
      ).toBeDefined()
      expect((await band.findAll({ type: 'Button' })).length).toBe(1)
      await band.press({ key: 'vr-move:remove' })
      expect(seen.filled).toEqual([{ text: '/plugin uninstall vero-runto@old-place --scope local', mode: 'replace' }])
      const out = await $.command.run({ command: 'vero-runto', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
      expect((out as { text?: string }).text).toContain('    /plugin uninstall vero-runto@old-place --scope local')

      // the old copy removed: the next turn resumes normal work
      settings.local = { enabledPlugins: { 'vero-runto@vero-plugins': true } } as typeof settings.local
      await $.turn.start({ text: 'next', turnId: 'T2' })
      expect(await ui.find({ key: `run:${blockHash(LOGIN)}:0` })).toBeDefined()
      expect(await band.find({ type: 'Button' })).toBe(undefined)
    })

    test('a working copy re-reads its source at most every 10 seconds', async ($, on) => {
      const settings: Partial<Record<'user', Record<string, unknown>>> = { user: { enabledPlugins: { 'vero-runto@vero-plugins': true } } }
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: HOME }, settings })
      await start($, surface)
      // an old copy appears right away: not looked for yet, so the next turn still draws buttons
      settings.user = { enabledPlugins: { 'vero-runto@old-place': true, 'vero-runto@vero-plugins': true } }
      await seen.clock.advance(9_000)
      await $.turn.start({ text: 'next', turnId: 'T2' })
      const ui = await mountReply($, surface, LOGIN)
      expect(await ui.find({ key: `run:${blockHash(LOGIN)}:0` })).toBeDefined()
      // ten seconds on: looked for, found, and the copy pauses
      await seen.clock.advance(1_000)
      await $.turn.start({ text: 'next', turnId: 'T3' })
      expect(await ui.find({ key: `run:${blockHash(LOGIN)}:0` })).toBeUndefined()
      const band = await mountBand($, surface)
      expect((await band.findAll({ type: 'Button' })).length).toBe(1)
    })

    test('a home copy with no old copy works as usual', async ($, on) => {
      const seen = fakeWorld(on, { env: { VERO_TEST_ROOT: HOME } })
      await start($, surface)
      expect(seen.toasts).toEqual([])
      const ui = await mountReply($, surface, LOGIN)
      expect(await ui.find({ key: `run:${blockHash(LOGIN)}:0` })).toBeDefined()
      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Button' })).toBe(undefined)
    })
  })
}

describe('terminal gutter', () => {
  test('the first block of a reply draws the bullet', async ($, on) => {
    fakeWorld(on)
    await start($, 'terminal')
    const ui = await mountReply($, 'terminal', LOGIN)
    expect(await ui.find({ type: 'Text', text: '●' })).toBeDefined()
  })

  test('a later block does not', async ($, on) => {
    fakeWorld(on)
    await start($, 'terminal')
    const ui = await mountReply($, 'terminal', LOGIN, { isFirstOfReply: false })
    expect(await ui.find({ type: 'Text', text: '●' })).toBe(undefined)
  })
})
