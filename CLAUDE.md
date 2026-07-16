# CLAUDE.md — Code Translator

VS Code extension that explains C code line by line in plain English. Target audience: beginner and "vibe" coders. Think Python Tutor, but focused on *explanation*, not execution.

## Core product rules (do not violate)

1. **Rule-based engine is the product.** All explanations come from the parser + explainer. AI (Ollama) is optional, future, and never required for the extension to work.
2. **Interaction model:** cursor moves to a line → side panel updates automatically. No right-click menus, no highlight-to-explain, no chat. The panel is a **view** (Secondary Side Bar, `contributes.viewsContainers.secondarySidebar`), never an editor-area **webview panel** (`vscode.window.createWebviewPanel`) — a view never occupies editor-grid space, a webview panel does (it can split/cover the editor via `ViewColumn`). Requires `engines.vscode: ^1.106.0` (the version that stabilized extension-registered Secondary Side Bar containers); do not lower this to support older VS Code without re-deciding this placement.
3. **Panel layout:** two sections, always in this order — **Syntax Breakdown** (structured table, top) and **What's Happening** (one plain-English sentence, bottom).
4. **Language scope:** C only. Do not add other languages unless PLAN.md says so.
5. **Tone of explanations:** plain English, no jargon without immediately defining it. A reader who has never programmed should follow the "What's Happening" sentence. Never condescending.
6. **Offline-first:** no network calls anywhere in the rule-based path. Docs links open in the user's browser; that is the only external touchpoint.

## AI / Ollama constraints (Deeper Dive)

These apply no matter which local model `codeTranslator.ai.model` points at — swapping `llama3.2` for any other Ollama model does not bypass anything below, because the restrictions are split into two kinds:

**Structural (enforced by code — hold regardless of model):**
- `ai.enabled` defaults to `false`. With it off, `scheduleAiRequest` in `extension.ts` returns before any timer is set — zero network calls, no exceptions. This is what makes core rule #1 ("AI is optional... never required") actually true rather than aspirational.
- Deeper Dive is additive only. It is never in the data path for the Syntax Breakdown or "What's Happening" sentence (`ExplainerPanel.update` computes and posts those before `scheduleAiRequest` is even called) — a broken, slow, or hallucinating model can't corrupt or block the rule-based output.
- One request in flight at a time. `cancelPendingAiRequest()` runs at the top of every `render()` call, aborting any pending timer or in-flight fetch before a new one is scheduled. A stale response (`controller.signal.aborted`) is dropped rather than rendered — the model's answer can never overwrite what's currently on screen for a different line.
- Any failure (unreachable, timeout, bad response shape) sets `aiSessionDisabled = true` for the rest of the VS Code window session and shows exactly one notification — no retry storms, no repeated popups.
- The client (`ollamaClient.ts`) only ever POSTs to `http://localhost:11434/api/generate` — never a user- or model-suppliable URL. There is no code path that lets a model response redirect where the *next* request goes.

**Instructional (prompt wording — a request, not a guarantee):**
- **Scope: WHY only, never WHAT.** The rule-based engine already owns "what this line does" (Syntax Breakdown + What's Happening). Deeper Dive's only job is a deeper-level "why does this line exist in this function" — it must not restate or re-derive what the rule-based sections already say. `buildDeeperDivePrompt` (`ai/prompt.ts`) passes the rule-based sentence into the prompt specifically so the model has it as context to avoid repeating, not to summarize.
- **Same framework, same tone as the rest of the tool.** The prompt explicitly tells the model to follow core rule #5 (plain English, no undefined jargon, never condescending, beginner audience) — Deeper Dive is a *deeper* explanation, not a differently-voiced one. It should read like the same tool talking, not a different assistant.
- Neither of the above is enforced by code — nothing checks sentence count, checks for repeated content, or validates tone. This shapes what a cooperative model *tries* to produce, but treat the model's output as untrusted, unstructured text — same trust level as a docs-link URL before the origin allowlist, not as something the panel can rely on.
- If a stricter contract is ever needed (e.g. rejecting responses that are too long, or that echo the raw code), that validation would need to be added explicitly in `ollamaClient.ts` or `extension.ts` — swapping models or editing the prompt text alone won't produce it.

## Architecture

```
src/
  extension.ts                entry point: activate(), cursor/document listeners, panel command
  parser/cParser.ts           parseLine(raw) → ParsedLine (discriminated union)
  parser/partialParser.ts     parsePartial(raw) → PartialParse | null — see exception below
  explainer/explainer.ts      explain(ParsedLine) → { syntax: SyntaxEntry[], plain: string }
  explainer/expressions.ts    describeExpression / describeCompoundCondition / ... (English, expression-level)
  explainer/knownFunctions.ts stdlib function dictionary (English, one entry per function)
  panel/ExplainerPanel.ts     sidebar WebviewViewProvider: update(lineNumber, line, parsed, explanation), updatePartial(...), showEmpty()
  panel/rows.ts                pure: buildRenderedRows(explanation, parsed, provider) — doc-link HTML + dedup, unit-testable
  panel/highlight.ts          pure, VS Code-free HTML rendering helpers (tokenizer, bit-visual diff, doc-link wrapping) — unit-testable
  docs/docsLinks.ts           pure: getDocsLink / getEmbeddedDocsLinks (Phase 3) — VS Code-free, unit-testable
  ai/ollamaClient.ts          generate({model, prompt, signal}) — thin one-shot POST to localhost Ollama, no chat state
  ai/prompt.ts                pure: findEnclosingFunctionText / buildDeeperDivePrompt (Phase 4) — VS Code-free, unit-testable
```

Data flow is strictly one-directional: `extension.ts` reads the cursor line → `parseLine` → `explain` → `ExplainerPanel.update`. Keep it that way.

- **parser** knows nothing about English or HTML. It only produces structured data (`ParsedLine`).
- **explainer** knows nothing about VS Code or HTML. It maps `ParsedLine` → text.
- **panel** knows nothing about C. It only renders `Explanation`/`PartialParse` objects.

**Documented exception:** `parser/partialParser.ts` (Phase 2.5) returns English `intent`/`hint` strings directly instead of a structured type handed to a separate explain step. An in-progress line doesn't have a stable structured shape worth extracting — the matched prefix pattern *is* the explanation. This is the one place in the codebase where the parser layer contains English on purpose; it's called out at the top of that file too. Don't use it as precedent for putting English elsewhere in `cParser.ts` or its siblings — completed-line parsing stays strictly structured.

When adding a new construct: add a variant to the `ParsedLine` union, add a match branch in `parseLine`, add a case in `explain`. Never put parsing logic in the explainer or English strings in the parser (outside the documented exception above).

## Conventions

- TypeScript strict mode. No `any` unless unavoidable; prefer discriminated unions and exhaustive `switch` (add a `never` default to catch unhandled kinds).
- Parsing is regex-based, one line at a time. This is intentional — do not introduce a full C grammar/AST library without explicit instruction.
- `C_TYPES` in cParser.ts is the single source of truth for recognized type names. It includes 42-school style prefixes (`t_`, `s_`, `e_`). Extend it there only.
- Match branches in `parseLine` are ordered most-specific → least-specific (comments → bit shift → return → control flow → function def → var decl → assignment → call → unknown). Preserve ordering when inserting new branches; add a comment saying why the branch sits where it does.
- `unknown` is the safe fallback. A wrong explanation is worse than "I can't explain this line yet." When in doubt, return `unknown`.
- Bit shifts always show the binary before/after visual (`bitShiftVisual`), grouped in 8-bit chunks.
- Webview HTML lives inline in `ExplainerPanel._getHtml`. Use VS Code CSS variables (`--vscode-*`) for all colors so themes work.
- Settings namespace: `codeTranslator.*` (e.g. `codeTranslator.docsProvider`). Register every setting in `package.json` `contributes.configuration`.

## Build & test

- `npm run compile` (tsc), `npm run watch` for dev. Output goes to `out/`.
- Test by pressing F5 in VS Code (Extension Development Host), open a `.c` file, run "Code Translator: Open Panel", move the cursor.
- Unit tests (once added) target `parseLine` and `explain` — pure functions, no VS Code API needed. Do not write tests that require the VS Code runtime unless testing the panel itself.
- After any parser change, verify against `test/fixtures/sample.c` (create it if missing) covering every `ParsedLine` kind.

## Definition of done for any task

- `npm run compile` passes with zero errors.
- Every `ParsedLine` kind has an `explain` case (exhaustive switch compiles).
- New constructs have at least 3 test lines in the fixture file: a typical case, an edge case, and a line that should fall through to `unknown`.
- No regressions: previously working constructs still parse (run the existing tests).
