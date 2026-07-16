# Known Gaps

Constructs and edge cases that intentionally fall back to `unknown` (or to a
safe, backtick-wrapped fallback in expression translation) rather than risk a
wrong explanation. Per CLAUDE.md: "A wrong explanation is worse than 'I can't
explain this line yet.'"

## Parser

- **`switch` statements** are not recognized — fall to `unknown`.
- **Multi-dimensional arrays** (`int grid[3][3];`, `grid[i][j] = 1;`) are not
  recognized — fall to `unknown`.
- **Bit-field struct members** (`unsigned x : 4;`) are not recognized — fall
  to `unknown`.
- **Comma expressions** (`a = 1, b = 2;`) parse as a single assignment whose
  value is the whole `"1, b = 2"` string; since that doesn't match any
  translatable expression shape, the explainer safely falls back to a
  backtick-wrapped literal instead of guessing.
- **Double-pointer depth** (`char **argv`) collapses to a single boolean
  `pointer: true` flag — the parser doesn't distinguish single vs. double
  indirection. This only affects the `main` special case today, where the
  wording is generic enough not to matter.
- **Preprocessor directives** other than `#include`, `#define`, `#ifndef`,
  `#ifdef`, `#endif` (e.g. `#pragma`, `#undef`, `#else`, `#elif`) fall to
  `unknown`.
- **Dereference assignment with a space after `*`** (`* ptr = 5;`) is
  misclassified as a block-comment continuation line, because both shapes
  start with a bare `*`. Conventionally-styled code with no space
  (`*ptr = 5;`) is disambiguated correctly and is the style used throughout
  `test/fixtures/sample.c`.
- **Multi-dimensional arrays** (`int grid[2][2];`, `grid[1][1] = 3;`) fall to
  `unknown` on purpose — the bracket-matching regex can't tell "two
  dimensions" from "one dimension with a literal `]` inside it" reliably
  enough to report a real size/index, so it declines rather than guess.
- **A shift combined with another bitwise operator** at the top level (e.g.
  `1 << 8 | 1 << 16;`, or embedded the same way inside an assignment's
  value) falls to `unknown`/a backtick-wrapped fallback rather than report a
  shift built from only part of the expression. A single, uncombined shift
  (`255 << 16`, `x = 1 << 3;`) still works normally.
- **Trailing `// comment`s are stripped before parsing** (so `i = 7; //
  note` correctly parses with value `7`, not `7; // note`), respecting
  string/char literals (`"http://..."` is not treated as a comment). Only
  trailing `//` comments are handled this way — a **mid-line `/* ... */`
  block comment** (e.g. `int x /* why */ = 5;`) is not stripped and can
  still end up folded into a captured value.

## Live partial explanations (`src/parser/partialParser.ts`)

- `parsePartial`'s "type name then identifier" pattern (`int x` → "You're
  creating an integer variable named x.") is directly testable and correct,
  but rarely fires in the real cursor-tracking flow: `parseLine`'s
  `variable_decl` regex already treats a bare `int x` (no trailing `;`, no
  value) as a *complete* declaration, not `unknown` — so the normal
  completed-line explanation shows instead of the partial one for that
  specific in-progress state. This is pre-existing leniency in `cParser.ts`
  (the trailing `;` has always been optional there), not a bug introduced by
  partial parsing; changing it would be a breaking change to already-tested
  behavior, so it's left as-is.
- The if/while "comparing X to something" detection only recognizes a bare
  identifier optionally followed by a comparison operator (`x`, `x ==`).
  Anything more complex typed inside the parens (e.g. `if (arr[i] ==`) falls
  back to the generic "You're starting an if check." with no comparison
  detail, rather than guess.

## Documentation links (`src/docs/docsLinks.ts`)

- The cppreference function-URL map (~28 entries) was verified against real,
  live cppreference URLs (via search, since cppreference blocks direct
  fetches) rather than guessed. It's deliberately not exhaustive. A function
  `knownFunctions.ts` recognizes but that isn't in this map — currently just
  the POSIX functions `write`/`read`/`open`/`close`, which cppreference
  doesn't document at all — links to a cppreference *search* for the name
  instead of a fabricated direct page. A name in neither list is treated as
  user-defined and gets no link at all.
- **geeksforgeeks never gets a direct-page link, only a search URL**, for
  every function/type/keyword. Their article slugs aren't predictable from
  the function name (`printf-in-c`, but `strlen-function-in-c`, but
  `dynamic-memory-allocation-in-c-using-malloc-calloc-free-and-realloc` for
  malloc — no clean pattern), and guessing wrong would silently 404. Their
  search URL (`geeksforgeeks.org/search/<term>`) was verified working and
  always resolves to something relevant, so it's used unconditionally rather
  than building an unreliable direct-link map.
- Four Syntax Breakdown row *labels* get a single whole-row link via
  `getDocsLink`: type rows (`data type`/`return type`/`cast`/`parameter N`),
  `function call`, `what kind of line` (control-flow keyword), and
  `operation`. Every *other* row falls back to `getEmbeddedDocsLinks`, which
  scans the row's raw text for known function calls (`malloc(`, `printf(`,
  ...), the `sizeof`/`typedef`/`struct`/`enum` keywords, and custom
  (`t_*`/`s_*`/`e_*`) type names, anywhere inside it — this is what makes
  `malloc`, `sizeof`, and `t_point` all clickable inside a value like
  `(t_point *)malloc(sizeof(t_point))`. Rows holding only the user's own
  *non-type* names (`name`, `variable being changed`, target rows like
  `pointer`/`field`/`element`, the raw `binary` visual, compound-condition
  `check N` rows, etc.) still end up with no link in practice — not because
  they're excluded, but because there's nothing recognizable in them for
  either scan to find.
- **Custom `t_*`/`s_*`/`e_*` type names always link to the general
  struct/enum concept page** (`c/language/struct` or `c/language/enum`),
  never to a page "about" that specific name (no such page could exist —
  it's a name the codebase's author made up). This is inferred purely from
  the naming convention `C_TYPES` in `cParser.ts` already relies on for
  parsing (`t_`/`s_` → struct, `e_` → enum) — the parser has no cross-line
  symbol table, so it doesn't actually know *this specific* `t_point` came
  from a `struct` declaration two lines up; it's trusting the same
  convention it already trusts to recognize the type at all. If a codebase
  broke the convention (e.g. `typedef int t_bool;`, not a struct), the link
  would be technically wrong — a deliberate, documented tradeoff, since the
  convention holds throughout 42-school C, this extension's primary
  audience per CLAUDE.md.
- The embedded scan doesn't distinguish real code from a **string literal's
  contents**: `printf("this struct thing")` would technically find "struct"
  inside the quoted text and link it, same as if it were real syntax. Rare
  in practice (mentioning "struct"/"sizeof"/a function name in an English
  string literal), and not actively wrong — clicking it still opens genuine,
  relevant documentation — just occasionally out of context.
- The embedded scan does not recognize a *built-in* type name (`int`,
  `char`, ...) appearing mid-expression outside of a cast, nor any operator
  beyond what's already covered by the whole-row `operation` label.

## Ollama "Deeper Dive" (`src/ai/`)

- `findEnclosingFunctionText` (used to build the AI prompt's function
  context) is the same "best-effort, line-by-line, no real parser" approach
  as the rest of the codebase: it counts `{`/`}` characters without knowing
  about strings or comments. A `{` or `}` inside a string literal or comment
  within the function body would throw off the brace count and could
  truncate the function context early or run it past the real closing
  brace. Not treated as a `null`/fallback case (unlike the rule-based
  parser's constructs) because a slightly-off function context still
  produces a *reasonable* AI prompt, not a wrong rule-based explanation —
  the two failure modes aren't equally risky.
- If no enclosing `function_def` is found above the cursor (e.g. a
  top-level global declaration, or a line above the first function in the
  file), the prompt is built with no function context at all — Ollama still
  gets the current line and the rule-based explanation, just without "here's
  the surrounding function" framing.
- The "silently disable for the session" behavior is genuinely
  session-scoped (an in-memory flag in `extension.ts`), not persisted —
  reloading the window or restarting VS Code re-enables an attempt on the
  next AI-eligible cursor move, even if Ollama is still unreachable. This
  matches the plan's literal wording ("disable for the session") and seems
  like the right call: a transient network hiccup shouldn't permanently
  disable the feature until the user manually re-toggles the setting.
- Deeper Dive is intentionally not offered for `unknown` or "still typing"
  (partial) lines — only a line with a real rule-based explanation gets a
  Deeper Dive prompt, since the prompt template itself requires "the
  rule-based explanation" as an input.
- None of this phase's network behavior (the actual HTTP round trip against
  a real or fake Ollama server) is verified end-to-end — `ollamaClient.ts`
  is unit-tested against a mocked `fetch`, and `extension.ts`'s scheduling/
  cancellation logic isn't unit-tested at all (consistent with this
  codebase's existing rule: no tests that require the VS Code runtime).
- The "WHY only, matches tool tone" instruction in `buildDeeperDivePrompt`
  (see CLAUDE.md's AI/Ollama constraints section) is prompt wording only,
  not code-enforced — nothing checks response length or checks for
  repetition of the rule-based sentence. A length cap and a repetition
  check were discussed and deliberately deferred rather than implemented:
  no local Ollama model is installed anywhere in this loop to test real
  response shapes against, so any threshold picked now would be a guess
  rather than something informed by actual model output. Revisit once a
  model is available to test against (tracked in PLAN.md's Phase 4 section).

## Expression translation (`src/explainer/expressions.ts`)

- `describeExpression` splits on the first top-level occurrence of each
  operator tier (ternary → `||` → `&&` → comparisons → `+`/`-` → `*`/`/`/`%`).
  This covers the single-operator and simple-chain expressions typical of
  beginner code, but a deeply nested or unusual expression it can't
  confidently split is returned unchanged, wrapped in backticks, rather than
  risk a wrong translation.
- A function-call-shaped value used as an expression (e.g. `malloc(20)`
  inside a cast, or as part of a larger expression) is passed through as-is.
  Its arguments are not recursively translated — there are no bare operators
  left untranslated, so this doesn't violate the "no raw code symbols" rule,
  but it also isn't a full English translation of the call.
- **Compound `if`/`while` conditions that mix `&&` and `||` at the top level**
  (e.g. `if (a == 1 && b == 2 || c == 3)`) aren't confidently splittable into
  the enumerated "Checks N things" form — doing so would require guessing
  operator precedence/grouping intent without parens. These fall back to the
  single-condition sentence, which still passes the whole expression through
  `describeExpression` (so it's still a safe, symbol-free translation — just
  not the enumerated one). Parenthesize sub-groups to disambiguate; a single
  connective type at the top level (all `&&` or all `||`) is enumerated fine.
