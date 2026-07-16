/**
 * Maps a Syntax Breakdown row to an external documentation URL.
 * Pure data + string assembly — no VS Code API, no HTML. The panel calls
 * this per row to decide what gets link styling; the actual navigation goes
 * through `vscode.env.openExternal` in the extension host, never directly
 * from the webview.
 */

import { SyntaxEntry } from '../explainer/explainer';
import { ParsedLine } from '../parser/cParser';
import { KNOWN_FUNCTIONS } from '../explainer/knownFunctions';

export type DocsProvider = 'cppreference' | 'geeksforgeeks';

/**
 * cppreference.com page paths (relative to https://en.cppreference.com/c/)
 * for common C standard library functions. Verified against real
 * cppreference URLs, not guessed — deliberately not exhaustive. Anything
 * not listed here (including POSIX-only functions like write/read/open/close,
 * which cppreference doesn't document) falls back to a site search instead
 * of a fabricated, possibly-broken direct URL.
 */
const CPPREFERENCE_FUNCTION_PATHS: Record<string, string> = {
  printf: 'io/fprintf', fprintf: 'io/fprintf', sprintf: 'io/fprintf',
  scanf: 'io/fscanf', fscanf: 'io/fscanf', sscanf: 'io/fscanf',
  putchar: 'io/putchar', getchar: 'io/getchar',
  puts: 'io/puts', gets: 'io/gets', fgets: 'io/fgets',
  malloc: 'memory/malloc', free: 'memory/free', calloc: 'memory/calloc', realloc: 'memory/realloc',
  strlen: 'string/byte/strlen', strcpy: 'string/byte/strcpy', strncpy: 'string/byte/strncpy',
  strcat: 'string/byte/strcat', strcmp: 'string/byte/strcmp', strncmp: 'string/byte/strncmp',
  strchr: 'string/byte/strchr', strstr: 'string/byte/strstr',
  memcpy: 'string/byte/memcpy', memset: 'string/byte/memset', memmove: 'string/byte/memmove',
  atoi: 'string/byte/atoi', atof: 'string/byte/atof',
  rand: 'numeric/random/rand', srand: 'numeric/random/srand', sqrt: 'numeric/math/sqrt',
  exit: 'program/exit', abort: 'program/abort',
};

const CPPREFERENCE_TYPE_PATHS: Record<string, string> = {
  int: 'language/arithmetic_types', char: 'language/arithmetic_types',
  float: 'language/arithmetic_types', double: 'language/arithmetic_types',
  long: 'language/arithmetic_types', short: 'language/arithmetic_types',
  unsigned: 'language/arithmetic_types', bool: 'language/arithmetic_types',
  void: 'language/type', size_t: 'types/size_t',
  uint8_t: 'types/integer', uint16_t: 'types/integer', uint32_t: 'types/integer', uint64_t: 'types/integer',
  int8_t: 'types/integer', int16_t: 'types/integer', int32_t: 'types/integer', int64_t: 'types/integer',
};

const CPPREFERENCE_KEYWORD_PATHS: Record<string, string> = {
  if: 'language/if', else: 'language/if', while: 'language/while', for: 'language/for', return: 'language/return',
};

/** Verified cppreference paths for concepts that come up inside arbitrary expressions/type text, not just as a whole-row topic. */
const SIZEOF_PATH = 'language/sizeof';
const STRUCT_PATH = 'language/struct';
const ENUM_PATH = 'language/enum';
const TYPEDEF_PATH = 'language/typedef';

const CPPREFERENCE_OPERATOR_PATHS: Record<string, string> = {
  assignment: 'language/operator_assignment',
  incdec: 'language/operator_incdec',
  shift: 'language/operator_arithmetic',
};

const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

interface Topic {
  /** cppreference path relative to /c/; undefined means "recognized but no direct page" - falls back to search. */
  path?: string;
  /** Plain term used for the search-URL fallback (either provider). */
  term: string;
}

/**
 * Resolves a type-row's leading type word to a doc topic — either a
 * built-in type's page, or (for 42-school custom types) the general
 * struct/enum concept page. `t_`/`s_`/`e_` names are never *themselves*
 * documented anywhere (they're the user's own name), but per the same
 * naming convention `C_TYPES` in cParser.ts already relies on for parsing,
 * `t_`/`s_` always means a typedef'd struct and `e_` always means an enum —
 * so the link goes to "what is a struct/enum," not "what is t_point." This
 * infers the concept from the name alone; the parser doesn't track whether
 * it actually saw a `struct`/`enum` declaration for this exact name (no
 * cross-line symbol table — see CLAUDE.md's "one line at a time" rule).
 */
function resolveTypeTopic(rawValue: string): Topic | null {
  let v = rawValue.trim();
  if (v.startsWith('pointer to ')) v = v.slice('pointer to '.length);
  if (v.startsWith('array of ')) v = v.slice('array of '.length);
  const dashIndex = v.indexOf(' — ');
  if (dashIndex !== -1) v = v.slice(0, dashIndex);
  v = v.replace(/\*+$/, '').trim(); // strip a trailing pointer star from cast text like "t_data *"

  if (v in CPPREFERENCE_TYPE_PATHS) return { path: CPPREFERENCE_TYPE_PATHS[v], term: v };
  if (/^e_\w+$/.test(v)) return { path: ENUM_PATH, term: v };
  if (/^(t_|s_)\w+$/.test(v)) return { path: STRUCT_PATH, term: v };
  return null;
}

/** Returns the operator bucket plus the short term to highlight (not the whole descriptive value, e.g. not "increment (+1)"). */
function resolveOperator(raw: string): { bucket: keyof typeof CPPREFERENCE_OPERATOR_PATHS; term: string } | null {
  const v = raw.trim();
  if (ASSIGNMENT_OPERATORS.has(v)) return { bucket: 'assignment', term: v };
  if (v.startsWith('increment')) return { bucket: 'incdec', term: 'increment' };
  if (v.startsWith('decrement')) return { bucket: 'incdec', term: 'decrement' };
  if (v.startsWith('shift ')) return { bucket: 'shift', term: 'shift' };
  return null;
}

const TYPE_ROW_LABELS = new Set(['data type', 'return type', 'cast']);

function resolveTopic(entry: SyntaxEntry, parsed: ParsedLine): Topic | null {
  if (entry.label === 'function call' && parsed.kind === 'function_call') {
    const name = parsed.name;
    const isRecognized = name in CPPREFERENCE_FUNCTION_PATHS || name in KNOWN_FUNCTIONS;
    return isRecognized ? { path: CPPREFERENCE_FUNCTION_PATHS[name], term: name } : null;
  }

  if (TYPE_ROW_LABELS.has(entry.label) || /^parameter \d+$/.test(entry.label)) {
    return resolveTypeTopic(entry.value);
  }

  if (entry.label === 'what kind of line') {
    const keyword = entry.value.split(' ')[0];
    return keyword in CPPREFERENCE_KEYWORD_PATHS ? { path: CPPREFERENCE_KEYWORD_PATHS[keyword], term: keyword } : null;
  }

  if (entry.label === 'operation') {
    const op = resolveOperator(entry.value);
    return op ? { path: CPPREFERENCE_OPERATOR_PATHS[op.bucket], term: op.term } : null;
  }

  return null;
}

function cppreferenceUrl(topic: Topic): string {
  if (topic.path) return `https://en.cppreference.com/c/${topic.path}`;
  return `https://en.cppreference.com/mwiki/index.php?search=${encodeURIComponent(topic.term)}`;
}

function geeksforgeeksUrl(topic: Topic): string {
  // No reliable, guessable direct-article URL scheme on geeksforgeeks (their
  // slugs vary per article, e.g. "printf-in-c" vs "strlen-function-in-c"),
  // so every lookup uses their real, verified search URL rather than risk a
  // fabricated link that 404s.
  return `https://www.geeksforgeeks.org/search/${encodeURIComponent(topic.term)}`;
}

export interface DocsLink {
  url: string;
  /**
   * The exact word/symbol within the row's raw value that the link applies
   * to (e.g. "char", not "pointer to char — holds the memory address of a
   * single character..."). The panel highlights only this substring, not
   * the row's whole value, so a type gloss's long description stays plain
   * text with just the type keyword itself clickable.
   */
  term: string;
}

/**
 * Returns a documentation link for a Syntax Breakdown row, or undefined if
 * the row refers to something user-defined (their own variable/function/
 * struct name) — those never get a link.
 */
export function getDocsLink(entry: SyntaxEntry, parsed: ParsedLine, provider: DocsProvider): DocsLink | undefined {
  const topic = resolveTopic(entry, parsed);
  if (!topic) return undefined;
  const url = provider === 'cppreference' ? cppreferenceUrl(topic) : geeksforgeeksUrl(topic);
  return { url, term: topic.term };
}

/** Convenience wrapper for callers that only need the URL (e.g. tests). */
export function getDocsUrl(entry: SyntaxEntry, parsed: ParsedLine, provider: DocsProvider): string | undefined {
  return getDocsLink(entry, parsed, provider)?.url;
}

const EMBEDDED_KEYWORD_PATHS: Record<string, string> = {
  sizeof: SIZEOF_PATH,
  typedef: TYPEDEF_PATH,
  struct: STRUCT_PATH,
  enum: ENUM_PATH,
};

/**
 * Scans an arbitrary expression string — a variable_decl's initial value, an
 * assignment's new value, a return value, a for-loop clause, a #define
 * expansion, a struct/enum declaration's "kind" row, etc. — for known
 * sub-terms: recognized stdlib function calls, the `sizeof` operator, and
 * the `typedef`/`struct`/`enum` keywords. Unlike `getDocsLink` (one topic
 * per whole row), a single value can contain several linkable things at
 * once, e.g. `(t_point *)malloc(sizeof(t_point))` has both `malloc` and
 * `sizeof`, or `typedef struct` has both `typedef` and `struct`.
 * A user-defined name (e.g. `t_point`) is never matched by any of these
 * checks, so it still never gets a link from this function.
 */
export function getEmbeddedDocsLinks(value: string, provider: DocsProvider): DocsLink[] {
  const links: DocsLink[] = [];
  const seen = new Set<string>();

  for (const [term, path] of Object.entries(EMBEDDED_KEYWORD_PATHS)) {
    if (new RegExp(`\\b${term}\\b`).test(value)) {
      const url = provider === 'cppreference' ? cppreferenceUrl({ path, term }) : geeksforgeeksUrl({ term });
      links.push({ term, url });
      seen.add(term);
    }
  }

  const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(value))) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const isRecognized = name in CPPREFERENCE_FUNCTION_PATHS || name in KNOWN_FUNCTIONS;
    if (!isRecognized) continue;
    const url = provider === 'cppreference' ? cppreferenceUrl({ path: CPPREFERENCE_FUNCTION_PATHS[name], term: name }) : geeksforgeeksUrl({ term: name });
    links.push({ term: name, url });
  }

  // Custom type names (t_*/s_*/e_*), same convention as resolveTypeTopic —
  // links to the general struct/enum concept, everywhere the name appears
  // (a cast, a sizeof(...) argument, etc.), not just in a "data type" row.
  const customTypeRe = /\b(t_\w+|s_\w+|e_\w+)\b/g;
  let typeMatch: RegExpExecArray | null;
  while ((typeMatch = customTypeRe.exec(value))) {
    const name = typeMatch[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const path = /^e_\w+$/.test(name) ? ENUM_PATH : STRUCT_PATH;
    const url = provider === 'cppreference' ? cppreferenceUrl({ path, term: name }) : geeksforgeeksUrl({ term: name });
    links.push({ term: name, url });
  }

  return links;
}
