# Changelog

## 1.0.1 - 2026-10-20

### Fixed

- **A refused run says why, in plain words.** When Claude Code refuses a button's command
  (auto mode cannot approve a press, a deny rule, or No in the dialog), the toast says so;
  the engine's reason, written for Claude, goes to the debug log only.

### Changed

- **The move row has four buttons.** After the old copy is removed, a fourth button
  removes the marketplace it came from, so nothing of it stays behind. A copy from
  VeroPlugins that finds an older copy of itself offers the same two removals.

## 1.0.0 - 2026-10-15

Click. Run. Done.

### New

- **[ Copy ]** and **[ Run ]** after every `! command` Claude suggests in a reply - on its
  own line, in a list, in a code block, or as `` `! command` `` mid-sentence.
- **Copy** puts the command on your clipboard, without the `!`, for any other terminal.
- **Run** asks *Run?* **Run** / **Cancel** in its own place, then runs the command through
  Claude Code's Bash tool: your permission rules apply, Claude Code asks you as it would
  for a command of its own, and the output goes to Claude, which answers.
- **[ Copy all ]** and **[ Run all ]** after a block of two or more commands: one line,
  `a && b && c`.
- A command your rules deny, or one holding hidden characters, gets no Run button.
- One run at a time; the row says *running…* until it ends.
- Replies without a command look exactly as they do without the plugin.
- Options in `/config`: `bashBlocks` (buttons on plain `bash` / `sh` / `console` blocks
  too, off by default) and `joinWith` (`&&`, `;` or newline for **all**).
- `/vero-runto` shows what it does and the options' current values.
- Installs from [VeroPlugins](https://github.com/GomelHawk/VeroPlugins), the one
  marketplace for every Vero plugin. A copy installed from anywhere else pauses and shows,
  above the prompt, the buttons that move it there.
