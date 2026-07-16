# Code Translator

A VS Code extension that explains C code line by line in plain English, for beginner and "vibe" coders. Move your cursor to a line of C code and the sidebar updates with a syntax breakdown and a plain-English explanation — no highlighting, no chat, no clicking required.

> This README is a work in progress — full feature list, settings table, and screenshots are coming in a later release pass.

## Where the panel lives

Code Translator opens in the **Secondary Side Bar** — the same right-hand panel area used by tools like GitHub Copilot Chat — rather than the main editor area, so it never covers or splits your code. If the Secondary Side Bar isn't visible, open it with **View → Appearance → Secondary Side Bar**, or **Ctrl+Alt+B**.

You can still drag the Code Translator icon to the left Activity Bar (or anywhere else) if you prefer a different layout — that's a normal VS Code per-user preference, not something the extension controls.

> Requires VS Code 1.106 or later (the version that added extension-registered Secondary Side Bar views) — this is enforced by the extension's `engines.vscode` requirement, so it won't install on older versions at all.
