# PLAN.md — Implementation Roadmap

You are implementing features for the Code Translator VS Code extension. Read `CLAUDE.md` first and follow it exactly. Work through the phases **in order** — do not start a phase until the previous one meets its acceptance criteria. Within a phase, complete tasks top to bottom. Compile (`npm run compile`) after every task.

Current state: working prototype. `parseLine` handles function defs, function calls, variable declarations, assignments, bit shifts, if/else/while/for/return, and comments. The panel renders a syntax table and a plain-English sentence, updating on cursor move in `.c` files.

---

## Phase 0 — Test harness (do this before touching the parser) — ✅ DONE

**Goal:** a safety net so later phases can't silently break existing behavior.

1. Add dev dependencies: `vitest` (or `jest` if vitest fails to install). Add `"test": "vitest run"` to package.json scripts.
2. Create `test/parser.test.ts` covering every existing `ParsedLine` kind — at least one assertion per kind, using real C lines (e.g. `int close_window(t_fractol *f)`, `x <<= 2;`, `255 << 16`, `// comment`).
3. Create `test/explainer.test.ts` — for each kind, assert `explain()` returns a non-empty `plain` string and expected `syntax` labels.
4. Create `test/fixtures/sample.c` — one file containing an example of every supported construct, with a comment above each naming the expected kind.

**Acceptance:** `npm test` passes; every existing `ParsedLine` kind has coverage.

**Status:** all four tasks complete. `vitest` installed (no need to fall back to jest); `npm run compile && npm test` both pass (39/39 tests). All 8 `ParsedLine` kinds have coverage in both test files, and `test/fixtures/sample.c` exercises every kind with a naming comment above each.

**Note for Phase 1:** while writing the `x <<= 2;` regression test, traced the regex and found the bug description above (under "Known prototype bugs") is inaccurate for that specific line — the `=` between `<<` and the digit already blocks the `bit_shift` regex, so `x <<= 2;` correctly parses as `assignment` today (locked in by a test). The *actual* reproducible bug is `x = 1 << 3;`, which gets mis-hit as `bit_shift` (also locked in by a regression test, marked as a known bug to fix). Nothing else was left unfinished.

---

## Phase 1 — Parser coverage expansion — ✅ DONE

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
| `if (x == 5)` | Checks if x equals 5. If it's true, the block below runs. |
| `count += 1;` | Increases count by 1. (Same as count = count + 1.) |
| `int x = y * 2;` | Creates an integer variable named x and sets it to y times 2. |
| `return (0);` | Ends the function here and hands back 0. (0 usually means "everything went fine.") |
| `char *str;` | Creates a variable named str that holds the memory address of a char — a "pointer". It doesn't hold text itself, it points to where text lives. |
| `i++;` | Adds 1 to i. |

When adding any new construct in any phase, write its gold sentence first (typical case + one edge case), add both as exact-match tests, then implement until they pass.

**Status:** all 10 constructs implemented, both known bugs fixed, and all 8 gold-standard sentences (plus the for-loop sentence) pass as exact-match tests. `npm run compile && npm test` both pass (102/102). `src/explainer/expressions.ts` and `src/explainer/knownFunctions.ts` created as specified; all 12 named stdlib functions covered. `test/fixtures/sample.c` rewritten to exercise every `ParsedLine` kind, verified line-by-line against actual parser output. `KNOWN_GAPS.md` created per the working rules, documenting constructs that intentionally fall to `unknown`/a safe fallback: `switch` statements, multi-dimensional arrays, bit-field members, comma expressions, double-pointer depth (`char **argv` collapses to a single `pointer` flag), unrecognized preprocessor directives (`#pragma`, `#undef`, `#else`, `#elif`), and dereference assignments with a space after `*` (`* ptr = 5;` — misread as a block-comment continuation line; the no-space style `*ptr = 5;` is disambiguated correctly).

**Deviations from a literal reading of the plan:**
- Item 2's struct example ("`typedef struct s_point { ... } t_point;`") reads as a same-line brace. The opening `{` was made *optional* on the struct/enum opener regex (mirroring how `function_def` already treats it), so Allman-style struct headers — brace on its own line, the convention CLAUDE.md's target audience (42-school C) typically uses — are also recognized as the same `block_open` result. Same-line and Allman-style both parse identically; this only widens what's accepted, it doesn't change any documented behavior.
- While implementing item 4, found and fixed a real parser ambiguity not called out in the plan: `*ptr = 5;` and a block-comment continuation line (`* explanation text`) both start with `*`, so the deref-assignment work required tightening the existing comment-line check rather than just adding a new branch. Disambiguated via a no-space heuristic (documented above and in `KNOWN_GAPS.md`).
- Item 9's example syntax-row format ("where to send it: 1 (the terminal)") implied the argument *value* itself should carry the fd's English meaning, not just its label — added an optional `argValue()` hook to `KnownFunction` so `write`/`read` can annotate that row without affecting other mapped functions.

Nothing from Phase 1's scope was left unimplemented.

---

## Phase 2 — Panel polish — ✅ DONE (approved)

**Goal:** the webview feels like a real product, not a debug view.

1. Move the webview to a **sidebar view** (`contributes.views` + `WebviewViewProvider`) instead of an editor-column panel, so it doesn't steal editor space. Keep the `codeTranslator.openPanel` command working (it focuses the view).
2. Don't rebuild full HTML on every cursor move — post a message (`webview.postMessage`) and update the DOM with a small inline script. Prevents flicker.
3. Render the bit-shift binary visual in a monospace `<pre>` block with the changed bits highlighted.
4. Empty/unknown states: friendly copy for blank lines ("Move your cursor to a line of code") and unknown lines ("I can't break this line down yet — this is a preview of what the parser supports").
5. Show the current line number and the raw code line at the top of the panel, syntax-highlighted with basic token coloring.

**Acceptance:** extension runs in the Extension Development Host with the sidebar view; no flicker when arrowing through a file; all states render.

### Phase 2 revision — required before Phase 2 is accepted (user feedback, 2026-07)

Fix these three issues. Phase 2 is not done until all three pass review.

1. **Friendlier Syntax Breakdown labels + type glosses.** Labels must read like a human wrote them, and type values get a plain-English gloss.
   - Rename labels: `type` → `data type`, `statement` → `what kind of line`, `condition / value` → `the check`, `variable` → `variable being changed`, `operator` → `operation`, `value` → `new value`.
   - Add a `TYPE_GLOSSES` map in the explainer (single source of truth, keyed by type name): `int` → "int — a whole number", `char` → "char — a single character (one letter, digit, or symbol)", `float`/`double` → "… — a number with decimals", `void` → "void — nothing/no value", `unsigned` → "… — a whole number that can't be negative", `size_t` → "size_t — a whole number used for sizes and counts", `t_*`/`s_*` → "a custom type defined in this project". Use the gloss everywhere a type appears in the Syntax Breakdown, e.g. `data type: int — a whole number`.
   - Pointers: `pointer to int — holds the memory address of a whole number`.
2. **Compound conditions read badly.** `if (right == 0 && down == 0)` currently produces "Checks whether both right equals 0 and down equals 0; runs the block below if so." — the "both X and Y; … if so" structure is hard to parse. New pattern for `&&`/`||` conditions — split into two sentences and enumerate:
   - `&&`: "Checks two things: right is 0, and down is 0. Both must be true for the block below to run."
   - `||`: "Checks two things: x is 5, or y is negative. If either one is true, the block below runs."
   - Three or more clauses: "Checks three things: …". Single conditions keep the existing one-sentence form.
   - Also add to Syntax Breakdown one row per clause: `check 1` → "right is 0", `check 2` → "down is 0", plus `how they combine` → "both must be true (&&)".
   - Add these as exact-match gold tests before implementing.
3. **Panel takes too much horizontal space on the left.** Do not revert the sidebar architecture, but:
   - In `package.json`, keep the view container but verify the view works well narrow (~300px): the Syntax Breakdown table must wrap values, never overflow horizontally.
   - Add a note to README (create the section if README doesn't exist yet): the panel can be moved to the right side by dragging the Code Translator icon from the left Activity Bar into the Secondary Side Bar (View → Appearance → Secondary Side Bar, or Ctrl+Alt+B). Extensions cannot set this position programmatically; document it instead.
   - `codeTranslator.openPanel` should reveal the view without stealing focus from the editor (`preserveFocus: true`).

**General sentence style rules (add to the quality bar):** prefer two short sentences over one long one; avoid semicolons in "What's Happening" — beginners read them as code; avoid the word "whether" (use "Checks if …" or "Checks two things: …").

**Status: all three revision items implemented, awaiting your review/approval.** `npm run compile && npm test` pass (118/118). Summary:

1. **Labels + glosses:** all six label renames applied (scoped precisely — e.g. `variable`/`operator`/`value` only renamed on the *plain-assignment* target row, not on `bit_shift`'s unrelated `value` row, since that's a different thing being described). `typeGloss`/`pointerTypeGloss` implement exactly the specified type set (int/char/float/double/void/unsigned/size_t/t_*/s_*); applied to `variable_decl`'s `data type` row and, since the task said "everywhere a type appears in the Syntax Breakdown," also to `function_def`'s `return type` and `parameter N` rows. The pointer example (`pointer to int — holds the memory address of a whole number`) matches exactly. Glosses are Syntax-Breakdown-only — the "What's Happening" sentence wording (already-approved gold rows like "Creates an integer variable...") is untouched.
2. **Compound conditions:** new `describeConditionClause`/`splitConditionClauses`/`describeCompoundCondition` in `expressions.ts`. Both example sentences (`&&` and `||`, 2-clause) match your exact text, plus a 3-clause "All must be true" case and the `check N`/`how they combine` syntax rows — all as exact-match tests written first. Applied to `while` too (not just `if`), with loop-appropriate wording ("the loop to keep going" instead of "the block below to run") since the task framed this as "conditions" generally, not if-only — flagged here in case that's wider than intended. The single-condition `if` sentence also lost its semicolon and "whether" (now "Checks if x equals 5. If it's true, the block below runs.", matching the updated gold table row), and the same "whether" fix was applied to `#ifndef`/`#ifdef` sentences elsewhere in the file since the style rule reads as global, not if-only.
3. **Panel width:** `.label` no longer has `nowrap`/fixed 140px — it's `white-space: normal` at 42% width, `table-layout: fixed`, and `.value`/`td` get `word-break`/`overflow-wrap` so long unbroken tokens can't force horizontal scroll. Added `box-sizing: border-box` + `overflow-x: hidden` on `body` as a belt-and-suspenders guard. `README.md` created (didn't exist) with the Secondary Side Bar drag instructions. `reveal()` now passes `{ preserveFocus: true }` to the focus command.

**Caveat — same as last time, still true:** I have no interactive VS Code host in this environment, so none of this has been visually verified at an actual ~300px width or clicked through in the Extension Development Host. Everything above is confirmed by compile + unit tests only (including a new `renderBitVisual`/`highlightLine` test suite in `test/highlight.test.ts` that doesn't need the VS Code runtime). You'll still need to eyeball the narrow-width table wrapping and the compound-condition sentences in a real editor before calling this done.

**Out-of-band fix #2 during the Phase 2 revision (do not revert): webview font scaling.** The zoom/auto-scale feature set `font-size` on `html`, but VS Code injects `_defaultStyles` into every webview which pins `body { font-size: var(--vscode-font-size) }` (absolute px) — severing inheritance from html. Result: computed style on html read back "correctly" while nothing visible changed, because every `em` in the panel resolves against body's pinned size. Fixed in `ExplainerPanel.ts` by moving both the auto `clamp()` rule and the manual runtime override to `body` with `!important`, and reading back `document.body` instead of `document.documentElement`. The temporary red-outline diagnostic was removed. If this is ever restructured: font-size rules for this webview must target `body` (or a wrapper), never `html`.

**Out-of-band fix during the Phase 2 revision (do not revert):** user testing with `test/fixtures/stress.c` found that malformed parameter lists were accepted — invalid C like `int main(int argc, char argv[][])` was confidently explained as a valid main. `parseParams` in `cParser.ts` now validates parameter names (allows `argv`, `argv[]`, `argv[10]`, `argv[][10]`; rejects `argv[][]`) and returns `null` on anything malformed, making the whole line fall to `unknown`. Locked in by regression tests in `test/parser.test.ts` ("rejects a malformed parameter list"). Any future parser restructuring must keep these tests green. `test/fixtures/stress.c` is an adversarial fixture (traps + gaps, annotated line by line) — keep it compiling and consistent when parser behavior changes.

**Out-of-band fix, round 2 — all remaining `stress.c` TRAPs fixed:** a cross-session alignment check surfaced 6 more TRAPs (confident-but-wrong parses) documented in `stress.c`, and fixing them turned up 2 more that weren't caught in that initial count — 8 total, all now fixed:

1. **Pointer return type dropped** (`char *get_name(void)` reported return type `"char"`). `function_def` now carries `returnPointer: boolean`; the explainer glosses it (`pointer to char — holds the memory address of...`) and mentions it in the plain sentence.
2. **Combined shifts merged into one** (`1 << 8 | 1 << 16;` parsed as a single garbled `bit_shift`). A stray `|`/`&`/`^`/second-shift in the captured left side now rejects the match (`hasStrayBitwiseOperator`), applied to both the standalone `bit_shift` branch and the embedded-shift-in-assignment detection in the explainer.
3. **`switch (argc)` misparsed as a function call** named "switch". Explicitly guarded to `unknown` before the line ever reaches the `function_call` regex.
4. **`i == 5;` misparsed as an assignment** (operator `=`, value `"= 5"` — the assignment regex matched the first `=` of `==`). Added a `(?!=)` negative lookahead so the matched `=` can't be the start of a `==`.
5. **Trailing `// comment` swallowed into the value** (`i = 7; // note` → value `"7; // note"`). Trailing line comments are now stripped before any value/condition-capturing regex runs, respecting string/char literals (`"http://..."` is not touched).
6. **2D array declaration/index captured garbage** (`grid[2][2]` → arraySize `"2][2"`; `grid[1][1] = 3` → index `"1][1"`). A `]` inside a captured bracket group now rejects the match, falling through to `unknown` (2D arrays are documented as unsupported in `KNOWN_GAPS.md`, not silently wrong).
7. **Shift amount ≥ 32 rendered a silently-wrong visual** (JS's `<<`/`>>` only use the amount mod 32, so `1 << 32` evaluates as `1 << 0` in JS — before/after showed as identical). New `isRenderableShiftAmount` guard omits the visual and explains in words only for amounts ≥ 32.
8. **Comma inside a string literal split `printf` args wrong** (`printf("point: %d,%d\n", pt.x, pp->y)` → 4 garbled args instead of 3). Argument splitting now respects string/char literals (`splitArgs`), same scanning pattern used elsewhere in the parser.

All 8 are locked in by regression tests in `test/parser.test.ts`/`test/explainer.test.ts`, plus every one of `stress.c`'s 65 annotated lines was checked programmatically against live `parseLine` output (all pass) — its `TRAP:` comments were rewritten to `FIXED (was TRAP):` for the resolved ones. `KNOWN_GAPS.md` updated with the still-live limitations this pass intentionally didn't chase (mid-line `/* */` comments not stripped, multi-dimensional arrays still unsupported by design). `npm run compile && npm test` pass (135/135).

Items **7 and 8 were not in my original report** of "6 remaining TRAPs" — I undercounted; `stress.c` actually documented 8, and both missed ones were genuine confident-but-wrong bugs of the same class as the other 6, so I fixed them too rather than leave them half-addressed.

**Approved 2026-07.** One more fix landed after approval was requested but before this note: ternary values (`i = (i > 0) ? i : 0;`) now get a short explanatory note — `"? :"` has no English-word equivalent, so rather than translate it silently the plain sentence appends `(The "? :" is shorthand for an if/else that returns a value — this pattern is called a "ternary" expression.)`. Wired through the shared `describeValue` helper so it applies to every assignment target form and variable declarations, not just the plain case. `npm test` 136/136.

**What I couldn't finish:** I have no interactive VS Code host anywhere in this environment, at any point across the whole phase — every acceptance criterion involving actually looking at the rendered panel (sidebar icon visible, no flicker when arrowing through a file, narrow-width table wrapping, all three states rendering, compound-condition sentences reading well) was verified by me only via compile + unit tests + reading the generated HTML/CSS by eye, never by actually running the extension. Your approval is the only real confirmation this phase has had that the webview genuinely works as intended.

**Addendum (2026-07): placement moved from Activity Bar to Secondary Side Bar.** The original prototype (pre-Phase-0) showed the panel via `vscode.window.createWebviewPanel` beside the editor — a real editor-area webview panel, splitting editor space. Phase 2 deliberately replaced that with a left Activity Bar `WebviewViewProvider` specifically to stop it from occupying editor-grid space, and at the time there was no way for an extension to request the right-side Secondary Side Bar instead — only a user's manual drag could move it there (this is what the Phase 2 status note and the old README wording both said, and were both correct when written).

That's no longer true: VS Code 1.106 (October 2025) stabilized `contributes.viewsContainers.secondarySidebar`, letting an extension register its view container there directly — the same region GitHub Copilot Chat uses. Reasoning for switching: this gets close to the original prototype's visual placement (right side, near the top of that region) while keeping Phase 2's actual goal intact (never splits or covers the editor — a *view*, not an editor-column *webview panel*). Changes made:
- `package.json`: `viewsContainers.activitybar` → `viewsContainers.secondarySidebar`; `engines.vscode` bumped `^1.85.0` → `^1.106.0` (drops support for roughly a year of older VS Code versions — a real compatibility tradeoff, not a free change).
- `CLAUDE.md` rule #2 updated to name the Secondary Side Bar explicitly and state the view-vs-webview-panel distinction, so this isn't re-litigated by accident in a future phase.
- `README.md`'s "Moving the panel to the other side" section rewritten — the old "VS Code extensions can't set this position programmatically" line was accurate when written but is now stale/wrong, so it's replaced rather than left misleading.
- Also fixed while in there: the Syntax Breakdown `.label` column width (`ExplainerPanel.ts`) reduced from `42%` to `30%` — feedback was that the label column (short words like "name", "cast") was taking disproportionate width from the value column in the narrow sidebar. Kept `table-layout: fixed` and `white-space: normal` (the actual Phase 2 overflow fix) unchanged, so longer labels still wrap instead of forcing horizontal scroll — only the split ratio changed, not the wrapping mechanism that prevents the original bug this section documents.

`npm run compile && npm test` pass (209/209, no test changes needed — no test asserts on CSS widths or the view container's manifest location). **Not verified:** as with the rest of this phase, no interactive VS Code host to confirm the Secondary Side Bar placement or the new column ratio actually look right at real widths — this needs a dev-host check like everything else in Phase 2.

**Addendum 2 (2026-07): text auto-scales to the panel's size, plus manual zoom.** All text in the panel now scales with the panel's own width automatically (no user action needed), and a small fixed `#zoomControls` widget (top-right, `−`/`+`/reset) lets a user manually override that with a persistent choice.

- `body { font-size: clamp(10px, 6px + 1.6vw, 16px) !important; }` drives the automatic scale. `vw` here resolves against the webview's own document, not the whole VS Code window — since the webview is its own isolated document, this "just works" without Container Queries or a `ResizeObserver`; every other element's font-size was converted from a hardcoded px value to `em` (relative, inherited) so they all scale together off this one value. The `6px + 1.6vw` formula (not a plain `%vw`) was also a fix: an earlier plain-`vw` version only varied between 400px–640px panel width, well above most sidebar widths, so it sat pinned at the floor regardless of resizing.
- Manual override: clicking `+`/`−` sets `body`'s font-size via a runtime `<style>` tag (`!important`), clamped in code to a 4px–20px range. The 4px floor was an explicit request (to support power users who deliberately run UI text very small) even though it's well below normal legibility — the automatic default never goes below 10px, so a first-time/beginner user never sees illegibly small text unless they deliberately zoom out themselves. The 20px ceiling was corrected after review — I'd initially set `MAX_FONT_PX` to 32 based on my own unstated assumption ("accessibility headroom"), not something requested; the user caught this and set it to 20 directly. The reset button (`⟳`) clears the override and returns to automatic scaling.
- The zoom choice persists via the webview's own `vscode.setState()`/`getState()` (survives the webview being hidden/recreated, independent of `ExplainerPanel`'s `_lastMessage` mechanism on the extension-host side).
- `#zoomControls` itself is deliberately **not** scaled by any of the above (fixed `11px`/`18px` sizing) — if content has been zoomed down to near-illegible sizes, the controls to zoom back in must stay usable regardless.

**Bug found during dev-host testing, fixed by Fable (not me): targeting the wrong element.** My first two implementations targeted `<html>`'s font-size (first via inline style, then via a runtime `!important` `<style>` tag) — both computed correctly (`getComputedStyle(document.documentElement).fontSize` matched exactly what was set, confirmed via an on-screen readback added specifically to debug this) but produced **zero visible change**, even at a ~2x jump. Root cause: VS Code injects its own default stylesheet into every webview that pins `body`'s font-size to an absolute `var(--vscode-font-size)` value. That breaks inheritance from `<html>` entirely — every visible element's `em` resolves against `body`'s pinned size, not `html`'s, so an `html`-level change was real but invisible: correct value, wrong element. Once DevTools access in this environment proved unreliable (multiple failed attempts to inspect the actual webview document rather than the outer workbench shell), I wrote up the full symptom/evidence/ruled-out list as a handoff prompt for the user to bring to another model (Fable), which correctly diagnosed the `_defaultStyles`/body issue and moved both the automatic and manual rules to target `body` directly with `!important`. Fixed and confirmed working by the user afterward.

Not part of any original phase spec — added from direct conversation about panel usability. No settings/data-flow layers touched (parser/explainer unaffected); confined entirely to `ExplainerPanel.ts`'s inline HTML/CSS/JS. `npm run compile && npm test` pass (209/209, no new tests — this is webview-only rendering behavior, consistent with this codebase's existing rule against tests requiring the VS Code runtime). **Confirmed working** by the user in the actual dev host after the `body`-targeting fix — the one exception among this session's UI changes that actually got a real visual check rather than only compile+test verification.

---

## Phase 2.5 — Live partial explanations (as-you-type) — ✅ DONE (approved)

**Goal:** an unfinished line explains what the user has typed *so far*, instead of showing nothing. Do this only after the Phase 2 revision is approved.

**Principle:** partial explanations are always phrased as in-progress — "You're creating…", "You're starting…" — and never assert what the finished line will do. If no prefix pattern matches confidently, show the normal unknown/empty state. Guessing wrong is still worse than staying quiet.

1. Create `src/parser/partialParser.ts` with `parsePartial(raw: string): PartialParse | null`. It is called **only** when `parseLine` returns `unknown` AND the line looks unfinished (no terminating `;`/`{`, or unclosed parenthesis/quote). Keep it out of `cParser.ts` — completed-line parsing stays untouched.
2. `PartialParse` carries `{ intent: string; soFar: SyntaxEntry[]; hint?: string }` — what they're doing, what's identified so far, and optionally what comes next.
3. Prefix patterns to support (most-specific first, same ordering discipline as the main parser):
   - Type name then identifier then `=` with nothing after: `int x =` → intent "You're creating an integer variable named x." hint "Now give it a starting value."
   - Type name then identifier: `int x` → "You're creating an integer variable named x."
   - Type name alone: `int` → "You're starting to create something with data type int — a whole number."
   - Control keyword with unclosed paren: `if (x ==` → "You're starting an if check — comparing x to something." `while (` → "You're starting a while loop. It needs a condition that decides whether to keep going."
   - Known function with unclosed paren: `printf(` → use the knownFunctions dictionary: "You're calling printf, which prints text to the terminal." List the parameters it expects as hint rows.
   - Unknown identifier with unclosed paren: `foo(` → "You're calling a function named foo." (no summary — it's user-defined).
4. Panel rendering: an "As you type" state — a small "still typing…" badge at the top, then `intent` as the What's Happening sentence, `soFar` rows in the Syntax Breakdown, and `hint` in a muted line under the sentence. It must be visually distinct from a completed-line explanation so users learn the difference.
5. Debounce panel updates by ~150ms while the document is changing so the panel doesn't flicker on every keystroke.
6. Tests: `test/partialParser.test.ts` — every pattern above gets a typical case, plus these must return `null`: an empty line, a complete line (`int x = 5;`), and gibberish (`@@#!`).

**Acceptance:** typing `int x = 5;` character by character in the dev host shows a sensible progression of partial explanations, ending with the normal completed explanation once the `;` lands; `npm test` passes; completed-line behavior is unchanged (all prior tests still green).

**Status:** all six items implemented. `npm run compile && npm test` pass (153/153, 17 new tests in `test/partialParser.test.ts`). All 6 prefix patterns match their given gold examples exactly (`int x =`, `int x`, `int`, `if (x ==`, `while (`, `foo(`) plus the 3 required null cases (empty, complete line, gibberish). `test/parser.test.ts`/`test/explainer.test.ts` unchanged and still passing — completed-line behavior is confirmed unaffected.

**A CLAUDE.md/PLAN.md tension worth flagging:** CLAUDE.md's architecture section is explicit — "parser knows nothing about English... explainer maps ParsedLine → text" — but this phase's own spec (item 1-2) asks for `src/parser/partialParser.ts` to return English `intent`/`hint` strings directly, with no separate explain step. I followed the Phase 2.5 spec literally (it's more detailed and specific than the general architecture note, and the test suite's shape depends on it), and added a comment at the top of `partialParser.ts` documenting this as a deliberate, scoped exception rather than silently violating the stated architecture. Flagging in case that call should have gone the other way.

**Deviations from a literal reading of the plan:**
- Item 3's `printf(` example intent text is "You're calling printf, which prints text to the terminal." — I used the template `You're calling ${name}, which ${known.summary}.` (reusing `knownFunctions.ts`'s existing `summary` field as the single source of truth rather than duplicating a near-identical string), which renders as "...which **prints formatted text** to the terminal." for printf specifically. Semantically identical, wording not byte-identical to the plan's paraphrase.
- Item 3 only gives explicit examples for `if`/`while`; I added `for (` as a third control-keyword case for completeness ("You're starting a for loop. It needs a starting point, a condition, and a step, separated by semicolons.") since leaving `for` completely unhandled felt like an odd gap, and added a guard so `return (`, `switch (`, etc. correctly return `null` instead of being misidentified as "calling a function named return" by the generic identifier-call pattern.
- **Debounce design (item 5):** the plan doesn't specify how "the document is changing" should be detected vs. plain cursor movement, which Phase 2 requires to stay instant ("no flicker when arrowing"). I used `vscode.workspace.onDidChangeTextDocument` as the debounce trigger and had the existing `onDidChangeTextEditorSelection` listener skip its instant render whenever a debounce is pending (both fire for the same keystroke since typing moves the cursor too) — this is a real design decision, not directly speced, and it's the one piece of this phase I'm least able to verify without an interactive host: I can't confirm typing actually feels debounced rather than either double-rendering or blocking arrow-key instancy in some edge case.
- Found while implementing (not a deviation, a note): `parsePartial('int x')` works correctly in isolation and is tested, but rarely fires in the live cursor-tracking flow — `parseLine`'s `variable_decl` regex already treats a bare `int x` as a complete declaration (its trailing `;` has always been optional), so the normal completed explanation shows instead of the partial one for that specific state. Documented in `KNOWN_GAPS.md`; not something this phase should fix since it'd mean changing already-approved parser leniency.

**What I couldn't finish:** same root cause as every prior phase — no interactive VS Code host in this environment. The acceptance criterion is explicitly "typing `int x = 5;` character by character **in the dev host** shows a sensible progression" — I verified the progression programmatically (calling `parsePartial`/`parseLine` at each prefix step, see the test file) but never watched it happen in an actual editor with the debounce timing, the "still typing…" badge, or the visual distinction from a completed explanation. That's the one piece of this phase's own acceptance criteria I have no way to confirm myself.

**Approved 2026-07** — confirmed working in the dev host, including the debounce/instant-navigation split (see the note above about not being able to verify that myself; it held up). Nothing outstanding.

---

## Phase 3 — Docs links — ✅ DONE (approved)

**Goal:** clicking a syntax label opens documentation.

1. Add setting `codeTranslator.docsProvider`: enum `cppreference` (default) | `geeksforgeeks`. Register in `package.json`.
2. Create `src/docs/docsLinks.ts`: `getDocsUrl(entry: SyntaxEntry, parsed: ParsedLine, provider: string): string | undefined`.
   - C types → cppreference type pages; stdlib function calls (printf, malloc, free, strlen, …) → their cppreference pages; control-flow keywords → language pages; operators → operator pages.
   - Maintain an explicit map for ~30 common stdlib functions; fall back to a site search URL (`https://en.cppreference.com/mwiki/index.php?search=<term>`) for unmapped names.
   - Return `undefined` for user-defined names (their own variables/functions) — no link.
3. In the webview, linkable labels get an underline + link cursor; clicking posts a message to the extension, which calls `vscode.env.openExternal`. Never open URLs directly from the webview.

**Acceptance:** clicking "printf" opens its cppreference page; user-defined identifiers are not clickable; changing the setting switches providers without reload.

**Status:** all three items implemented. `npm run compile && npm test` pass (167/167, 14 new tests in `test/docsLinks.test.ts`). `codeTranslator.docsProvider` registered in `package.json` (enum `cppreference`/`geeksforgeeks`, default `cppreference`). `getDocsUrl` handles all four categories (types, stdlib functions, control-flow keywords, operators) plus the two required acceptance cases exactly (`printf` → direct cppreference link; `close_window` → `undefined`). The provider setting is read fresh from `vscode.workspace.getConfiguration` on every render (never cached), so switching it takes effect on the next cursor move with no reload. Docs links are rendered as `<span class="doc-link" data-url="...">` (not a real `<a href>`, so the webview can never navigate directly) with a click listener that posts `{type:'openDocs', url}`; the extension host validates the URL's origin against an allowlist (`en.cppreference.com`/`www.geeksforgeeks.org`) before calling `vscode.env.openExternal` — defense-in-depth, since every URL it receives was already generated by `getDocsUrl` itself, never webview-supplied content.

**On URL accuracy:** cppreference blocks direct fetches (403), so I verified all ~28 function/type/keyword/operator URLs via web search against real, live cppreference pages rather than guessing the URL pattern — I did **not** fabricate any cppreference link. I could not do the same for geeksforgeeks: their article slugs turned out to be inconsistent per-function (confirmed by checking — `printf-in-c` but `strlen-function-in-c` but a much longer slug for `malloc`), so rather than risk broken links, geeksforgeeks always uses their (verified-working) search URL instead of a direct page. Both decisions are documented in `KNOWN_GAPS.md`.

**Deviations from a literal reading of the plan:**
- The map covers ~28 functions, not exactly "~30" — I stopped adding entries once I ran out of ones I could actually verify via search rather than pad the count with unverified guesses (e.g. `abs` was deliberately left out: it's declared in `<stdlib.h>` not `<math.h>` unlike the other numeric functions I verified, so I wasn't confident enough in the URL pattern to include it).
- Item 3 says "linkable **labels**" get link styling, but the acceptance criterion says clicking "**printf**" (a *value*, never a label string) opens the page. I went with the concrete acceptance test: the row's *value* text is what's wrapped in the clickable span, not its label column.
- Added an origin-allowlist check on the extension side before calling `vscode.env.openExternal`, which the plan doesn't explicitly ask for — a low-cost defense-in-depth measure given the tool's own safety rules around not opening arbitrary URLs from web content, even though in this specific case the URL is always self-generated, not webview-supplied.

**What I couldn't finish:** same limitation as every phase — no interactive VS Code host, so I never actually clicked a link and watched a browser tab open, never watched the underline/cursor styling render, and never toggled the setting in the VS Code Settings UI to confirm the "no reload needed" behavior end-to-end. Verified instead via unit tests on `getDocsUrl` directly (including calling it with real `parseLine`/`explain` output, not just hand-built objects) and by reading the generated webview HTML/JS by eye.

**Fix after initial dev-host testing:** the whole value of a linkable row (e.g. `pointer to char — holds the memory address of a single character (one letter, digit, or symbol), named argv`) was being wrapped in the doc-link span, making the entire gloss/description blue instead of just the type keyword. Root cause: the wrapping happened around the row's whole `value` string, with no concept of "the specific word this link is actually about." Fixed by adding `getDocsLink` (returns `{url, term}` — `term` is the exact word, e.g. `"char"`, not the whole gloss) and a new `wrapLinkedTerm` helper in `panel/highlight.ts` that locates just that word as a whole-word match (so "char" doesn't accidentally match inside "character") and wraps only it, leaving the rest of the text as plain, escaped content. Also tightened the `operation` row's term for increment/decrement/shift (was linking the whole `"increment (+1)"`/`"shift left"` value; now just `"increment"`/`"shift"`). `getDocsUrl` kept as a thin wrapper over `getDocsLink` for backward compatibility with existing tests. 11 new regression tests added across `test/highlight.test.ts` and `test/docsLinks.test.ts`. `npm test` now 178/178.

**Second fix, same testing pass:** a line like `t_point *pp = (t_point *)malloc(sizeof(t_point));` had *no* links at all in its "initial value" row (`(t_point *)malloc(sizeof(t_point))`) — `malloc` and `sizeof` are both real, linkable things, but `getDocsLink` only ever resolves one topic per whole row, and `initial value`/`new value` rows aren't one of the four recognized row categories (they hold an arbitrary expression, not a single type/function/keyword/operator). Added `getEmbeddedDocsLinks(value, provider)`, which scans any expression string for known function calls (`identifier(` matched against the same function map) and the `sizeof` operator (newly added, verified cppreference URL: `c/language/sizeof`) — a single expression can contain several independently-linkable terms, so also added `wrapLinkedTerms` (plural) to `highlight.ts` to wrap each one without disturbing the others. This is a fallback layer — it only runs for rows where `getDocsLink` found nothing, so it doesn't change any of the already-fixed single-topic rows. 8 more regression tests. `npm test` now 186/186.

**Third fix, user pushback on custom-type exclusion:** you asked why `t_point` (a custom 42-school struct type) has no link at all — my original reasoning was "user-defined name = no page exists for it," which is true but conflates the *name* (arbitrary, no page) with the *concept it represents* (a struct, which absolutely has a page). Agreed this was too narrow. Fixed: `t_*`/`s_*` custom type names now link to the general struct concept (`c/language/struct`) and `e_*` to the enum concept (`c/language/enum`) — inferred from the exact same naming convention `C_TYPES` in `cParser.ts` already trusts to *recognize* these as types in the first place, not a new assumption. This applies everywhere the name appears: the `data type`/`cast`/`parameter N` rows (via `getDocsLink`), and now also inside arbitrary expressions via `getEmbeddedDocsLinks` (e.g. both occurrences of `t_point` in `(t_point *)malloc(sizeof(t_point))`, not just the first). While in there, also fixed the actual struct/enum **declaration line itself** (`typedef struct s_point {`), which had the identical gap — its `kind` row (`"typedef struct"`) now links `typedef` and `struct` independently, and I confirmed a stray placeholder string (`"(struct/enum body)"` for a bare `};` closer) doesn't get accidentally linked by the new `struct`/`enum` keyword scan — changed it to `"(none)"` to remove the risk entirely rather than special-case it. 9 more regression tests. `npm test` now 192/192.

**Where I land vs. PLAN.md's literal "return undefined for user-defined names" instruction:** I'm now treating that rule as applying to *names*, not *concepts a name implies* — `t_point` the identifier still never gets its own page (correctly, none exists), but the struct/enum shape it's built from does. This is a real interpretive call, not just a bug fix, so flagging it explicitly here in case it should be scoped back.

**Fourth fix, same testing pass:** you pointed out a term shouldn't be link-styled every time it repeats across a line's Syntax Breakdown — e.g. `int main(int argc, char **argv)` was linking "int" in *both* the `return type` row and `parameter 1`'s row, which reads as noisy repetition once you already know what it means the first time. Added a `linkedTerms` set that persists across all rows for a single rendered line (fresh on every new line, never carried over): the first row that would link a given term keeps its link; every later row for the *same* term renders as plain text instead. While making this change, extracted the whole row-building + linking pipeline out of `ExplainerPanel.ts` into a new pure function, `buildRenderedRows` in `panel/rows.ts` — the dedup logic needed real test coverage, and `ExplainerPanel.ts` itself can't be unit-tested (needs the `vscode` API), so this was also a testability fix, not just a refactor. 3 new tests in `test/rows.test.ts` confirm `int`/`t_point` link once and stay plain on repeat, while genuinely different terms (`char`, `malloc`, `sizeof`) still link normally. `npm test` now 195/195.

**Approved 2026-07** — confirmed working in the dev host across four rounds of real-usage feedback (whole-gloss-linked, missing embedded links, custom-type exclusion, repeat-term noise). Nothing outstanding for this phase; the interpretive call on "user-defined names" (noted above) stands as implemented unless you want it scoped back.

---

## Phase 4 — Ollama integration (optional AI layer)

**Goal:** deeper "why" explanations for users who have Ollama installed. The extension must remain fully functional without it.

1. Setting `codeTranslator.ai.enabled` (default **false**) and `codeTranslator.ai.model` (default `llama3.2`).
2. `src/ai/ollamaClient.ts`: POST to `http://localhost:11434/api/generate`, 5s timeout, one-shot prompt (no chat). If unreachable: silently disable for the session and show one non-blocking notification.
3. Add a third collapsible panel section, **Deeper Dive**, only visible when AI is enabled. Shows a spinner, then the model's response.
4. Prompt template: include the current line, the enclosing function's text (grab lines from the last `function_def` above the cursor to the matching closing brace, best-effort), and the rule-based explanation. Instruction: "In 2–3 sentences and plain English, explain WHY this line exists in this function. Do not repeat the syntax breakdown."
5. Debounce: only fire the AI request 800ms after the cursor stops, and cancel in-flight requests on cursor move.

**Acceptance:** with Ollama off/uninstalled, extension behaves exactly as in Phase 3 (rule-based paths make zero network calls). With Ollama running, Deeper Dive populates within a few seconds and stale responses never overwrite newer ones.

**Status:** all five items implemented. `npm run compile && npm test` pass (209/209, 14 new tests: 8 in `test/prompt.test.ts`, 6 in `test/ollamaClient.test.ts`). `codeTranslator.ai.enabled` (default `false`) and `codeTranslator.ai.model` (default `llama3.2`) registered in `package.json`. `src/ai/ollamaClient.ts` POSTs to `http://localhost:11434/api/generate` with a 5s default timeout via `AbortController`, no chat state — `generate({model, prompt, timeoutMs?, signal?})` returns the trimmed response text and throws `OllamaError` on any failure (non-OK HTTP, malformed response shape, unreachable connection, timeout). The Deeper Dive panel section shows a CSS spinner then the model's text; `src/ai/prompt.ts`'s `findEnclosingFunctionText` does best-effort brace counting from the nearest `function_def` above the cursor, and `buildDeeperDivePrompt` assembles the exact instruction text from item 4. Debounce/cancellation lives in `extension.ts`: an 800ms `setTimeout` per cursor-settle, re-validates the cursor hasn't moved before firing, and `cancelPendingAiRequest()` (clears the timer + aborts any in-flight request) runs at the top of every `render()` call so any line change — not just AI-eligible ones — cancels stale AI work. A `controller.signal.aborted` check on both success and failure paths ensures a superseded request's result/error is silently dropped rather than overwriting a newer line's panel state. Zero network calls happen anywhere in the rule-based path unless `ai.enabled` is explicitly set to `true` — confirmed by reading `scheduleAiRequest`'s early-return guard, which checks the setting before any timer is even scheduled.

**Deviations from a literal reading of the plan:**
- Item 3 calls it a "third **collapsible** panel section." I implemented it as *conditionally visible* (shown only when `ai.enabled` is true, hidden entirely otherwise) rather than a section the user can expand/collapse via a UI toggle while AI is enabled — once visible, it's always expanded. The plan's own acceptance criterion ("Deeper Dive populates within a few seconds") only describes visibility gated on the setting, not a collapse interaction, so I read "collapsible" as describing conditional visibility rather than an additional expand/collapse control. Flagging in case a real collapse/expand toggle was intended.
- The "silently disable for the session" behavior in item 2 is implemented as in-memory-only (`aiSessionDisabled` in `extension.ts`'s closure) — reloading the window re-enables an attempt on the next AI-eligible cursor move even if Ollama is still unreachable. Read this as the literal meaning of "the session" (a VS Code window session) rather than something that should persist to disk.
- `updateAiResult`/`updateAiUnavailable` are tracked in `ExplainerPanel` as a separate "last AI message" from the primary empty/unknown/partial/update state (`_lastAiMessage`, distinct from `_lastMessage`), so a webview that's disposed and recreated (e.g. the sidebar is hidden and `retainContextWhenHidden` doesn't apply) replays both the last primary state and its AI follow-up together, rather than losing the Deeper Dive answer or replaying a stale one without its context. Not explicitly asked for, but felt necessary to avoid a broken-looking resume state.

**What I couldn't finish:** same limitation as every phase — no interactive VS Code host in this environment. In particular, item 2's "if unreachable: silently disable for the session and show one non-blocking notification" and the full acceptance criterion ("Deeper Dive populates within a few seconds and stale responses never overwrite newer ones") describe live network/timing behavior I have no way to watch happen — no real or fake local Ollama server was ever hit end-to-end; `ollamaClient.ts` is verified only against a mocked `fetch` in `test/ollamaClient.test.ts`, and the debounce/cancellation orchestration in `extension.ts` isn't unit-tested at all (consistent with this codebase's existing rule against tests requiring the VS Code runtime). You'll need to install Ollama, enable the setting, and actually watch the spinner → result transition (and try moving the cursor mid-request, to confirm cancellation) in a real dev host before calling this fully done.

Additionally, this session hit a tooling outage partway through (Bash/PowerShell both returned a "classifier temporarily unavailable" error for an extended stretch) — the code was fully written and reviewed by eye during the outage, then successfully compiled and tested once tool access returned. No code issues were found from the outage itself; it was purely a delay in verification.

**Deferred, to revisit later:** discussed making the "WHY only, matches tool tone" instruction in `ai/prompt.ts` (see CLAUDE.md's AI/Ollama constraints section) code-enforced — a length cap and a repetition check against the rule-based sentence, rejecting/treating-as-unavailable a response that fails either, same "reject rather than guess wrong" spirit as the rest of this codebase. Deliberately not implemented yet: there's no local Ollama model installed anywhere in this loop to test real response shapes against, so any threshold chosen now would be a guess. Revisit once a model is actually installed and real responses can inform the thresholds — don't pick numbers blind.

---

## Phase 5 — Release prep

1. README.md: what it is, GIF placeholder, feature list, settings table, "no data leaves your machine" note.
   - **Deeper Dive / AI section, explicitly marked beta and untested end-to-end** (no real Ollama server was ever hit during Phase 4 — see that phase's "What I couldn't finish" note; only a mocked `fetch` was exercised). Say plainly that this is an experimental, off-by-default feature and the rest of the extension works fully without it (ties back to CLAUDE.md core rule #1).
   - **Ollama install + connect instructions**, roughly:
     1. Install Ollama from ollama.com (or the platform package manager) and make sure it's running (it typically starts automatically as a background service after install).
     2. Pull a model, e.g. `ollama pull llama3.2` (or whichever model you intend to use).
     3. In VS Code, open Settings and set `codeTranslator.ai.enabled` to `true`.
     4. If you pulled a model other than `llama3.2`, set `codeTranslator.ai.model` to match the exact name Ollama reports (`ollama list`).
     5. Move the cursor to an explainable line — the Deeper Dive section should appear below "What's Happening" and populate within a few seconds.
   - A short troubleshooting note: if Deeper Dive never appears or shows unavailable, confirm Ollama is running (`ollama list` should succeed) and that the model name in settings matches an installed model exactly; the extension disables Deeper Dive for the rest of the session after one failed attempt (see KNOWN_GAPS.md) rather than retrying indefinitely.
2. `.vscodeignore`, `LICENSE`, bump to `0.1.0`, verify `vsce package` produces a `.vsix` that installs cleanly.
3. Final pass on `test/fixtures/sample.c` — cursor through every line in the dev host and sanity-check each explanation reads well to a beginner. Do this pass with `ai.enabled` **off** first (this is the acceptance-critical path — must work standalone); if a local model happens to be available by then, a second pass with it enabled is worthwhile but not acceptance-blocking, since Deeper Dive is beta.

**Acceptance:** `.vsix` installs into a clean VS Code and works on a real `.c` file with the AI setting at its default (`false`) — the AI path is explicitly out of scope for this phase's acceptance criteria, since it remains unverified end-to-end (see Phase 4's "What I couldn't finish").

---

## Phase 5.5 — Community & review prep (before or alongside the English review round)

**Goal:** the repo is ready for outside eyes — beginner testers reporting confusing explanations now, translation contributors later.

1. **CONTRIBUTING.md** with three recipes:
   - *Report a confusing explanation:* open an issue with the code line + what the panel said + what confused you.
   - *Fix a translation* (future, Phase 6): edit one file in `src/i18n/`, run `npm test`.
   - *Add a language* (future): copy `en.ts`, translate every key, add a gold table.
2. **GitHub Actions CI:** `.github/workflows/ci.yml` running `npm ci && npm run compile && npm test` on every push and PR. No PR merges red.
3. **Issue templates:** `.github/ISSUE_TEMPLATE/` with two forms — "Confusing explanation" (fields: the code line, what the panel said, what you expected) and "Line not explained" (the code line, what it does). These map 1:1 to gold-table fixes and parser backlog items.
4. **Review-round protocol (for the user, not the model):** share the `.vsix` with 2–3 beginner testers; they use their own C files; collect answers to exactly two questions — "which explanation confused you?" and "which unexplained line did you want explained?" Confusions become gold-table updates; gaps become parser tasks. Fold results in before starting Phase 6B translations.

**Acceptance:** CI green on the default branch; a stranger can find how to report a bad explanation within one click of the README.
---

## Phase 6 — Localization: explanations in the user's spoken language

**Goal:** everything the panel says — Syntax Breakdown labels, "What's Happening" sentences, hints, empty states — can display in languages other than English (e.g. French, Spanish, Russian, Hindi), and docs links point to that language's version of the documentation site when one exists.

**Gates:** Phase 5 shipped (English-only C version released). User approves starting.

**Setting:** `codeTranslator.displayLanguage` — `auto` (default: follow VS Code's own display language via `vscode.env.language`, fall back to English) or an explicit locale (`en`, `fr`, `es`, …).

### Phase 6A — String extraction (the i18n foundation; no visible change)

1. Create `src/i18n/` with a `MessageCatalog` type: one entry per message key. **Entries are functions taking structured arguments, never fill-in-the-blank string templates** — word order, gender, and pluralization differ across languages, so each locale composes its own sentences. Example: `ifCondition: (cond: string) => string` — English returns `Checks if ${cond}. If it's true, the block below runs.`; French orders it however French needs.
2. Move EVERY user-visible string into the English catalog (`src/i18n/en.ts`): explainer sentences, expression translations ("x equals 5"), type glosses, knownFunctions summaries/param labels/built sentences, partialParser intents and hints (the documented English-in-parser exception moves its strings here too), panel section titles, empty/unknown/still-typing states, notification text.
3. `MessageCatalog` is a strict TS type (`Record` over a key union) so a locale missing any key is a **compile error**, not a runtime gap. No partial catalogs.
4. Explainer/panel/partial parser receive the active catalog as a parameter (keep functions pure and testable); only `extension.ts` reads the setting.
5. Existing gold-sentence tests now assert through the English catalog and must pass **unchanged** — this phase must produce zero visible differences.

**Acceptance:** `npm run compile && npm test` green with zero gold-sentence edits; grep of `src/explainer`, `src/parser/partialParser.ts`, and `src/panel` finds no hardcoded user-facing English outside `src/i18n/en.ts`.

### Phase 6B — First two locales (French, Spanish) + localized docs links

1. Write `fr.ts` and `es.ts` catalogs. Sentences must follow the same quality bar: short, no jargon without defining it, natural in that language — **not word-for-word English translations**. Where the implementing model is unsure of natural phrasing, flag the key with a `// REVIEW` comment for a native speaker rather than guessing confidently.
2. Per-locale gold tables: translate the C gold table into each locale and add exact-match tests per locale.
3. Localized docs links: extend the docs-provider data with per-locale origins — cppreference has `fr.cppreference.com` / `es.cppreference.com`; use them when the display language matches, fall back to `en.cppreference.com` when a locale has no version. Add each localized origin to the openExternal allowlist.
4. Ollama Deeper Dive: `buildDeeperDivePrompt` gains an instruction to answer in the display language. (Model compliance is best-effort — instructional, not enforced, same trust level as the rest of the prompt.)
5. README: language support table, and an honest note that non-English explanations are community-reviewable and may read less naturally than English.

**Acceptance:** switching `displayLanguage` re-renders the panel in the new language on next cursor move (no reload); both locale gold tables pass; docs clicks land on the localized site where one exists.

### Phase 6C — Additional locales (Russian, Hindi, others on request)

1. Same recipe per locale: catalog + gold table + localized docs origin where the docs site has one (cppreference has `ru`; Hindi has no cppreference — fall back to English docs and say so in the README table).
2. Scripts/format checks: Cyrillic and Devanagari must render correctly in the webview (they should — it's HTML — but verify the monospace bit-visual alignment and wrapping at narrow widths).
3. If a right-to-left language (e.g. Arabic) is ever added: the panel needs `dir="rtl"` handling scoped to prose sections only — code snippets and the bit visual stay LTR. Treat RTL as its own task, not a copy of this recipe.

**Acceptance per locale:** full gold table passing; catalog complete (compiles); README table updated.

**Honest scope warning for the implementing model:** machine-generated translations of *teaching* text are the riskiest content in this project — a subtly wrong French sentence misteaches a beginner in a way tests can't catch. Prefer fewer locales done carefully over many done fast, keep `// REVIEW` flags in every catalog until a fluent human confirms, and never invent idioms you're unsure of: simple correct phrasing beats natural-but-wrong.

---

## Phase 7 — Additional programming languages (C++, Java, Python)

**Gates — do not start Phase 7 until ALL of these are true:**
1. Phase 4 is verified end-to-end against a real running Ollama (the "What I couldn't finish" item is closed) — or the user explicitly waives it.
2. Phase 5 is done: the C-only `.vsix` is packaged and confirmed working.
3. Phase 6A (string extraction) is complete, so every new language module's text goes through i18n catalogs from day one.
4. The user has approved starting Phase 7 in that session.

**Prime directive:** one programming language in flight at a time, each fully meeting its own gold-sentence quality bar before the next begins. Four half-supported languages destroy the tool's core asset — trust. A language module's gaps must surface as "I can't explain this line yet", never as a wrong explanation.

### Phase 7A — Language registry refactor (no new features)

1. Define a `LanguageSupport` interface in `src/languages/types.ts`, roughly: `{ languageIds: string[]; parseLine(raw): <lang>ParsedLine; parsePartial(raw): PartialParse | null; explain(parsed): Explanation; getDocsUrl(entry, parsed, provider): string | undefined; docsProviders: {id, origin}[] }`.
2. Move all C-specific code into `src/languages/c/` (parser, partialParser, expressions, knownFunctions, docsLinks, C parts of prompt-building). Shared code stays put: panel/*, ai/ollamaClient, the `Explanation`/`SyntaxEntry`/`PartialParse` output types.
3. `extension.ts` resolves the active module from a registry keyed by `document.languageId`; unsupported languages show the existing empty state with copy like "Code Translator doesn't support this language yet (currently: C)."
4. Each language keeps its **own** `ParsedLine` union. Never build one universal cross-language union — concepts differ (Python has no declarations, Java has no pointers) and a shared union forces wrong explanations. Only the *output* types (`Explanation`, `SyntaxEntry`, `PartialParse`) are shared.
5. Update CLAUDE.md when this lands: rule 4 becomes "Languages: only those registered in `src/languages/`; add new ones only via PLAN.md Phase 7", and the architecture diagram reflects the new layout.
6. The docs-link origin allowlist becomes per-language data supplied by the module, not a hardcoded global.

**Acceptance:** zero behavior change for C — all existing tests pass unmodified (only import paths may change); opening a non-C file shows the friendly unsupported message; `npm run compile && npm test` green.

### Phase 7B — C++

Copy `src/languages/c/` to `src/languages/cpp/` and let it diverge. Do NOT attempt a shared C/C++ regex layer — fork-and-diverge is the rule.

Known traps (write regression tests for these FIRST, before implementing):
- `cout << "hello"` and `cin >> x` must NOT match the bit-shift branch. Stream I/O gets its own `ParsedLine` kind with its own explanation ("Prints "hello" to the terminal" / "Reads keyboard input into x").
- Templates: `vector<int> v;` and `std::map<string, int>` — angle brackets must not match shift/comparison regexes. Recognize common std templates as declarations.
- `x <<= 2` and genuine shifts must keep their C behavior.

New constructs: classes (`class X {`, access specifiers `public:`/`private:`), `std::`/namespaces/`using namespace std;`, references (`int &ref` — "another name for an existing variable", distinct from pointer wording), `new`/`delete`, constructors/destructors, range-for (`for (auto x : items)`). Known-function dictionary: `cout`/`cin`/`endl`, `std::string` methods, `push_back`, `size`, plus the C list (still valid). Docs: cppreference C++ pages (same origin, different paths). Gold table + fixture `test/fixtures/sample.cpp` before implementation, same process as C.

**Acceptance:** own gold table passes exact-match; C tests untouched and green; `KNOWN_GAPS.md` gets a C++ section.

### Phase 7C — Java

New module `src/languages/java/` (fresh, not a C++ copy — closer in spirit but different enough).
- Modifier chains: `public static void main(String[] args)` — parse modifiers as their own syntax rows ("who can use it: public — any code", "static — belongs to the class, not one object").
- Method-path calls: `System.out.println(...)` — the dictionary is keyed on dotted paths, not bare names.
- Classes/objects: `new Scanner(System.in)`, field access, `this.`.
- Generics share the C++ angle-bracket lesson: `List<String>` is a declaration, not comparisons.
- No pointers anywhere — simpler wording throughout.
- Docs provider: Oracle Java docs (`docs.oracle.com`); add origin to this module's allowlist.

**Acceptance:** own gold table + `sample.java` fixture; all prior languages' tests green.

### Phase 7D — Python

The most different — budget explanation rewording, not just parsing:
- No declarations: `x = 5` explains as *creating* x ("Creates a variable named x and sets it to 5" — or re-assigning; without tracking state, say "Sets x to 5. If x didn't exist yet, this creates it.").
- Blocks are indentation: every "the block below" phrasing becomes "the indented lines under this".
- Lines end with `:` not `;` — partial-parser prefixes and "line looks unfinished" heuristics need their own rules.
- `for x in items` is iteration over a collection ("Goes through items one at a time, calling each one x"), not a counter loop. `elif`, `def`, `import`, f-strings, `print()`/`input()`/`len()`/`range()` dictionary.
- List comprehensions, decorators, `lambda`: fall to `unknown` honestly; list in KNOWN_GAPS.
- Docs provider: `docs.python.org`.

**Acceptance:** own gold table + `sample.py` fixture; all prior languages' tests green.

**Phase 7 overall acceptance:** each sub-phase independently shippable; a release can go out after any completed sub-phase. Update README's language list as each lands.
---

## Working rules for the implementing model

- One phase per session/PR if possible. Never mix phases.
- If a task is ambiguous, choose the simplest interpretation consistent with CLAUDE.md and note the decision in a code comment.
- If you can't make a construct parse reliably, let it fall to `unknown` and note it in a `KNOWN_GAPS.md` file rather than shipping a wrong explanation.
- Run `npm run compile && npm test` before declaring any task done.
