# Contributing to VeroRunto

For maintainers and anyone changing the plugin. How to use it is in the
[README](README.md).

## Develop and test locally

There are two suites, and CI runs both. The first needs nothing but bash, grep and
python3 - no Claude Code, no network, no credentials:

```bash
tests/smoke.sh
```

It asserts the plugin's main promise: the only way the hooks module runs a command is
`$.tool.call({ tool: 'Bash', ... })` - Claude Code's own Bash tool, under its permission
rules - and no file of the module names `$.process`, another tool, an agent, a model, or
a prompt sent in the person's name (`asUser`). It also checks the repository's
invariants: `hooks.json` names the module and nothing else, `plugin.json` does not
declare hooks, the repository publishes no marketplace of its own and names none, the
plugin carries the shared source check (`hooks/source-check.ts` and its table), the
install script names VeroPlugins, the plugin has no top-level `bin/`, the plugin's copies
of `README.md` and `LICENSE` match the repository's, every image the README shows exists,
and the scripts are executable, LF-only and free of bash 4 syntax.

The second runs the TypeScript against Claude Code's own engine - still no account and no
network:

```bash
claude plugin test ./plugins/vero-runto
```

`tests/commands.test.ts` is the parser's table: every form a command takes, every
lookalike that is not one, the `bashBlocks` option, the limits, the layout chosen for each
shape of block, and **all**'s joining. `tests/render.test.tsx` draws replies through the
plugin on both the terminal and the desktop surface and presses their buttons: what Copy
puts on the clipboard, the *Run?* question and its answers, what Run hands to the Bash
tool and to the model, a denied command, a running one, `/clear` and a new turn, and a
copy installed from somewhere other than VeroPlugins: paused, with the buttons that move
it. `tests/source-check.test.ts` is the source check's table, a byte-identical copy of
the one in VeroPlugins.

Then validate the structure:

```bash
claude plugin validate ./plugins/vero-runto           # plugin.json, hooks module, state contract
claude plugin validate ./plugins/vero-runto --strict  # treat warnings as errors, for CI
```

Then load the plugin for one session, with no install and no marketplace:

```bash
cd /some/test/repo
claude --plugin-dir /path/to/VeroRunto/plugins/vero-runto
```

Ask Claude for a `! pwd`, press **Run** under its reply and confirm. A `--plugin-dir`
folder is watched: saving a plugin file reloads the hooks module, with no restart. If the
module fails to load or a hook fails, a dim `vero-runto: ...` line in the transcript says
why, and `claude --debug` has the details. A `--plugin-dir` plugin shadows an installed
plugin of the same name for that session.

### What CI checks

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Checks |
| :-- | :-- |
| **Plugin manifests** | both `claude plugin validate` runs, `--strict` included, and `claude plugin test` |
| **Shell lint** | `bash -n`, ShellCheck (`-S warning`) and a parse under bash 3.2 for every script |
| **Smoke** | `tests/smoke.sh` on Linux and macOS |
| **Line endings** | checks out the commit under test with `core.autocrlf=true`, the Windows default, and proves the scripts still have LF endings and are executable |

## Share it

VeroRunto is listed in [VeroPlugins](https://github.com/GomelHawk/VeroPlugins), the one
marketplace for every Vero plugin; its entry points at this repository's `main`, so
publishing is pushing `main`. Users then need two lines:

```
/plugin marketplace add GomelHawk/VeroPlugins
/plugin install vero-runto@vero-plugins
```

The plugin checks where it was installed from (`hooks/source-check.ts`, a byte-identical
copy of VeroPlugins' canonical file): a copy from anywhere else pauses and shows the
commands that move it. Change the check in VeroPlugins first, then copy it here.

### Releasing updates

`version` in `plugin.json` pins the plugin: users keep their cached copy until that string
changes, so bump it on every release. Never set `version` in the VeroPlugins entry -
`plugin.json` silently wins.

Never change the plugin's `name` without adding a `renames` entry to VeroPlugins'
catalog; the name is what users' `enabledPlugins` keys on.

A pushed `v<version>` tag runs `.github/workflows/release.yml`, which tells VeroPlugins'
CI to re-check this plugin's entry; it needs the `VEROPLUGINS_DISPATCH_TOKEN` secret in
this repository. The full release procedure is in `CLAUDE.md` under "Cutting a
release".
