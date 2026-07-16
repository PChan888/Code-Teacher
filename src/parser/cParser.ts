/**
 * Rule-based C code parser.
 * Takes a single line of C code and returns structured token data.
 */

export type ParsedLine =
  | { kind: 'preprocessor'; directive: 'include'; header: string; system: boolean }
  | { kind: 'preprocessor'; directive: 'define'; name: string; params?: string[]; value?: string }
  | { kind: 'preprocessor'; directive: 'ifndef' | 'ifdef' | 'endif'; name?: string }
  | { kind: 'block_open'; blockType: 'struct' | 'enum'; tag?: string; isTypedef: boolean }
  | { kind: 'block_close'; name?: string }
  | { kind: 'function_def'; returnType: string; returnPointer: boolean; name: string; params: Param[] }
  | { kind: 'function_call'; name: string; args: string[] }
  | { kind: 'variable_decl'; type: string; pointer: boolean; name: string; value?: string; arraySize?: string }
  | { kind: 'assignment'; name: string; operator: string; value: string; target?: AssignTarget }
  | { kind: 'incr_decr'; name: string; op: '++' | '--'; position: 'prefix' | 'postfix' }
  | { kind: 'bit_shift'; left: string; direction: 'left' | 'right'; amount: string }
  | { kind: 'control_flow'; statement: 'if' | 'else' | 'while' | 'for' | 'return'; condition?: string }
  | { kind: 'comment'; text: string }
  | { kind: 'unknown'; raw: string };

export interface Param {
  type: string;
  pointer: boolean;
  name: string;
}

/** Describes what an assignment's left-hand side actually targets, beyond a bare variable name. */
export type AssignTarget =
  | { form: 'index'; index: string }
  | { form: 'deref' }
  | { form: 'member'; op: '.' | '->'; field: string };

export const C_TYPES = 'int|char|float|double|long|short|unsigned|void|size_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|bool|t_\\w+|s_\\w+|e_\\w+';

/**
 * Returns null when any parameter is malformed (e.g. "char argv[][]").
 * A wrong explanation is worse than unknown, so a bad parameter rejects
 * the whole function_def match and the line falls through to unknown.
 * Valid name shapes: argv, argv[], argv[10], argv[][10].
 * Invalid: argv[][] (only the first array dimension may be empty in C).
 */
const PARAM_NAME_RE = /^\w+(\[\d*\])?(\[\d+\])*$/;

/**
 * True if `s` contains a bitwise operator other than the shift already being
 * matched (|, &, ^, or a second <</>>). A single clean shift's captured
 * left-hand side should never contain one of these — if it does, the lazy
 * regex it came from over-matched a larger expression (e.g. "1 << 8 | 1"
 * from "1 << 8 | 1 << 16"), and this isn't a single shift we can trust.
 */
export function hasStrayBitwiseOperator(s: string): boolean {
  return /[|&^]|<<|>>/.test(s);
}

/**
 * Strips a trailing "// comment" (outside string/char literals) so it can't
 * get swallowed into a value/condition capture further down (e.g.
 * "i = 7; // note" was parsing with value "7; // note"). Mid-line /* * /
 * block comments are intentionally out of scope here — see KNOWN_GAPS.md.
 */
function stripTrailingLineComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i).trimEnd();
  }
  return line;
}

/** True if a captured bracket group is really a second dimension ("grid[2][2]" glommed into one "[...]"). */
function looksLikeNestedBrackets(s: string | undefined): boolean {
  return s !== undefined && s.includes(']');
}

/**
 * Splits a function-call argument list on top-level commas — respecting
 * string/char literals, so a comma inside a format string (e.g.
 * `printf("%d,%d\n", x, y)`) doesn't get treated as an argument separator.
 */
function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === ',') {
      args.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  args.push(raw.slice(start));
  return args.map(a => a.trim()).filter(Boolean);
}

function parseParams(raw: string): Param[] | null {
  if (!raw.trim() || raw.trim() === 'void') return [];
  const params: Param[] = [];
  for (let p of raw.split(',')) {
    p = p.trim();
    const pointer = p.includes('*');
    const clean = p.replace(/\*/g, '').trim();
    const parts = clean.split(/\s+/);
    const name = parts.pop() ?? '';
    const type = parts.join(' ');
    if (!type || !PARAM_NAME_RE.test(name)) return null;
    params.push({ type, pointer, name });
  }
  return params;
}

export function parseLine(raw: string): ParsedLine {
  let line = raw.trim();

  // Empty or blank
  if (!line) return { kind: 'unknown', raw };

  // Single-line comment
  if (line.startsWith('//')) {
    return { kind: 'comment', text: line.slice(2).trim() };
  }

  // Block comment line. A line starting with '*' is ambiguous with a pointer
  // dereference assignment ("*ptr = 5;") — conventionally-styled deref
  // assignments have no space between '*' and the name, so that shape is
  // excluded here and left to fall through to the assignment branch below.
  const looksLikeDerefAssign = /^\*\w+\s*(?:\[.+?\]|->\w+|\.\w+)?\s*(?:[+\-*/%&|^]|<<|>>)?=\s*.+;?\s*$/.test(line);
  if ((line.startsWith('*') && !looksLikeDerefAssign) || line.startsWith('/*')) {
    return { kind: 'comment', text: line.replace(/^\/?\*+\/?/, '').trim() };
  }

  // Strip a trailing "// comment" so it doesn't get swallowed into a
  // value/condition capture by the (greedy-ish) regexes below. Must happen
  // after the whole-line-comment checks above (which need the "//" intact).
  line = stripTrailingLineComment(line);

  // Reserved keywords that aren't supported as their own construct yet and
  // would otherwise be misread by a looser branch below — most importantly
  // "switch (x)" mis-matching the function_call regex as a call to a
  // function named "switch". Explicitly unknown rather than wrong.
  if (/^switch\b/.test(line)) {
    return { kind: 'unknown', raw: line };
  }

  // Preprocessor directives: the leading '#' is completely unambiguous, so
  // check these before anything else rather than risk them falling through.
  if (line.startsWith('#')) {
    const includeMatch = line.match(/^#include\s*[<"]([^">]+)[>"]/);
    if (includeMatch) {
      return { kind: 'preprocessor', directive: 'include', header: includeMatch[1], system: line.includes('<') };
    }
    const defineMatch = line.match(/^#define\s+(\w+)(?:\(([^)]*)\))?\s*(.*)$/);
    if (defineMatch) {
      const params = defineMatch[2] !== undefined
        ? defineMatch[2].split(',').map(p => p.trim()).filter(Boolean)
        : undefined;
      return {
        kind: 'preprocessor',
        directive: 'define',
        name: defineMatch[1],
        params,
        value: defineMatch[3] ? defineMatch[3].trim() : undefined,
      };
    }
    const guardMatch = line.match(/^#(ifndef|ifdef|endif)\b\s*(\w+)?/);
    if (guardMatch) {
      return {
        kind: 'preprocessor',
        directive: guardMatch[1] as 'ifndef' | 'ifdef' | 'endif',
        name: guardMatch[2],
      };
    }
    // Unrecognized directive (#pragma, #undef, #else, ...) - falls through to unknown below.
  }

  // Struct/enum/typedef openers and closers: distinctive keywords or a
  // closing brace + ';' pattern, unlikely to be confused with anything else.
  // Checked early so they don't get mis-caught by later, looser regexes.
  // The brace is optional (as with function_def below) so Allman-style
  // struct headers ("typedef struct s_point" with '{' on the next line,
  // common in 42-school C) are recognized too.
  const blockOpen = line.match(/^(typedef\s+)?(struct|enum)\s+(\w+)?\s*\{?\s*$/);
  if (blockOpen) {
    return {
      kind: 'block_open',
      blockType: blockOpen[2] as 'struct' | 'enum',
      isTypedef: !!blockOpen[1],
      tag: blockOpen[3],
    };
  }
  // Requires a trailing ';' so a bare '}' closing an if/while/for/function
  // body (not a declaration) still safely falls through to unknown.
  const blockClose = line.match(/^\}\s*(\w+)?\s*;$/);
  if (blockClose) {
    return { kind: 'block_close', name: blockClose[1] };
  }

  // Bit shift: only when the shift is the *entire* expression. A shift
  // embedded in an assignment's value (e.g. "x = 1 << 3;") is deliberately
  // left for the assignment branch below, which detects it in the value and
  // attaches the same binary visual. Guarded by checking for a top-level '='
  // that isn't part of a comparison/compound operator (==, !=, <=, >=).
  if (!findTopLevelAssignExcludingComparisons(line)) {
    const bitShift = line.match(/^(.+?)\s*(<<|>>)\s*(\d+)\s*;?$/);
    // A stray |, &, ^ or second shift in the captured left side means the
    // lazy match above over-ran a larger expression (e.g. "1 << 8 | 1" from
    // "1 << 8 | 1 << 16;") — not a single trustworthy shift.
    if (bitShift && !hasStrayBitwiseOperator(bitShift[1])) {
      return {
        kind: 'bit_shift',
        left: bitShift[1].trim(),
        direction: bitShift[2] === '<<' ? 'left' : 'right',
        amount: bitShift[3],
      };
    }
  }

  // Control flow: return
  const returnMatch = line.match(/^return\s*(.*?);?$/);
  if (returnMatch) {
    return { kind: 'control_flow', statement: 'return', condition: returnMatch[1].trim() };
  }

  // Control flow: if / while / for
  const controlMatch = line.match(/^(if|while|for|else\s*if)\s*\((.*)\)/);
  if (controlMatch) {
    const stmt = controlMatch[1].trim().startsWith('else') ? 'if' : controlMatch[1].trim() as 'if' | 'while' | 'for';
    return { kind: 'control_flow', statement: stmt, condition: controlMatch[2].trim() };
  }

  // else
  if (/^else\s*\{?$/.test(line)) {
    return { kind: 'control_flow', statement: 'else' };
  }

  // Function definition: type (*pointer)? name(params) {
  const funcDefRe = new RegExp(`^(${C_TYPES})\\s+(\\*?)(\\w+)\\s*\\(([^)]*)\\)\\s*\\{?\\s*$`);
  const funcDef = line.match(funcDefRe);
  if (funcDef) {
    const params = parseParams(funcDef[4]);
    // null params = malformed parameter list ("char argv[][]") — not a
    // function definition we can trust, so let it fall through to unknown.
    if (params) {
      return {
        kind: 'function_def',
        returnType: funcDef[1],
        returnPointer: funcDef[2] === '*',
        name: funcDef[3],
        params,
      };
    }
  }

  // Variable declaration with optional array size and/or initial value
  const varDeclRe = new RegExp(`^(${C_TYPES})\\s+(\\*?)(\\w+)(?:\\[(.*?)\\])?(?:\\s*=\\s*(.+?))?;?$`);
  const varDecl = line.match(varDeclRe);
  // A ']' inside the captured array size means a 2D array ("grid[2][2]")
  // got glommed into one bracket pair by the lazy match above. 2D arrays
  // aren't supported (see KNOWN_GAPS.md) — fall through to unknown rather
  // than report a garbled size.
  if (varDecl && !looksLikeNestedBrackets(varDecl[4])) {
    return {
      kind: 'variable_decl',
      type: varDecl[1],
      pointer: varDecl[2] === '*',
      name: varDecl[3],
      arraySize: varDecl[4],
      value: varDecl[5]?.trim(),
    };
  }

  // Increment/decrement: no '=' involved, so this can never clash with an
  // assignment. Checked right before assignment since both are simple
  // single-variable mutation statements.
  const prefixIncrDecr = line.match(/^(\+\+|--)(\w+)\s*;?$/);
  if (prefixIncrDecr) {
    return { kind: 'incr_decr', name: prefixIncrDecr[2], op: prefixIncrDecr[1] as '++' | '--', position: 'prefix' };
  }
  const postfixIncrDecr = line.match(/^(\w+)(\+\+|--)\s*;?$/);
  if (postfixIncrDecr) {
    return { kind: 'incr_decr', name: postfixIncrDecr[1], op: postfixIncrDecr[2] as '++' | '--', position: 'postfix' };
  }

  // Assignment: (*)?name([index] | ->field | .field)? op= value
  // The (?!=) after the mandatory '=' stops "i == 5" from being misread as
  // an assignment (operator '=', value "= 5") — the '=' being matched must
  // not itself be the first half of a "==" comparison.
  const assignRe = /^(\*)?(\w+)(?:\[(.+?)\]|(->|\.)(\w+))?\s*(\+|-|\*|\/|%|&|\||\^|<<|>>)?=(?!=)\s*(.+?);?$/;
  const assignMatch = line.match(assignRe);
  // A ']' inside the captured index means a 2D index ("grid[1][1]") got
  // glommed into one bracket pair — not supported, fall through to unknown.
  if (assignMatch && !looksLikeNestedBrackets(assignMatch[3])) {
    const [, deref, name, index, memberOp, field, compoundOp, value] = assignMatch;
    const op = compoundOp ? compoundOp + '=' : '=';
    let target: AssignTarget | undefined;
    if (deref) target = { form: 'deref' };
    else if (index !== undefined) target = { form: 'index', index };
    else if (memberOp) target = { form: 'member', op: memberOp as '.' | '->', field };
    return { kind: 'assignment', name, operator: op, value: value.trim(), target };
  }

  // Standalone function call: name(args);
  const callMatch = line.match(/^(\w+)\s*\(([^)]*)\)\s*;?$/);
  if (callMatch) {
    return {
      kind: 'function_call',
      name: callMatch[1],
      args: splitArgs(callMatch[2]),
    };
  }

  return { kind: 'unknown', raw: line };
}

/** True if `line` has a top-level '=' that isn't part of ==, !=, <=, >=. */
function findTopLevelAssignExcludingComparisons(line: string): boolean {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0 || c !== '=') continue;
    const prev = line[i - 1];
    const next = line[i + 1];
    if (prev === '=' || prev === '!' || prev === '<' || prev === '>') continue;
    if (next === '=') continue;
    return true;
  }
  return false;
}

/** Render bit shift as binary before/after visual */
export function bitShiftVisual(value: number, direction: 'left' | 'right', amount: number): string {
  const before = (value >>> 0).toString(2).padStart(32, '0');
  const after = direction === 'left'
    ? ((value << amount) >>> 0).toString(2).padStart(32, '0')
    : ((value >>> amount) >>> 0).toString(2).padStart(32, '0');

  // Format as groups of 8 bits
  const fmt = (b: string) => b.match(/.{8}/g)!.join(' ');
  return `before: ${fmt(before)}\nafter:  ${fmt(after)}`;
}

/** Only treat a shift's left-hand side as a renderable literal for the binary visual. */
export function parseShiftLiteral(value: string): number | null {
  const trimmed = value.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed)) return parseInt(trimmed, 16);
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return null;
}

/**
 * True if `amount` can be safely rendered by bitShiftVisual. JS's `<<`/`>>`
 * only use the shift amount modulo 32 (so "1 << 32" evaluates as "1 << 0"
 * in JS), which would render a before/after visual that's silently wrong
 * for amount >= 32 — better to explain the shift in words only.
 */
export function isRenderableShiftAmount(amount: number): boolean {
  return amount >= 0 && amount < 32;
}
