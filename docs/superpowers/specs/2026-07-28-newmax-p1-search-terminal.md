# NewMax P1: Workspace Content Search and Terminal Pane

Status: approved for implementation
Date: 2026-07-28
User confirmation: "按照你说的来"

## 1. Goal

Turn the P0 recursive workspace into a usable coding surface:

1. Search literal text across the bound project and open a result in the focused Pane.
2. Open terminal tabs in any Pane and run explicit commands inside the bound project root.
3. Keep output responsive and bounded without weakening the existing file, Worker, or layout boundaries.

## 2. Content Search

- The Files dock has a segmented `文件名 / 内容` mode.
- File-name mode keeps the existing fuzzy path search.
- Content mode is literal and smart-case, debounced, and returns at most 200 matches.
- Each match contains project-relative path, line, column, and a bounded one-line preview.
- Clicking a match opens the file in the focused Pane and reveals the matched line as transient UI state.
- Primary engine: `rg --json` with `shell:false` and `--` before the query.
- Fallback: bounded Node filesystem walk when `rg` is absent or fails to start.
- Both engines skip symlinks, VCS/vendor/build folders, binary files, and files over 2 MiB.
- Search has a 5 second deadline and never persists an index or file content.

## 3. Terminal Pane

- A terminal tab is a first-class Pane resource alongside conversation and file tabs.
- The top bar and each Pane tab strip can open a terminal in the focused Pane.
- The renderer uses a separately built, lazily loaded `@xterm/xterm` vendor bundle.
- The command line is parsed into executable plus argv and launched with `shell:false` through `TerminalProcessWorker`.
- One command may run per terminal session. Output streams as bounded stdout/stderr events.
- Controls: run, stop, clear, command history, `Ctrl+C`, and relative working directory.
- `cd <relative-path>` is handled as a validated built-in and remains inside the project root.
- Main owns process cancellation and aborts all commands when the Renderer is destroyed.
- The Pane snapshot stores terminal tab identity and relative cwd only. Output, history, running state, and command text remain Renderer-session state.
- Reopening the application restores the terminal tab as an idle session; it does not claim that a previous child process survived.

## 4. Deliberate Boundary

This slice is a controlled command terminal, not a persistent PTY. It does not add `node-pty`, interactive stdin, shell completion, or a hidden long-lived PowerShell process. Users can explicitly run an executable such as `pnpm`, `git`, `node`, `cmd`, or `powershell`; the Worker still receives the exact executable as its capability allowlist.

## 5. Acceptance

1. Searching a known phrase returns the correct relative file, line, column, and preview.
2. Missing `rg` produces the same bounded result through the fallback.
3. Search ignores symlink/junction escapes and heavy directories.
4. Clicking a result opens the file and reveals the match without writing cursor state to the layout snapshot.
5. A terminal tab streams two delayed output chunks before completion.
6. Stop terminates the active process and the terminal returns to an idle state.
7. Absolute/traversing cwd, malformed command lines, and concurrent commands are rejected with actionable errors.
8. Terminal tabs survive Workspace switching and application restart; their transient output does not.
9. Focused tests, Desktop/Workers tests, typecheck, lint, build, and Electron desktop QA pass.
