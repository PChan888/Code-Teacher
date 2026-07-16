/**
 * Live "as you type" partial explanations.
 *
 * Deliberate, scoped exception to CLAUDE.md's parser/explainer split: an
 * in-progress line doesn't have a stable structured shape to hand off to a
 * separate explain() step the way a completed ParsedLine does — the prefix
 * pattern IS the explanation here, so the English text is produced directly
 * in this file rather than round-tripping through a second module. Kept out
 * of cParser.ts entirely; completed-line parsing is untouched by this file.
 *
 * parsePartial is called only when parseLine has already returned `unknown`.
 * It never needs a separate "does this look unfinished" pre-check: each
 * pattern below is anchored precisely enough (exact endings, genuinely
 * unclosed parens) that a complete line simply won't match any of them and
 * falls through to null on its own.
 */

import { C_TYPES } from './cParser';
import { SyntaxEntry, typeWord, articleFor, typeGloss } from '../explainer/explainer';
import { KNOWN_FUNCTIONS } from '../explainer/knownFunctions';

export interface PartialParse {
  /** What the user appears to be doing, phrased as in-progress ("You're creating..."). */
  intent: string;
  /** What's been identified so far, rendered as Syntax Breakdown rows. */
  soFar: SyntaxEntry[];
  /** Optional nudge about what would naturally come next. */
  hint?: string;
}

const TYPE_RE = new RegExp(`^(${C_TYPES})$`);
const TYPE_NAME_RE = new RegExp(`^(${C_TYPES})\\s+(\\w+)$`);
const TYPE_ASSIGN_RE = new RegExp(`^(${C_TYPES})\\s+(\\w+)\\s*=\\s*$`);

// return/else/switch/etc. aren't real function names — without this guard
// "return (" would otherwise match the generic call-in-progress pattern
// below and wrongly claim "You're calling a function named return."
const RESERVED_KEYWORDS = new Set([
  'if', 'while', 'for', 'return', 'else', 'switch', 'case', 'default', 'do', 'struct', 'enum', 'typedef', 'sizeof',
]);

/** True if `rest` (everything after an already-consumed leading '(') still has an unclosed paren. */
function hasUnclosedParen(rest: string): boolean {
  const opens = 1 + (rest.split('(').length - 1);
  const closes = rest.split(')').length - 1;
  return opens > closes;
}

export function parsePartial(raw: string): PartialParse | null {
  const line = raw.trim();
  if (!line) return null;

  // "int x =" — type, name, and an empty value waiting to be filled in.
  const typeAssign = line.match(TYPE_ASSIGN_RE);
  if (typeAssign) {
    const [, type, name] = typeAssign;
    return {
      intent: `You're creating ${articleFor(typeWord(type))} ${typeWord(type)} variable named ${name}.`,
      soFar: [
        { label: 'data type', value: type },
        { label: 'name', value: name },
      ],
      hint: 'Now give it a starting value.',
    };
  }

  // "int x" — type and name, nothing else yet.
  const typeName = line.match(TYPE_NAME_RE);
  if (typeName) {
    const [, type, name] = typeName;
    return {
      intent: `You're creating ${articleFor(typeWord(type))} ${typeWord(type)} variable named ${name}.`,
      soFar: [
        { label: 'data type', value: type },
        { label: 'name', value: name },
      ],
    };
  }

  // "int" — just a type so far.
  const typeAlone = line.match(TYPE_RE);
  if (typeAlone) {
    const [, type] = typeAlone;
    return {
      intent: `You're starting to create something with data type ${typeGloss(type)}.`,
      soFar: [{ label: 'data type', value: typeGloss(type) }],
    };
  }

  // "if (...", "while (...", "for (..." with the paren still open.
  const control = line.match(/^(if|while|for)\s*\((.*)$/);
  if (control) {
    const [, keyword, rest] = control;
    if (!hasUnclosedParen(rest)) return null; // paren already closed - not in-progress in the way we handle

    const trimmedRest = rest.trim();
    const soFar: SyntaxEntry[] = [{ label: 'what kind of line', value: `${keyword} statement` }];

    if (keyword === 'for') {
      return {
        intent: "You're starting a for loop. It needs a starting point, a condition, and a step, separated by semicolons.",
        soFar,
      };
    }

    const loopOrCheck = keyword === 'if' ? 'an if check' : 'a while loop';
    if (!trimmedRest) {
      return {
        intent: keyword === 'if'
          ? "You're starting an if check. It needs a condition that decides whether the block below runs."
          : "You're starting a while loop. It needs a condition that decides whether to keep going.",
        soFar,
      };
    }

    // A bare identifier, optionally followed by a comparison operator
    // ("x", "x ==") — the shape you'd see mid-comparison.
    const cmpMatch = trimmedRest.match(/^(\w+)\s*(==|!=|<=|>=|<|>)?\s*$/);
    if (cmpMatch) {
      const [, name] = cmpMatch;
      return {
        intent: `You're starting ${loopOrCheck} — comparing ${name} to something.`,
        soFar: [...soFar, { label: 'comparing', value: name }],
      };
    }

    return { intent: `You're starting ${loopOrCheck}.`, soFar };
  }

  // "name(..." with the paren still open — a function call in progress.
  const call = line.match(/^(\w+)\s*\((.*)$/);
  if (call) {
    const [, name, rest] = call;
    if (RESERVED_KEYWORDS.has(name)) return null;
    if (!hasUnclosedParen(rest)) return null;

    const known = KNOWN_FUNCTIONS[name];
    if (known) {
      return {
        intent: `You're calling ${name}, which ${known.summary}.`,
        soFar: [
          { label: 'function', value: name },
          ...known.params.map((p, i) => ({ label: `parameter ${i + 1}`, value: p })),
        ],
      };
    }
    return {
      intent: `You're calling a function named ${name}.`,
      soFar: [{ label: 'function', value: name }],
    };
  }

  return null;
}
