# Code Translator

A VS Code extension that explains C code line by line in plain English, for beginner and "vibe" coders. Move your cursor to a line of C code and the sidebar updates with a syntax breakdown and a plain-English explanation — no highlighting, no chat, no clicking required.

Everything runs locally with rule-based logic. **No code ever leaves your machine.**

## Features

- **Syntax Breakdown** — a table naming each part of the line (data type, name, parameters…), with clickable documentation links for types, keywords, and standard-library functions.
- **What's Happening** — one plain-English sentence describing what the line does. `write(1, "A", 1);` becomes *"Writes "A" to the terminal — 1 byte of it."*
- **As-you-type explanations** — half-finished lines get an in-progress explanation of what you're building so far.
- **Bit-shift visuals** — shift operations show the binary before/after, so you can see the bits move.
- **Deeper Dive (optional, off by default)** — a local AI model (via Ollama) explains *why* a line exists in its function. Never required; see setup below.

## Installation

### Step 1 — Get the installer file

The installer is a file ending in `.vsix` (think of it as a zip that VS Code knows how to install).

- Go to this repo's **[Releases page](https://github.com/PChan888/Code-Teacher/releases)** and download the `.vsix` file from the newest release.
- Or use the file directly if someone sent it to you.

> Don't use the green "Code → Download ZIP" button — that's the source code for developers, not the installer.

### Step 2 — Install it in VS Code

1. Open VS Code.
2. Open the Extensions panel: click the four-squares icon in the left bar (or `Ctrl+Shift+X` — Mac: `Cmd+Shift+X`).
3. At the top of that panel, click the `···` (three dots) → **Install from VSIX...**
4. Pick the `.vsix` file you downloaded. The extension installs instantly — no restart needed.

### From source (for contributors)

Requires [Node.js](https://nodejs.org) and [git](https://git-scm.com).

```bash
git clone https://github.com/PChan888/Code-Teacher.git
cd Code-Teacher
npm install
npm run compile
```

Then open the folder in VS Code and press **F5** — a second VS Code window opens with the extension running. Or package your own installer with `npx @vscode/vsce package`, which produces a `.vsix` you can install using the steps above.

## How to use

1. Open any C file (a file ending in `.c`).
2. Open the panel: `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) → **Code Translator: Open Panel**. (After the first time, it's usually already there in the Secondary Side Bar.)
3. Click on any line of code. The panel updates automatically as your cursor moves — that's it. There's nothing else to learn.

If a line shows "I can't break this line down yet," that's intentional: the extension only explains what it's sure about, and never guesses.

## Where the panel lives

Code Translator opens in the **Secondary Side Bar** — the same right-hand panel area used by tools like GitHub Copilot Chat — rather than the main editor area, so it never covers or splits your code. If the Secondary Side Bar isn't visible, open it with **View → Appearance → Secondary Side Bar**, or **Ctrl+Alt+B** (Mac: **Cmd+Option+B**).

You can still drag the Code Translator icon to the left Activity Bar (or anywhere else) if you prefer a different layout — that's a normal VS Code per-user preference, not something the extension controls.

> Requires VS Code 1.106 or later (the version that added extension-registered Secondary Side Bar views) — this is enforced by the extension's `engines.vscode` requirement, so it won't install on older versions at all.

## Settings

Open Settings (`Ctrl+,` — Mac: `Cmd+,`) and search for "Code Translator":

| Setting | Default | What it does |
|---|---|---|
| `codeTranslator.docsProvider` | `cppreference` | Which site opens when you click a documentation link (`cppreference` or `geeksforgeeks`). |
| `codeTranslator.ai.enabled` | `false` | Turns on the optional Deeper Dive AI section. Zero network calls unless enabled. |
| `codeTranslator.ai.model` | `llama3.2` | Which local Ollama model Deeper Dive uses. |

## Optional: Deeper Dive (local AI)

The extension is fully functional without this. If you want the extra "why does this line exist" section:

1. Install [Ollama](https://ollama.com) and make sure it's running (it starts automatically as a background service after install).
2. Pull a model: `ollama pull llama3.2`
3. In VS Code Settings, set `codeTranslator.ai.enabled` to `true`.
4. If you pulled a different model, set `codeTranslator.ai.model` to its exact name (`ollama list` shows what's installed).
5. Move the cursor to a line of code — the Deeper Dive section appears below "What's Happening" and populates within a few seconds.

**Troubleshooting:** if Deeper Dive never appears, confirm Ollama is running (`ollama list` should work in a terminal) and the model name in settings matches exactly. After one failed attempt the extension disables Deeper Dive for the rest of the session instead of retrying — reload the window to try again.

## Privacy

The rule-based explanations make **zero network calls** — everything is computed locally. The only times the extension touches anything external are: (1) clicking a documentation link, which opens your normal browser, and (2) Deeper Dive, which talks only to Ollama running on your own computer, and only if you turned it on.

## Feedback

Found an explanation that confused you, or a line that got no explanation? Please open an issue — that's exactly the feedback this project needs. Include the line of code and what the panel said.
