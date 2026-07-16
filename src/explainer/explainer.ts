/**
 * Explanation generator.
 * Takes a ParsedLine and returns:
 *   - syntax: structured breakdown (top section)
 *   - plain: plain English sentence (bottom section)
 */

import { ParsedLine, bitShiftVisual, parseShiftLiteral, hasStrayBitwiseOperator, isRenderableShiftAmount } from '../parser/cParser';
import {
  describeExpression, describeForLoop, describeIncrDecr, extractCast, describeCastType,
  describeCompoundCondition, isTernaryExpression,
} from './expressions';
import { KNOWN_FUNCTIONS } from './knownFunctions';

export interface Explanation {
  syntax: SyntaxEntry[];
  plain: string;
  /** Set when the line fell through to the safe `unknown` fallback, so the panel can show friendlier copy. */
  isUnknown?: boolean;
}

export interface SyntaxEntry {
  label: string;
  value: string;
}

/** English words for built-in types; custom/struct types (t_x, s_x, ...) fall back to their raw name. */
const TYPE_WORDS: Record<string, string> = {
  int: 'integer',
  char: 'character',
  float: 'floating-point number',
  double: 'double-precision floating-point number',
  long: 'long integer',
  short: 'short integer',
  unsigned: 'unsigned integer',
  bool: 'boolean',
  size_t: 'size value',
  void: 'void',
};

export function typeWord(type: string): string {
  return TYPE_WORDS[type] ?? type;
}

export function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Plain-English noun-phrase descriptions for the Syntax Breakdown's type
 * rows (not the "What's Happening" sentence, which keeps using TYPE_WORDS).
 * Deliberately the exact set called out in the Phase 2 revision — not every
 * C_TYPES entry (bool, uintN_t, long, short, e_*, ...) has a gloss; those
 * fall back to showing the bare type name.
 */
const TYPE_DESCRIPTIONS: Record<string, string> = {
  int: 'a whole number',
  char: 'a single character (one letter, digit, or symbol)',
  float: 'a number with decimals',
  double: 'a number with decimals',
  void: 'nothing/no value',
  unsigned: "a whole number that can't be negative",
  size_t: 'a whole number used for sizes and counts',
};

function typeDescription(type: string): string | undefined {
  if (/^(t_|s_)\w+$/.test(type)) return 'a custom type defined in this project';
  return TYPE_DESCRIPTIONS[type];
}

/** e.g. "int — a whole number"; falls back to the bare type name when there's no gloss. */
export function typeGloss(type: string): string {
  const desc = typeDescription(type);
  return desc ? `${type} — ${desc}` : type;
}

/** e.g. "pointer to int — holds the memory address of a whole number". */
function pointerTypeGloss(type: string): string {
  const desc = typeDescription(type);
  return desc ? `pointer to ${type} — holds the memory address of ${desc}` : `pointer to ${type}`;
}

const COMMON_HEADERS: Record<string, string> = {
  'stdio.h': 'input/output functions like printf and scanf',
  'stdlib.h': 'general utilities like malloc, free, and exit',
  'string.h': 'string manipulation functions like strlen and strcpy',
  'math.h': 'math functions like sqrt and pow',
  'unistd.h': 'POSIX functions like write, read, and close',
};

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** ?: has no English-word equivalent, so a short one-time note explains the syntax itself. */
const TERNARY_NOTE = ' (The "? :" is shorthand for an if/else that returns a value — this pattern is called a "ternary" expression.)';

/** Describes a variable/assignment value, unwrapping a leading cast if present. */
function describeValue(value: string): { desc: string; castSuffix: string; ternaryNote: string } {
  const cast = extractCast(value);
  const bareValue = cast ? cast.rest : value;
  const ternaryNote = isTernaryExpression(bareValue) ? TERNARY_NOTE : '';
  if (cast) {
    return { desc: describeExpression(cast.rest), castSuffix: `, converted to ${describeCastType(cast.castType)}`, ternaryNote };
  }
  return { desc: describeExpression(value), castSuffix: '', ternaryNote };
}

export function explain(parsed: ParsedLine): Explanation {
  switch (parsed.kind) {

    case 'preprocessor': {
      switch (parsed.directive) {
        case 'include': {
          const headerDisplay = parsed.system ? `<${parsed.header}>` : `"${parsed.header}"`;
          const desc = COMMON_HEADERS[parsed.header];
          return {
            syntax: [
              { label: 'directive', value: '#include' },
              { label: 'header', value: headerDisplay },
            ],
            plain: desc
              ? `Brings in the ${headerDisplay} library, which provides ${desc}.`
              : `Brings in the ${headerDisplay} library.`,
          };
        }
        case 'define': {
          const syntax: SyntaxEntry[] = [
            { label: 'directive', value: '#define' },
            { label: 'name', value: parsed.name },
          ];
          if (parsed.params) syntax.push({ label: 'macro arguments', value: parsed.params.length ? parsed.params.join(', ') : 'none' });
          if (parsed.value) syntax.push({ label: 'expands to', value: parsed.value });

          let plain: string;
          if (parsed.params) {
            plain = `Defines a macro "${parsed.name}(${parsed.params.join(', ')})" — wherever ${parsed.name}(...) appears in the code, it gets replaced with ${parsed.value || 'the expression that follows'}.`;
          } else if (parsed.value) {
            plain = `Defines "${parsed.name}" as a stand-in for ${parsed.value}. Wherever "${parsed.name}" appears in the code, the compiler swaps in ${parsed.value}.`;
          } else {
            plain = `Marks "${parsed.name}" as defined — commonly paired with #ifndef to stop a header's contents from being included twice.`;
          }
          return { syntax, plain };
        }
        case 'ifndef':
        case 'ifdef':
        case 'endif': {
          const syntax: SyntaxEntry[] = [{ label: 'directive', value: `#${parsed.directive}` }];
          if (parsed.name) syntax.push({ label: 'name', value: parsed.name });

          const plainByDirective: Record<typeof parsed.directive, string> = {
            ifndef: `Checks if "${parsed.name}" hasn't been defined yet — the classic header guard that stops this file's contents from being included twice.`,
            ifdef: `Checks if "${parsed.name}" has been defined.`,
            endif: 'Marks the end of the #if/#ifndef block above.',
          };
          return { syntax, plain: plainByDirective[parsed.directive] };
        }
      }
    }

    case 'block_open': {
      const kindWord = parsed.blockType === 'struct' ? 'struct' : 'enum';
      const syntax: SyntaxEntry[] = [
        { label: 'kind', value: `${parsed.isTypedef ? 'typedef ' : ''}${kindWord}` },
        { label: 'tag', value: parsed.tag ?? '(none)' },
      ];
      const named = parsed.tag ? ` named "${parsed.tag}"` : '';
      const bodyDesc = parsed.blockType === 'struct'
        ? 'a custom type that bundles related variables together'
        : 'a custom type made up of a fixed set of named values';
      const typedefNote = parsed.isTypedef
        ? ' The closing line below will give it a short type name to use elsewhere.'
        : '';
      return {
        syntax,
        plain: `Starts defining a ${kindWord}${named} — ${bodyDesc}.${typedefNote}`,
      };
    }

    case 'block_close': {
      return {
        syntax: [{ label: 'closes', value: parsed.name ?? '(none)' }],
        plain: parsed.name
          ? `Closes the struct or enum definition above and gives it the shorthand type name "${parsed.name}".`
          : 'Closes the struct or enum definition above.',
      };
    }

    case 'function_def': {
      const syntax: SyntaxEntry[] = [
        { label: 'return type', value: parsed.returnPointer ? pointerTypeGloss(parsed.returnType) : typeGloss(parsed.returnType) },
        { label: 'name', value: parsed.name },
      ];
      if (parsed.params.length === 0) {
        syntax.push({ label: 'parameters', value: 'none' });
      } else {
        parsed.params.forEach((p, i) => {
          const typeDesc = p.pointer ? pointerTypeGloss(p.type) : typeGloss(p.type);
          syntax.push({
            label: `parameter ${i + 1}`,
            value: `${typeDesc}${p.name ? `, named ${p.name}` : ''}`,
          });
        });
      }

      if (parsed.name === 'main') {
        const paramNames = parsed.params.map(p => p.name);
        const plain = paramNames.includes('argc') && paramNames.includes('argv')
          ? 'This is "main" — the entry point of the program. Execution starts here when you run the compiled file. "argc" is the number of command-line arguments given, and "argv" is the list of those arguments as text.'
          : 'This is "main" — the entry point of the program. Execution starts here when you run the compiled file.';
        return { syntax, plain };
      }

      const paramDesc = parsed.params.length === 0
        ? 'no parameters'
        : parsed.params.map(p => `${p.pointer ? 'a pointer to ' : 'a '}${p.type} named ${p.name}`).join(', ');
      const returnDesc = parsed.returnPointer ? `a pointer to ${parsed.returnType}` : parsed.returnType;
      return {
        syntax,
        plain: `Defines a function called "${parsed.name}" that returns ${returnDesc} and takes ${paramDesc}.`,
      };
    }

    case 'function_call': {
      const known = KNOWN_FUNCTIONS[parsed.name];
      if (known) {
        const syntax: SyntaxEntry[] = [
          { label: 'function call', value: parsed.name },
          ...parsed.args.map((a, i) => ({
            label: known.params[i] ?? `argument ${i + 1}`,
            value: known.argValue ? known.argValue(a, i) : a,
          })),
        ];
        return { syntax, plain: known.build(parsed.args) };
      }

      const syntax: SyntaxEntry[] = [
        { label: 'function call', value: parsed.name },
        { label: 'arguments', value: parsed.args.length ? parsed.args.join(', ') : 'none' },
      ];
      const argDesc = parsed.args.length
        ? `with ${parsed.args.join(', ')}`
        : 'with no arguments';
      return {
        syntax,
        plain: `Calls the function "${parsed.name}" ${argDesc}.`,
      };
    }

    case 'variable_decl': {
      const syntax: SyntaxEntry[] = [
        {
          label: 'data type',
          value: parsed.pointer
            ? pointerTypeGloss(parsed.type)
            : parsed.arraySize !== undefined ? `array of ${typeGloss(parsed.type)}` : typeGloss(parsed.type),
        },
        { label: 'name', value: parsed.name },
      ];
      if (parsed.arraySize !== undefined) {
        syntax.push({ label: 'array size', value: parsed.arraySize || '(set by initial value)' });
      }
      const cast = parsed.value !== undefined ? extractCast(parsed.value) : null;
      if (cast) syntax.push({ label: 'cast', value: cast.castType });
      if (parsed.value !== undefined) syntax.push({ label: 'initial value', value: parsed.value });

      let plain: string;
      if (parsed.pointer) {
        let sentence = `Creates a variable named ${parsed.name} that holds the memory address of a ${parsed.type} — a "pointer".`;
        sentence += parsed.type === 'char'
          ? ` It doesn't hold text itself, it points to where text lives.`
          : ` It doesn't hold the value itself, it points to where that value lives.`;
        if (parsed.value !== undefined) {
          const { desc, castSuffix, ternaryNote } = describeValue(parsed.value);
          sentence += ` It's set to ${desc}${castSuffix}.${ternaryNote}`;
        }
        plain = sentence;
      } else if (parsed.arraySize !== undefined) {
        const sizeDesc = parsed.arraySize
          ? `room for ${parsed.arraySize} ${typeWord(parsed.type)}${parsed.arraySize === '1' ? '' : 's'}`
          : `its size set by the value it's initialized with`;
        plain = `Creates an array named ${parsed.name} with ${sizeDesc}.`;
        if (parsed.value !== undefined) {
          plain += ` It starts out set to ${describeExpression(parsed.value)}.`;
        }
      } else if (parsed.value !== undefined) {
        const { desc, castSuffix, ternaryNote } = describeValue(parsed.value);
        plain = `Creates ${articleFor(typeWord(parsed.type))} ${typeWord(parsed.type)} variable named ${parsed.name} and sets it to ${desc}${castSuffix}.${ternaryNote}`;
      } else {
        plain = `Creates ${articleFor(typeWord(parsed.type))} ${typeWord(parsed.type)} variable named ${parsed.name}.`;
      }

      return { syntax, plain };
    }

    case 'assignment': {
      const cast = extractCast(parsed.value);
      const { desc: valueDesc, castSuffix, ternaryNote } = describeValue(parsed.value);

      const syntax: SyntaxEntry[] = [];
      if (parsed.target?.form === 'deref') {
        syntax.push({ label: 'pointer', value: `*${parsed.name}` });
      } else if (parsed.target?.form === 'member') {
        syntax.push({ label: 'field', value: `${parsed.name}${parsed.target.op}${parsed.target.field}` });
      } else if (parsed.target?.form === 'index') {
        syntax.push({ label: 'element', value: `${parsed.name}[${parsed.target.index}]` });
      } else {
        syntax.push({ label: 'variable being changed', value: parsed.name });
      }
      syntax.push({ label: 'operation', value: parsed.operator });
      syntax.push({ label: 'new value', value: parsed.value });
      if (cast) syntax.push({ label: 'cast', value: cast.castType });

      if (parsed.target?.form === 'deref') {
        return { syntax, plain: `Stores ${valueDesc}${castSuffix} in the memory that ${parsed.name} points to.${ternaryNote}` };
      }
      if (parsed.target?.form === 'member') {
        const owner = parsed.target.op === '->' ? `the struct that ${parsed.name} points to` : parsed.name;
        return { syntax, plain: `Sets the "${parsed.target.field}" field of ${owner}, to ${valueDesc}${castSuffix}.${ternaryNote}` };
      }
      if (parsed.target?.form === 'index') {
        return {
          syntax,
          plain: `Sets element ${describeExpression(parsed.target.index)} of the array ${parsed.name}, to ${valueDesc}${castSuffix}.${ternaryNote}`,
        };
      }

      // Plain assignment. A shift embedded in the value (e.g. "x = 1 << 3;")
      // gets the same binary-visual treatment as a standalone bit_shift line.
      // A stray |, &, ^ or second shift in the captured left side means this
      // is a larger bitwise expression (e.g. "1 << 8 | 1 << 16"), not a
      // single trustworthy shift — falls through to the generic templates
      // below, which safely backtick-wrap it via describeExpression.
      const embeddedShiftMatch = parsed.operator === '=' && parsed.value.match(/^(.+?)\s*(<<|>>)\s*(\d+)$/);
      const embeddedShift = embeddedShiftMatch && !hasStrayBitwiseOperator(embeddedShiftMatch[1]) ? embeddedShiftMatch : null;
      if (embeddedShift) {
        const [, left, dir, amount] = embeddedShift;
        const direction = dir === '<<' ? 'left' : 'right';
        const literal = parseShiftLiteral(left);
        const amountNum = parseInt(amount, 10);
        const visual = literal !== null && isRenderableShiftAmount(amountNum)
          ? bitShiftVisual(literal, direction, amountNum)
          : null;
        syntax.push({ label: 'operation', value: `shift ${direction}` });
        syntax.push({ label: 'amount', value: `${amount} bit${amount === '1' ? '' : 's'}` });
        if (visual) syntax.push({ label: 'binary', value: visual });
        return {
          syntax,
          plain: `Sets ${parsed.name} to ${left.trim()} shifted ${direction} by ${amount} bit${amount === '1' ? '' : 's'}.${visual ? '\n' + visual : ''}`,
        };
      }

      const templates: Record<string, string> = {
        '=': `Sets ${parsed.name} to ${valueDesc}${castSuffix}.`,
        '+=': `Increases ${parsed.name} by ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} + ${valueDesc}.)`,
        '-=': `Decreases ${parsed.name} by ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} - ${valueDesc}.)`,
        '*=': `Multiplies ${parsed.name} by ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} * ${valueDesc}.)`,
        '/=': `Divides ${parsed.name} by ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} / ${valueDesc}.)`,
        '%=': `Sets ${parsed.name} to the remainder of dividing it by ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} % ${valueDesc}.)`,
        '&=': `Bitwise-ANDs ${parsed.name} with ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} & ${valueDesc}.)`,
        '|=': `Bitwise-ORs ${parsed.name} with ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} | ${valueDesc}.)`,
        '^=': `Bitwise-XORs ${parsed.name} with ${valueDesc}. (Same as ${parsed.name} = ${parsed.name} ^ ${valueDesc}.)`,
        '<<=': `Left-shifts ${parsed.name} by ${valueDesc} bit(s). (Same as ${parsed.name} = ${parsed.name} << ${valueDesc}.)`,
        '>>=': `Right-shifts ${parsed.name} by ${valueDesc} bit(s). (Same as ${parsed.name} = ${parsed.name} >> ${valueDesc}.)`,
      };
      const plain = templates[parsed.operator] ?? `Sets ${parsed.name} to ${valueDesc}${castSuffix}.`;
      return { syntax, plain: plain + ternaryNote };
    }

    case 'incr_decr': {
      const syntax: SyntaxEntry[] = [
        { label: 'variable being changed', value: parsed.name },
        { label: 'operation', value: parsed.op === '++' ? 'increment (+1)' : 'decrement (-1)' },
        { label: 'position', value: parsed.position },
      ];
      return { syntax, plain: `${capitalize(describeIncrDecr(parsed.name, parsed.op))}.` };
    }

    case 'bit_shift': {
      const literal = parseShiftLiteral(parsed.left);
      const amountNum = parseInt(parsed.amount, 10);
      const visual = literal !== null && isRenderableShiftAmount(amountNum)
        ? bitShiftVisual(literal, parsed.direction, amountNum)
        : null;

      const syntax: SyntaxEntry[] = [
        { label: 'value', value: parsed.left },
        { label: 'operation', value: `shift ${parsed.direction}` },
        { label: 'amount', value: `${parsed.amount} bits` },
      ];
      if (visual) syntax.push({ label: 'binary', value: visual });

      const cantShowReason = literal === null
        ? `"${parsed.left}" isn't a plain number`
        : `a shift of ${parsed.amount} is too large to show accurately`;
      const plain = visual
        ? `Shifts the bits of ${parsed.left} ${parsed.direction} by ${parsed.amount} position${parsed.amount === '1' ? '' : 's'}.\n${visual}`
        : `Shifts ${parsed.left} ${parsed.direction} by ${parsed.amount} position${parsed.amount === '1' ? '' : 's'}. (Can't show the binary visual since ${cantShowReason}.)`;

      return { syntax, plain };
    }

    case 'control_flow': {
      const stmtMap: Record<string, string> = {
        if: 'if statement',
        else: 'else block',
        while: 'while loop',
        for: 'for loop',
        return: 'return statement',
      };
      const syntax: SyntaxEntry[] = [
        { label: 'what kind of line', value: stmtMap[parsed.statement] ?? parsed.statement },
      ];

      if (parsed.statement === 'for' && parsed.condition) {
        const [init, cond, step] = parsed.condition.split(';').map(p => p.trim());
        if (init) syntax.push({ label: 'setup', value: init });
        if (cond) syntax.push({ label: 'keep-going condition', value: cond });
        if (step) syntax.push({ label: 'after each round', value: step });
        return { syntax, plain: describeForLoop(parsed.condition) };
      }

      if (parsed.statement === 'if' || parsed.statement === 'while') {
        const condition = parsed.condition ?? '';
        // "if" talks about running the block below once; "while" talks about
        // continuing to loop — the compound-condition trailer needs to say
        // the right one of those.
        const wording = parsed.statement === 'if'
          ? { action: 'the block below to run', consequence: 'the block below runs' }
          : { action: 'the loop to keep going', consequence: 'the loop keeps going' };
        const compound = describeCompoundCondition(condition, wording);
        if (compound) {
          compound.clauses.forEach((clause, i) => syntax.push({ label: `check ${i + 1}`, value: clause }));
          syntax.push({ label: 'how they combine', value: compound.combineNote });
          return { syntax, plain: compound.sentence };
        }

        syntax.push({ label: 'the check', value: condition });
        const plain = parsed.statement === 'if'
          ? `Checks if ${describeExpression(condition)}. If it's true, the block below runs.`
          : `Keeps repeating the block below while ${describeExpression(condition)}.`;
        return { syntax, plain };
      }

      if (parsed.statement === 'else') {
        return { syntax, plain: 'Runs the block below if the previous if condition was false.' };
      }

      // return
      if (!parsed.condition) {
        return { syntax, plain: 'Ends the function here, without handing back a value.' };
      }
      syntax.push({ label: "what's returned", value: parsed.condition });
      const desc = describeExpression(parsed.condition);
      const zeroNote = desc === '0' ? ' (0 usually means "everything went fine.")' : '';
      return { syntax, plain: `Ends the function here and hands back ${desc}.${zeroNote}` };
    }

    case 'comment': {
      return {
        syntax: [{ label: 'comment', value: parsed.text }],
        plain: `This is a comment: "${parsed.text}"`,
      };
    }

    case 'unknown': {
      return {
        syntax: [{ label: 'line', value: parsed.raw }],
        plain: "I can't break this line down yet — this is a preview of what the parser supports.",
        isUnknown: true,
      };
    }
  }
}
