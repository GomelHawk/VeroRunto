// What the transcript's buttons draw from, for this session only. A target is
// `<blockHash>:<n>` for a command's buttons, `<blockHash>:all<g>` for a group's Copy all
// and Run all. `copied`: the target drawn as [ ✓ Copied ]. `confirming`: the target whose
// row asks "Run?". `running`: the target whose command is running now.
export type View = {
  copied?: string
  confirming?: string
  running?: string
  // where this copy was installed from: `home` is VeroPlugins, `dev` a --plugin-dir or
  // test copy, `foreign` any other marketplace - that copy is stopped
  source: { kind: 'home' } | { kind: 'dev' } | { kind: 'foreign'; marketplace: string }
  // an older copy of this plugin still enabled under another marketplace; a home copy
  // beside one is stopped until it is removed
  legacy?: { marketplace: string; scope: 'user' | 'project' | 'local' }
  // the move command waiting for "Replace your draft?" to be answered
  confirmingFill?: string
}

declare module 'claude-code' {
  interface PluginState {
    'vero-runto': { view: View }
  }
}
