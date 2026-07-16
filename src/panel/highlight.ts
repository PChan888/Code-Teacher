/**
 * Pure, VS Code-free rendering helpers for the webview HTML.
 * No `vscode` imports here on purpose — this is exactly what "the panel"
 * can unit-test without an Extension Development Host.
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const KEYWORDS = /^(if|else|while|for|return|struct|enum|typedef|break|continue|do|switch|case|default|sizeof|static|const)\b/;
const TYPES = /^(int|char|float|double|long|short|unsigned|void|size_t|bool|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|t_\w+|s_\w+|e_\w+)\b/;

const TOKEN_PATTERNS: { type: string; regex: RegExp }[] = [
  { type: 'comment', regex: /^(\/\/.*|\/\*.*)$/ },
  { type: 'preprocessor', regex: /^#\w+/ },
  { type: 'string', regex: /^"([^"\\]|\\.)*"?/ },
  { type: 'char', regex: /^'([^'\\]|\\.)*'?/ },
  { type: 'number', regex: /^(0[xX][0-9a-fA-F]+|\d+(\.\d+)?)/ },
  { type: 'keyword', regex: KEYWORDS },
  { type: 'type', regex: TYPES },
  { type: 'identifier', regex: /^[A-Za-z_]\w*/ },
  { type: 'operator', regex: /^(==|!=|<=|>=|&&|\|\||<<|>>|->|[-+*/%=<>!&|^~.,;:()[\]{}])/ },
];

/**
 * Very small, regex-based single-line tokenizer for basic syntax coloring in
 * the line preview. Not a real lexer — matches the parser's "regex, not a
 * grammar" philosophy. Falls back to emitting unrecognized characters as
 * plain (escaped) text rather than losing them.
 */
export function highlightLine(line: string): string {
  let out = '';
  let rest = line;
  while (rest.length > 0) {
    const ws = rest.match(/^\s+/);
    if (ws) {
      out += ws[0];
      rest = rest.slice(ws[0].length);
      continue;
    }
    let matched = false;
    for (const { type, regex } of TOKEN_PATTERNS) {
      const m = rest.match(regex);
      if (m && m[0]) {
        out += `<span class="tok-${type}">${escapeHtml(m[0])}</span>`;
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += escapeHtml(rest[0]);
      rest = rest.slice(1);
    }
  }
  return out;
}

/**
 * Renders the "before: 0101...\nafter:  0101..." binary visual from
 * `bitShiftVisual` (see src/parser/cParser.ts) as escaped HTML, wrapping the
 * bit positions that actually changed in the "after" line.
 */
export function renderBitVisual(raw: string): string {
  const lines = raw.split('\n');
  if (lines.length !== 2) return escapeHtml(raw);

  const beforeMatch = lines[0].match(/^(\S+:\s*)(.+)$/);
  const afterMatch = lines[1].match(/^(\S+:\s*)(.+)$/);
  if (!beforeMatch || !afterMatch) return escapeHtml(raw);

  const [, beforePrefix, beforeBits] = beforeMatch;
  const [, afterPrefix, afterBits] = afterMatch;

  const highlightedAfter = afterBits
    .split('')
    .map((c, i) => (/[01]/.test(c) && c !== beforeBits[i] ? `<span class="bit-changed">${c}</span>` : escapeHtml(c)))
    .join('');

  return `${escapeHtml(beforePrefix)}${escapeHtml(beforeBits)}\n${escapeHtml(afterPrefix)}${highlightedAfter}`;
}

/** Finds `term` in `haystack` as a whole word (not a substring of a longer word, e.g. "char" inside "character"). */
function findWholeWordIndex(haystack: string, term: string): number {
  if (!term) return -1;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = haystack.match(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`));
  return match?.index ?? -1;
}

interface LinkRange {
  start: number;
  end: number;
  url: string;
}

/** Locates each term as a whole word, sorted by position, with overlaps dropped (keeping the earlier one). */
function findLinkRanges(rawValue: string, links: { term: string; url: string }[]): LinkRange[] {
  const ranges: LinkRange[] = [];
  for (const { term, url } of links) {
    const idx = findWholeWordIndex(rawValue, term);
    if (idx !== -1) ranges.push({ start: idx, end: idx + term.length, url });
  }
  ranges.sort((a, b) => a.start - b.start);
  const clean: LinkRange[] = [];
  for (const r of ranges) {
    if (clean.length === 0 || r.start >= clean[clean.length - 1].end) clean.push(r);
  }
  return clean;
}

function renderLinkRanges(rawValue: string, ranges: LinkRange[]): string {
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    out += escapeHtml(rawValue.slice(pos, r.start));
    out += `<span class="doc-link" data-url="${escapeHtml(r.url)}">${escapeHtml(rawValue.slice(r.start, r.end))}</span>`;
    pos = r.end;
  }
  out += escapeHtml(rawValue.slice(pos));
  return out;
}

/**
 * Wraps just the `term` substring of a syntax row's raw value in a doc-link
 * span, leaving the rest of the text (e.g. a type gloss's description)
 * plain. Falls back to linking the whole value if `term` can't be found as
 * a standalone word — still functional, just less precise, rather than
 * silently dropping the link.
 */
export function wrapLinkedTerm(rawValue: string, term: string, url: string): string {
  const ranges = findLinkRanges(rawValue, [{ term, url }]);
  if (ranges.length === 0) {
    return `<span class="doc-link" data-url="${escapeHtml(url)}">${escapeHtml(rawValue)}</span>`;
  }
  return renderLinkRanges(rawValue, ranges);
}

/**
 * Like wrapLinkedTerm, but for a value that may contain several independently
 * linkable terms (e.g. "malloc(sizeof(t_point))" has both `malloc` and
 * `sizeof`). Terms that can't be found are silently skipped — no fallback
 * whole-value wrap here, since an expression not containing every term it
 * was checked against is the normal case, not an error.
 */
export function wrapLinkedTerms(rawValue: string, links: { term: string; url: string }[]): string {
  const ranges = findLinkRanges(rawValue, links);
  return renderLinkRanges(rawValue, ranges);
}
