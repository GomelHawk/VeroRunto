<p align="center">
  <img src="https://raw.githubusercontent.com/GomelHawk/VeroRunto/main/assets/horizontal-logo.png"
       alt="VeroRunto - Click. Run. Done."
       width="600">
</p>

<p align="center">
  <a href="https://github.com/GomelHawk/VeroRunto/actions/workflows/ci.yml"><img src="https://github.com/GomelHawk/VeroRunto/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/GomelHawk/VeroRunto/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-8a63d2.svg" alt="Claude Code plugin">
</p>

Claude often asks you to run a command it cannot run itself - log in somewhere, install
something, set a project. Without help that means selecting the line, copying it,
clicking into the prompt box, typing `!`, pasting and fixing the spacing.

VeroRunto puts a **Copy** and a **Run** button after every such command in Claude's
reply. **Run** asks you first, then runs the command through Claude Code's own tools, so
your usual permission rules apply, and hands the output back to Claude. **Copy** puts the
command on your clipboard for any other window. Two clicks, no typing.

## What you get

Before:

```
● I can't create the PR: the GitHub CLI isn't logged in.
  Please log in, then tell me to continue:

    ! gh auth login
```

With VeroRunto:

```
    ! gh auth login                                      [ Copy ]  [ Run ]
```

Press **Run**, confirm, and Claude continues with the result. A reply with no command
looks exactly as it does without the plugin.

## Install

Two commands, typed inside Claude Code. Type the first, press Enter and wait for
`✔ Successfully added marketplace: vero-plugins`, then type the second:

```
/plugin marketplace add GomelHawk/VeroPlugins
```

```
/plugin install vero-runto@vero-plugins
```

Then restart Claude Code. If you already added VeroPlugins for another Vero plugin, only
the second command is needed. There is nothing to configure and no API key involved.

> Type each line on its own. If a panel appears asking for a `marketplace source`, it
> wants only `GomelHawk/VeroPlugins` and nothing else on the line.

Prefer a terminal? The same two commands work there, back to back:

```bash
claude plugin marketplace add GomelHawk/VeroPlugins
claude plugin install vero-runto@vero-plugins
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `GomelHawk/VeroPlugins`, then **Add plugin**.

To check it took, type `/vero-runto`: it describes the plugin and its options.

**Only from VeroPlugins.** VeroRunto works only when installed from VeroPlugins. A copy
installed from anywhere else pauses and shows, above the prompt, three buttons that move
it here: press them one after another, pressing Enter after each, then restart Claude
Code. VeroRunto keeps no data of its own, so nothing is lost on the way.

<details>
<summary>Installing from a copy of this repository</summary>

```bash
git clone https://github.com/GomelHawk/VeroRunto
cd VeroRunto
./install.sh                                    # for you, in every project
./install.sh --scope project ~/work/our-app     # for everyone who works in our-app
```

`install.sh` checks the plugin and installs it from VeroPlugins. `--scope project DIR`
writes VeroRunto into `DIR/.claude/settings.json` - VeroPlugins and the plugin, never the
path of your copy - so once that file is committed, everyone who trusts the folder gets
VeroRunto without installing anything themselves. `--scope local DIR` does the same in
`DIR/.claude/settings.local.json`, for you alone. Without a copy of the repository, the
same team install is two commands run inside that project:

```bash
claude plugin marketplace add GomelHawk/VeroPlugins --scope project
claude plugin install vero-runto@vero-plugins --scope project
```
</details>

## Using it

**A command on its own line** gets its buttons right there; the rest of the reply is
drawn as before:

```
● I can't finish the deploy: gcloud isn't authenticated in this environment.
  Please log in, then tell me to continue:

    ! gcloud auth login                                  [ Copy ]  [ Run ]

    ! gcloud config set project acme-staging             [ Copy ]  [ Run ]

  After that I'll run the deploy again.
```

**Run asks first.** **Run** runs the command; **Cancel** puts the buttons back. A
question left unanswered goes away by itself after 30 seconds, or when the next turn
starts:

```
    ! gcloud auth login                            Run?  [ Run ]  [ Cancel ]
```

**While it runs** the row says *running…*; one command runs at a time. When it ends, the
output appears in the conversation, Claude reads it and answers - just as if you had
typed the `!` command yourself.

**A block of commands** becomes a framed list. With two or more commands, **Copy all**
and **Run all** take them as one line, joined with `&&` (stop at the first failure):

```
    ╭──────────────────────────────────────────────────────────────────╮
    │ ! sudo apt-get update                            [ Copy ]  [ Run ] │
    │ ! sudo apt-get install -y build-essential        [ Copy ]  [ Run ] │
    ╰──────────────────────────────────────────────────────────────────╯
                                                 [ Copy all ]  [ Run all ]
```

**A command inside a sentence**, a table or a list among other items is left in place -
cutting it out would break the sentence or the table. The reply is drawn whole and the
commands follow it:

```
● …Please run `! npm login` and retry; if that fails, `! npm whoami` shows the account.

  ↳ ! npm login                                          [ Copy ]  [ Run ]
  ↳ ! npm whoami                                         [ Copy ]  [ Run ]
```

**After Copy** the button reads **✓ Copied**. What is copied is the command without the
`!`, ready for any terminal.

**A command your permission rules forbid** has no Run button, only Copy. One that Claude
Code would ask you about has the button, and the usual permission dialog opens when you
confirm.

## What counts as a command

- A line that starts with `! ` - bang, space, then the command - on its own, or as a list
  item.
- A code span that starts with `! `, anywhere in a sentence: `` `! npm login` ``.
- Inside a code block of any language, each line that starts with `!`.
- A line ending in ` \` continues on the next line, and a heredoc (`<<EOF` … `EOF`) is
  one command.

Never a command: `![image](…)`, `!=`, `!important`, `!!`, `!$`, anything in a quote block
(`> …`), and lines in `diff`, `patch`, `json`, `yaml`, `text` or `markdown` blocks. A
command longer than 4,000 characters gets no buttons, and one reply block gets at most
30.

With the `bashBlocks` option on, the lines of plain ```` ```bash ````, `sh`, `shell`,
`zsh`, `console` and `terminal` blocks get buttons too. A leading `$ ` or `% ` prompt is
dropped, comments are skipped, and in a `console` transcript the output lines are
skipped.

## Safety

- **Every run goes through Claude Code's own Bash tool.** The same permission rules, the
  same dialog, the same sandbox as for a command Claude runs itself. A command your rules
  forbid gets no Run button at all. VeroRunto never starts a program of its own.
- **Nothing runs without your click.** Run asks *Run?* every time; the command is on the
  row, in plain sight, when you answer.
- **A suggested command can come from a trick.** A file or web page Claude reads can
  tell it to suggest `! curl … | sh`. The buttons save you typing, not judgement: read
  the command before you confirm.
- **What you see is what runs.** The command on the row is exactly what goes to the Bash
  tool - no hidden text, nothing added. A command holding invisible characters (control
  codes, zero-width or right-to-left marks) gets no Run button.
- **The output is data, not your words.** What a command printed goes to Claude as the
  plugin's message, labelled as command output, never as something you typed. At most
  10,000 characters of it.
- **Only the drawing changes.** The reply Claude wrote is stored as it was; `Ctrl+O` and
  the transcript file show the original text.

## Options

Change them in `/config`. `/vero-runto` shows their current values.

| Option | Default | What it does |
| :-- | :-- | :-- |
| `bashBlocks` | off | Buttons on the lines of plain `bash` / `sh` / `console` blocks too, not only on `!` commands |
| `joinWith` | `&&` | How **Copy all** and **Run all** join commands: `&&` (stop at the first failure), `;` (run each) or a newline |

## Updating

Nothing updates by itself, and Claude Code will not tell you a new version exists. New
versions are announced at
[github.com/GomelHawk/VeroRunto/releases](https://github.com/GomelHawk/VeroRunto/releases);
watch the repository if you want an email.

Inside Claude Code, one command at a time, same as installing:

```
/plugin marketplace update vero-plugins
```

```
/plugin update vero-runto@vero-plugins
```

Then restart Claude Code. From a terminal, where you can run them back to back:

```bash
claude plugin marketplace update vero-plugins
claude plugin update vero-runto@vero-plugins
```

`claude plugin list` shows which version you have.

## Uninstalling

Inside Claude Code:

```
/plugin uninstall vero-runto@vero-plugins
```

or, from a clone, `./uninstall.sh` (`./uninstall.sh --scope project ~/work/our-app` for a
project install). VeroRunto writes no files anywhere; nothing is left behind. The
VeroPlugins marketplace stays registered for your other Vero plugins.

## Requirements

Claude Code with plugin support, in the terminal or the desktop app. Nothing else to
install.

## Contributing

How to test changes, what CI checks and how releases reach users are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
