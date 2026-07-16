# PLAN.md — Implementation Roadmap

You are implementing features for the Code Translator VS Code extension. Read `CLAUDE.md` first and follow it exactly. Work through the phases **in order** — do not start a phase until the previous one meets its acceptance criteria. Within a phase, complete tasks top to bottom. Compile (`npm run compile`) after every task.

Current state: working prototype. `parseLine` handles function defs, function calls, variable declarations, assignments, bit shifts, if/else/while/for/return, and comments. The panel renders a syntax table and a plain-English sentence, updating on cursor move in `.c` files.

---

## Phase 0 — Test harness (do this before touching the parser)

**Goal:** a safety net so later phases can't silently break existing behavior.

1. Add dev dependencies: `vitest` (or `jest` if vitest fails to install). Add `"test": "vitest run"` to package.json scripts.
2. Create `test/parser.test.ts` covering every existing `ParsedLine` kind — at least one assertion per kind, using real C lines (e.g. `int close_window(t_fractol *f)`, `x <<= 2;`, `255 << 16`, `// comment`).
3. Create `test/explainer.test.ts` — for each kind, assert `explain()` returns a non-empty `plain` string and expected `syntax` labels.
4. Create `test/fixtures/sample.c` — one file containing an example of every supported construct, with a comment above each naming the expected kind.

**Acceptance:** `npm test` passes; every existing `ParsedLine` kind has coverage.

---

## Phase 1 — Parser coverage expansion

**Goal:** far fewer lines fall through to `unknown` on real beginner C code.

Add these constructs. For each: new `ParsedLine` variant → `parseLine` branch (mind the ordering rule in CLAUDE.md) → `explain` case → tests.

1. **Preprocessor:** `#include <stdio.h>` / `#include "header.h"` / `#define NAME value` / `#define MACRO(x) ...` / `#ifndef` guards.
   - Explain includes as "brings in the <stdio.h> library, which provides functions like printf".
   - Maintain a small lookup of common headers (stdio.h, stdlib.h, string.h, math.h, unistd.h) → one-line description. Unknown headers: generic wording.
2. **Struct/enum/typedef:** `typedef struct s_point { ... } t_point;` opener lines, `struct s_x {`, `} t_name;` closers, `enum` openers.
   - A struct member line inside a struct is just a variable_decl — that's fine, but the closer line should be recognized.
3. **Arrays:** `int arr[10];`, `char name[] = "hi";`, indexing in assignments (`arr[i] = 5;`).
4. **Pointer operations:** dereference assignment (`*ptr = 5;`), address-of in values (`p = &x;`), arrow access (`f->width = 800;`), dot access (`p.x = 3;`).
   - Arrow explanation: "accesses the `width` field of the struct that `f` points to".
5. **Increment/decrement:** `i++;`, `--count;` — explain as "adds 1 to i" / "subtracts 1 from count".
6. **Type casts:** `(int)x`, `(t_data *)malloc(...)` inside declarations and assignments. Add a `cast` syntax entry when present.
7. **Ternary:** `x = a > b ? a : b;` — explain as if/else in one sentence.
8. **Condition & expression translation:** create `src/explainer/expressions.ts` with `describeExpression(expr: string): string` that turns simple expressions into English: `x == 5` → "x equals 5", `i < 10` → "i is less than 10", `a && b` → "both … and …", `!found` → "found is false", `y * 2` → "y times 2". Handles `== != < > <= >= && || ! + - * / %`. If the expression is too complex to translate confidently, return it unchanged wrapped in backticks — never a wrong translation. Use it in control_flow conditions, assignment values, declaration initializers, and return values.
   - **For loops get special treatment:** split `for (init; cond; step)` into three parts and explain each: `for (i = 0; i < 10; i++)` → "Starts i at 0, repeats the block below while i is less than 10, and adds 1 to i after each round." The Syntax Breakdown shows three rows: setup / keep-going condition / after each round.
9. **Known-function dictionary:** create `src/explainer/knownFunctions.ts` — a map from function name → `{ summary, params: string[] (meaning of each argument by position), build(args) => sentence }`. The `function_call` case in `explain` checks this map first; unmapped functions keep the current generic sentence.
   - Cover at least: `write`, `read`, `printf`, `putchar`, `malloc`, `free`, `strlen`, `strcpy`, `open`, `close`, `exit`, `scanf`.
   - `write`/`read`: translate file descriptors in the sentence (0 = keyboard input, 1 = the terminal, 2 = error output). Example: `write(1, "A", 1)` → `Writes "A" to the terminal — 1 byte of it. (The first 1 means "standard output", which is the terminal.)`
   - Use `params` to label each argument row in the Syntax Breakdown (e.g. "where to send it: 1 (the terminal)") instead of a single "arguments" row.
   - In `build`, describe argument types differently: string literals as the text itself, numbers as counts/values, variables as "whatever <name> holds".
   - This file lives in the explainer layer: no parsing logic, no HTML, pure data + string assembly. Test at least 3 mapped functions and 1 unmapped fallback.
10. **`main` special case:** explain `int main(void)` / `int main(int argc, char **argv)` as the program's entry point, with argc/argv explained.

Known prototype bugs to fix while in there:
- Bit-shift branch fires too early: `x = 1 << 3;` should be an assignment whose *value* contains a shift, and compound shift assignment `x <<= 2` currently mis-hits the bit_shift regex. Restructure so bit_shift only matches when the shift is the whole expression, and assignments detect an embedded shift and attach the binary visual.
- `bitShiftVisual` receives a value that may not be a number literal (e.g. a variable name). Only render the visual when the left side parses as an integer literal; otherwise explain the shift in words only.

**Acceptance:** all Phase 1 constructs parse and explain; the two bugs have regression tests; `test/fixtures/sample.c` updated; `npm test` passes; every gold example in the quality bar below has a passing test asserting the exact sentence.

### Explanation quality bar (applies to every construct, in every phase)

**Rule: the "What's Happening" sentence must never contain untranslated code symbols.** Operators, file descriptors, and expressions are rendered as English words. Echoing the raw code back at the user ("Loops using the expression: i = 0; i < 10; i++") counts as a failure, not an explanation. If a construct can't be translated confidently, fall through to `unknown` — never ship a half-translated sentence.

Gold-standard examples — tests must assert these sentences exactly:

| Line | Required "What's Happening" sentence |
|---|---|
| `write(1, "A", 1);` | Writes "A" to the terminal — 1 byte of it. (The first 1 means "standard output", which is the terminal.) |
| `for (i = 0; i < 10; i++)` | Starts i at 0, repeats the block below while i is less than 10, and adds 1 to i after each round. |
| `if (x == 5)` | Checks whether x equals 5; runs the block below if so. |
| `count += 1;` | Increases count by 1. (Same as count = count + 1.) |
| `int x = y * 2;` | Creates an integer variable named x and sets it to y times 2. |
| `return (0);` | Ends the function here and hands back 0. (0 usually means "everything went fine.") |
| `char *str;` | Creates a variable named str that holds the memory address of a char — a "pointer". It doesn't hold text itself, it points to where text lives. |
| `i++;` | Adds 1 to i. |

When adding any new construct in any phase, write its gold sentence first (typical case + one edge case), add both as exact-match tests, then implement until they pass.

---

## Phase 2 — Panel polish

**Goal:** the webview feels like a real product, not a debug view.

1. Move the webview to a **sidebar view** (`contributes.views` + `WebviewViewProvider`) instead of an editor-column panel, so it doesn't steal editor space. Keep the `codeTranslator.openPanel` command working (it focuses the view).
2. Don't rebuild full HTML on every cursor move — post a message (`webview.postMessage`) and update the DOM with a small inline script. Prevents flicker.
3. Render the bit-shift binary visual in a monospace `<pre>` block with the changed bits highlighted.
4. Empty/unknown states: friendly copy for blank lines ("Move your cursor to a line of code") and unknown lines ("I can't break this line down yet — this is a preview of what the parser supports").
5. Show the current line number and the raw code line at the top of the panel, syntax-highlighted with basic token coloring.

**Acceptance:** extension runs in the Extension Development Host with the sidebar view; no flicker when arrowing through a file; all states render.

---

## Phase 3 — Docs links

**Goal:** clicking a syntax label opens documentation.

1. Add setting `codeTranslator.docsProvider`: enum `cppreference` (default) | `geeksforgeeks`. Register in `package.json`.
2. Create `src/docs/docsLinks.ts`: `getDocsUrl(entry: SyntaxEntry, parsed: ParsedLine, provider: string): string | undefined`.
   - C types → cppreference type pages; stdlib function calls (printf, malloc, free, strlen, …) → their cppreference pages; control-flow keywords → language pages; operators → operator pages.
   - Maintain an explicit map for ~30 common stdlib functions; fall back to a site search URL (`https://en.cppreference.com/mwiki/index.php?search=<term>`) for unmapped names.
   - Return `undefined` for user-defined names (their own variables/functions) — no link.
3. In the webview, linkable labels get an underline + link cursor; clicking posts a message to the extension, which calls `vscode.env.openExternal`. Never open URLs directly from the webview.

**Acceptance:** clicking "printf" opens its cppreference page; user-defined identifiers are not clickable; changing the setting switches providers without reload.

---

## Phase 4 — Ollama integration (optional AI layer)

**Goal:** deeper "why" explanations for users who have Ollama installed. The extension must remain fully functional without it.

1. Setting `codeTranslator.ai.enabled` (default **false**) and `codeTranslator.ai.model` (default `llama3.2`).
2. `src/ai/ollamaClient.ts`: POST to `http://localhost:11434/api/generate`, 5s timeout, one-shot prompt (no chat). If unreachable: silently disable for the session and show one non-blocking notification.
3. Add a third collapsible panel section, **Deeper Dive**, only visible when AI is enabled. Shows a spinner, then the model's response.
4. Prompt template: include the current line, the enclosing function's text (grab lines from the last `function_def` above the cursor to the matching closing brace, best-effort), and the rule-based explanation. Instruction: "In 2–3 sentences and plain English, explain WHY this line exists in this function. Do not repeat the syntax breakdown."
5. Debounce: only fire the AI request 800ms after the cursor stops, and cancel in-flight requests on cursor move.

**Acceptance:** with Ollama off/uninstalled, extension behaves exactly as in Phase 3 (rule-based paths make zero network calls). With Ollama running, Deeper Dive populates within a few seconds and stale responses never overwrite newer ones.

---

## Phase 5 — Release prep

1. README.md: what it is, GIF placeholder, feature list, settings table, "no data leaves your machine" note.
2. `.vscodeignore`, `LICENSE`, bump to `0.1.0`, verify `vsce package` produces a `.vsix` that installs cleanly.
3. Final pass on `test/fixtures/sample.c` — cursor through every line in the dev host and sanity-check each explanation reads well to a beginner.

**Acceptance:** `.vsix` installs into a clean VS Code and works on a real `.c` file.

---

## Working rules for the implementing model

- One phase per session/PR if possible. Never mix phases.
- If a task is ambiguous, choose the simplest interpretation consistent with CLAUDE.md and note the decision in a code comment.
- If you can't make a construct parse reliably, let it fall to `unknown` and note it in a `KNOWN_GAPS.md` file rather than shipping a wrong explanation.
- Run `npm run compile && npm test` before declaring any task done.
