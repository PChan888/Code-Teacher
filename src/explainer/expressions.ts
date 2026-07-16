/**
 * Translates simple C expressions into plain English.
 * Regex/scanner based, mirroring the parser's philosophy: if an expression
 * can't be translated with confidence, it is returned unchanged wrapped in
 * backticks rather than emitting a wrong or half-translated sentence.
 */

interface OperatorSpec {
  op: string;
  words: string;
}

const COMPARE_OPS: OperatorSpec[] = [
  { op: '==', words: 'equals' },
  { op: '!=', words: 'does not equal' },
  { op: '<=', words: 'is less than or equal to' },
  { op: '>=', words: 'is greater than or equal to' },
  { op: '<', words: 'is less than' },
  { op: '>', words: 'is greater than' },
];

/** Finds the first top-level (outside parens/quotes) occurrence of `needle`. */
function findTopLevel(str: string, needle: string): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth === 0 && str.startsWith(needle, i)) return i;
  }
  return -1;
}

function splitAt(str: string, index: number, opLength: number): [string, string] {
  return [str.slice(0, index).trim(), str.slice(index + opLength).trim()];
}

/** Splits a string on a top-level separator (outside parens/quotes), e.g. ';' in a for-loop header. */
export function splitTopLevel(str: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth === 0 && str.startsWith(separator, i)) {
      parts.push(str.slice(start, i));
      start = i + separator.length;
    }
  }
  parts.push(str.slice(start));
  return parts.map(p => p.trim());
}

function isIdentifier(s: string): boolean {
  return /^[A-Za-z_]\w*$/.test(s);
}

function isNumberLiteral(s: string): boolean {
  return /^0[xX][0-9a-fA-F]+$|^\d+(\.\d+)?$/.test(s);
}

function isStringLiteral(s: string): boolean {
  return /^"([^"\\]|\\.)*"$/.test(s) || /^'([^'\\]|\\.)*'$/.test(s);
}

function isCallShaped(s: string): boolean {
  return /^[A-Za-z_]\w*\(.*\)$/.test(s);
}

/** Wraps an expression that couldn't be confidently translated, per the "never a wrong translation" rule. */
function fallback(expr: string): string {
  return `\`${expr}\``;
}

/**
 * Strips one layer of parens if they wrap the *entire* string (not e.g.
 * "(a) + (b)", where the parens only wrap sub-expressions).
 */
function stripWrappingParens(s: string): string {
  if (!(s.startsWith('(') && s.endsWith(')'))) return s;
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s; // parens closed before the end - don't wrap the whole string
    }
  }
  return s.slice(1, -1).trim();
}

export function describeExpression(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return trimmed;

  // Fully-parenthesized: (expr) -> strip and recurse.
  const unwrapped = stripWrappingParens(trimmed);
  if (unwrapped !== trimmed) return describeExpression(unwrapped);

  // Ternary: cond ? whenTrue : whenFalse
  const qIndex = findTopLevel(trimmed, '?');
  if (qIndex !== -1) {
    const cond = trimmed.slice(0, qIndex).trim();
    const rest = trimmed.slice(qIndex + 1);
    const cIndex = findTopLevel(rest, ':');
    if (cond && cIndex !== -1) {
      const whenTrue = rest.slice(0, cIndex).trim();
      const whenFalse = rest.slice(cIndex + 1).trim();
      if (whenTrue && whenFalse) {
        return `${describeExpression(whenTrue)} if ${describeExpression(cond)}, otherwise ${describeExpression(whenFalse)}`;
      }
    }
  }

  // Logical OR / AND
  const orIndex = findTopLevel(trimmed, '||');
  if (orIndex !== -1) {
    const [left, right] = splitAt(trimmed, orIndex, 2);
    if (left && right) return `either ${describeExpression(left)} or ${describeExpression(right)}`;
  }
  const andIndex = findTopLevel(trimmed, '&&');
  if (andIndex !== -1) {
    const [left, right] = splitAt(trimmed, andIndex, 2);
    if (left && right) return `both ${describeExpression(left)} and ${describeExpression(right)}`;
  }

  // Comparisons (longest operators first so <= / >= aren't mistaken for < / >)
  for (const spec of COMPARE_OPS) {
    const idx = findTopLevel(trimmed, spec.op);
    if (idx === -1) continue;
    const [left, right] = splitAt(trimmed, idx, spec.op.length);
    if (left && right) return `${describeExpression(left)} ${spec.words} ${describeExpression(right)}`;
  }

  // Logical NOT
  if (trimmed.startsWith('!') && !trimmed.startsWith('!=')) {
    const inner = trimmed.slice(1).trim();
    if (inner) return `${describeExpression(inner)} is false`;
  }

  // Address-of
  if (trimmed.startsWith('&') && !trimmed.startsWith('&&')) {
    const inner = trimmed.slice(1).trim();
    if (inner) return `the memory address of ${describeExpression(inner)}`;
  }

  // Dereference of a bare pointer variable in a value position (e.g. "y = *ptr;")
  if (trimmed.startsWith('*') && isIdentifier(trimmed.slice(1).trim())) {
    return `the value ${trimmed.slice(1).trim()} points to`;
  }

  // Additive: +, - (skip a leading unary sign, which can't be a binary operator)
  for (const op of ['+', '-']) {
    const idx = findTopLevel(trimmed.slice(1), op);
    if (idx === -1) continue;
    const [left, right] = splitAt(trimmed, idx + 1, 1);
    if (left && right) return `${describeExpression(left)} ${op === '+' ? 'plus' : 'minus'} ${describeExpression(right)}`;
  }

  // Multiplicative: *, /, %
  const multiplicativeWords: Record<string, string> = { '*': 'times', '/': 'divided by', '%': 'modulo' };
  for (const op of ['*', '/', '%']) {
    const idx = findTopLevel(trimmed, op);
    if (idx === -1) continue;
    const [left, right] = splitAt(trimmed, idx, 1);
    if (left && right) return `${describeExpression(left)} ${multiplicativeWords[op]} ${describeExpression(right)}`;
  }

  // Atoms: identifiers, numbers and string literals pass through unchanged.
  if (isIdentifier(trimmed) || isNumberLiteral(trimmed) || isStringLiteral(trimmed)) {
    return trimmed;
  }

  // A bare function-call-shaped value (e.g. "malloc(20)") has no untranslated
  // operators to get wrong, so it's readable enough to pass through as-is.
  if (isCallShaped(trimmed)) {
    return trimmed;
  }

  return fallback(trimmed);
}

/**
 * True if `expr`'s top level is a ternary (cond ? a : b) — used to decide
 * whether to add a short explanatory note about the "? :" syntax, since it's
 * one of the few C symbols with no English-word equivalent to translate to.
 */
export function isTernaryExpression(expr: string): boolean {
  const trimmed = stripWrappingParens(expr.trim());
  const qIndex = findTopLevel(trimmed, '?');
  if (qIndex === -1) return false;
  const cond = trimmed.slice(0, qIndex).trim();
  const rest = trimmed.slice(qIndex + 1);
  const cIndex = findTopLevel(rest, ':');
  if (!cond || cIndex === -1) return false;
  const whenTrue = rest.slice(0, cIndex).trim();
  const whenFalse = rest.slice(cIndex + 1).trim();
  return !!(whenTrue && whenFalse);
}

/** "adds 1 to i" / "subtracts 1 from count" — lowercase so callers can embed or capitalize it. */
export function describeIncrDecr(name: string, op: '++' | '--'): string {
  return op === '++' ? `adds 1 to ${name}` : `subtracts 1 from ${name}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Splits a `for (init; condition; step)` header into three plain-English
 * clauses and assembles the gold-standard sentence shape:
 * "Starts i at 0, repeats the block below while i is less than 10, and adds 1 to i after each round."
 */
export function describeForLoop(header: string): string {
  const parts = splitTopLevel(header, ';');
  if (parts.length !== 3) return fallback(header);
  const [init, condition, step] = parts;

  const clauses: string[] = [];

  if (init) {
    const initMatch = init.match(/^(\w+)\s*=\s*(.+)$/);
    clauses.push(initMatch
      ? `Starts ${initMatch[1]} at ${describeExpression(initMatch[2])}`
      : capitalize(describeExpression(init)));
  }

  if (condition) {
    clauses.push(`repeats the block below while ${describeExpression(condition)}`);
  }

  if (step) {
    const stepIncrDecr = step.match(/^(\+\+|--)(\w+)$/) ?? step.match(/^(\w+)(\+\+|--)$/);
    if (stepIncrDecr) {
      const name = /\w/.test(stepIncrDecr[1][0]) ? stepIncrDecr[1] : stepIncrDecr[2];
      const op = (/\w/.test(stepIncrDecr[1][0]) ? stepIncrDecr[2] : stepIncrDecr[1]) as '++' | '--';
      clauses.push(`and ${describeIncrDecr(name, op)} after each round`);
    } else {
      const stepAssign = step.match(/^(\w+)\s*(\+|-|\*|\/)?=\s*(.+)$/);
      if (stepAssign) {
        const [, name, op, value] = stepAssign;
        const verbs: Record<string, string> = { '+': 'increases', '-': 'decreases', '*': 'multiplies', '/': 'divides' };
        clauses.push(op
          ? `and ${verbs[op]} ${name} by ${describeExpression(value)} after each round`
          : `and sets ${name} to ${describeExpression(value)} after each round`);
      } else {
        clauses.push(`and runs \`${step}\` after each round`);
      }
    }
  }

  if (clauses.length === 0) return fallback(header);
  return capitalize(clauses.join(', ')) + '.';
}

/** Detects a C-style cast prefix like "(int)x" or "(t_data *)malloc(...)". */
export function extractCast(value: string): { castType: string; rest: string } | null {
  const match = value.match(/^\(([^()]+)\)\s*(.+)$/);
  if (!match) return null;
  const inner = match[1].trim();
  // Only treat the parenthesized part as a cast if it looks like a type name,
  // not an arithmetic sub-expression (e.g. "(a + b)").
  if (!/^[A-Za-z_]\w*(\s+\w+)*\s*\**$/.test(inner)) return null;
  const rest = match[2].trim();
  if (!rest) return null;
  return { castType: inner, rest };
}

/** Turns a raw cast type ("t_data *", "int") into an English phrase with no bare '*'. */
export function describeCastType(castType: string): string {
  const trimmed = castType.trim();
  if (trimmed.endsWith('*')) {
    return `a pointer to ${trimmed.slice(0, -1).trim()}`;
  }
  const article = /^[aeiou]/i.test(trimmed) ? 'an' : 'a';
  return `${article} ${trimmed}`;
}

/**
 * Describes a single clause of a compound (&&/||) condition. Deliberately
 * more compact than describeExpression's general phrasing — "X is Y" reads
 * better than "X equals Y" when several clauses are being listed side by
 * side. Only used for compound-condition enumeration; single conditions
 * still go through describeExpression (so `if (x == 5)` keeps "equals").
 */
export function describeConditionClause(expr: string): string {
  const trimmed = stripWrappingParens(expr.trim());

  const eq = trimmed.match(/^(.+?)\s*==\s*(.+)$/);
  if (eq) return `${eq[1].trim()} is ${eq[2].trim()}`;

  const ltZero = trimmed.match(/^(.+?)\s*<\s*0$/);
  if (ltZero) return `${ltZero[1].trim()} is negative`;

  const gtZero = trimmed.match(/^(.+?)\s*>\s*0$/);
  if (gtZero) return `${gtZero[1].trim()} is positive`;

  return describeExpression(trimmed);
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * Splits a condition on a single top-level connective (&&, ||) into its
 * clauses. Returns null for a single (non-compound) condition, or when && and
 * || are mixed at the top level — that combination can't be confidently
 * enumerated without knowing precedence/parens intent, so the caller falls
 * back to the plain single-sentence form instead of guessing.
 */
export function splitConditionClauses(condition: string): { clauses: string[]; connective: '&&' | '||' } | null {
  const andParts = splitTopLevel(condition, '&&');
  const orParts = splitTopLevel(condition, '||');
  const hasAnd = andParts.length > 1;
  const hasOr = orParts.length > 1;
  if (hasAnd && hasOr) return null;
  if (hasAnd) return { clauses: andParts, connective: '&&' };
  if (hasOr) return { clauses: orParts, connective: '||' };
  return null;
}

/**
 * Builds the enumerated "Checks N things: ..." sentence for a compound
 * if/while condition. Returns null when the condition isn't a clean
 * single-connective chain (see splitConditionClauses), so the caller can
 * fall back to the single-condition sentence form.
 *
 * `wording.action`/`wording.consequence` phrase what happens when the
 * condition holds, e.g. for `if`: action "the block below to run",
 * consequence "the block below runs"; for `while`: action "the loop to keep
 * going", consequence "the loop keeps going".
 */
export function describeCompoundCondition(
  condition: string,
  wording: { action: string; consequence: string }
): { sentence: string; clauses: string[]; combineNote: string } | null {
  const split = splitConditionClauses(condition);
  if (!split) return null;
  const { clauses, connective } = split;

  const described = clauses.map(describeConditionClause);
  const last = described[described.length - 1];
  const head = described.slice(0, -1).join(', ');
  const joiner = connective === '&&' ? ', and ' : ', or ';
  const list = head ? `${head}${joiner}${last}` : last;

  const many = described.length > 2;
  const trailer = connective === '&&'
    ? `${many ? 'All' : 'Both'} must be true for ${wording.action}.`
    : `If ${many ? 'any one' : 'either one'} is true, ${wording.consequence}.`;
  const combineNote = connective === '&&'
    ? (many ? 'all must be true (&&)' : 'both must be true (&&)')
    : (many ? 'any can be true (||)' : 'either can be true (||)');

  return {
    sentence: `Checks ${countWord(described.length)} things: ${list}. ${trailer}`,
    clauses: described,
    combineNote,
  };
}
