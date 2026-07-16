import { describe, it, expect } from 'vitest';
import { explain } from '../src/explainer/explainer';
import { parseLine, ParsedLine } from '../src/parser/cParser';

function labels(entries: { label: string }[]): string[] {
  return entries.map(e => e.label);
}

describe('explain', () => {
  it('function_def: describes name, return type and parameters', () => {
    const parsed: ParsedLine = {
      kind: 'function_def',
      returnType: 'int',
      returnPointer: false,
      name: 'close_window',
      params: [{ type: 't_fractol', pointer: true, name: 'f' }],
    };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['return type', 'name', 'parameter 1']);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('close_window');
    expect(result.plain).toContain('int');
  });

  it('function_def: shows "none" for a parameterless function', () => {
    const parsed: ParsedLine = {
      kind: 'function_def',
      returnType: 'int',
      returnPointer: false,
      name: 'main',
      params: [],
    };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['return type', 'name', 'parameters']);
    expect(result.plain.length).toBeGreaterThan(0);
  });

  it('function_def: a pointer return type is glossed and mentioned in the plain sentence (regression, found via stress.c)', () => {
    const result = explain(parseLine('char *get_name(void)'));
    expect(result.syntax[0]).toEqual({
      label: 'return type',
      value: 'pointer to char — holds the memory address of a single character (one letter, digit, or symbol)',
    });
    expect(result.plain).toBe('Defines a function called "get_name" that returns a pointer to char and takes no parameters.');
  });

  it('function_call: describes the call and its arguments', () => {
    const parsed: ParsedLine = { kind: 'function_call', name: 'close_window', args: ['f'] };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['function call', 'arguments']);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('close_window');
  });

  it('variable_decl: describes type, name and initial value', () => {
    const parsed: ParsedLine = {
      kind: 'variable_decl',
      type: 'int',
      pointer: false,
      name: 'x',
      value: '5',
    };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['data type', 'name', 'initial value']);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('x');
  });

  it('variable_decl: data type row carries a plain-English gloss', () => {
    const parsed: ParsedLine = { kind: 'variable_decl', type: 'int', pointer: false, name: 'x', value: '5' };
    const result = explain(parsed);
    expect(result.syntax[0]).toEqual({ label: 'data type', value: 'int — a whole number' });
  });

  it('variable_decl: omits initial value row when there is none', () => {
    const parsed: ParsedLine = {
      kind: 'variable_decl',
      type: 'char',
      pointer: true,
      name: 'str',
    };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['data type', 'name']);
    expect(result.plain.length).toBeGreaterThan(0);
  });

  it('variable_decl: pointer data type row glosses the memory-address phrasing', () => {
    const parsed: ParsedLine = { kind: 'variable_decl', type: 'int', pointer: true, name: 'p' };
    const result = explain(parsed);
    expect(result.syntax[0]).toEqual({
      label: 'data type',
      value: 'pointer to int — holds the memory address of a whole number',
    });
  });

  it('assignment: describes the variable, operation and new value with human labels', () => {
    const parsed: ParsedLine = { kind: 'assignment', name: 'count', operator: '+=', value: '1' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['variable being changed', 'operation', 'new value']);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('count');
  });

  it('bit_shift: describes value, operation and amount, with a binary visual for literals', () => {
    const parsed: ParsedLine = { kind: 'bit_shift', left: '255', direction: 'left', amount: '16' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['value', 'operation', 'amount', 'binary']);
    expect(result.plain.length).toBeGreaterThan(0);
  });

  it('bit_shift: omits the binary visual when the left side is not a literal', () => {
    const parsed: ParsedLine = { kind: 'bit_shift', left: 'x', direction: 'left', amount: '3' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['value', 'operation', 'amount']);
    expect(result.plain.length).toBeGreaterThan(0);
  });

  it('bit_shift: omits the binary visual for a shift amount >= 32 (regression, found via stress.c)', () => {
    // JS's "<<" only uses the shift amount mod 32, so "1 << 32" evaluates
    // to "1 << 0" in JS — the visual would silently show before === after.
    const result = explain(parseLine('1 << 32;'));
    expect(labels(result.syntax)).toEqual(['value', 'operation', 'amount']);
    expect(result.plain).toBe(
      "Shifts 1 left by 32 positions. (Can't show the binary visual since a shift of 32 is too large to show accurately.)"
    );
  });

  describe('Phase 1 bug fixes: shift embedded in an assignment value', () => {
    it('attaches the binary visual when the shifted value is a literal', () => {
      const result = explain(parseLine('x = 1 << 3;'));
      expect(labels(result.syntax)).toContain('binary');
      expect(result.plain).toContain('before:');
      expect(result.plain).toContain('after:');
    });

    it('explains the shift in words only when the value is not a literal', () => {
      const result = explain(parseLine('x = n << 3;'));
      expect(labels(result.syntax)).not.toContain('binary');
      expect(result.plain).not.toContain('before:');
      expect(result.plain).toContain('shifted left');
    });
  });

  it('control_flow (if): includes the condition in syntax, translated to English in plain text', () => {
    const parsed: ParsedLine = { kind: 'control_flow', statement: 'if', condition: 'x == 5' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['what kind of line', 'the check']);
    expect(result.plain.length).toBeGreaterThan(0);
    // Raw operators, "whether" and semicolons must never leak into the sentence.
    expect(result.plain).not.toContain('==');
    expect(result.plain).not.toContain('whether');
    expect(result.plain).not.toContain(';');
    expect(result.plain).toContain('x equals 5');
  });

  it('control_flow (else): has no condition row', () => {
    const parsed: ParsedLine = { kind: 'control_flow', statement: 'else' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['what kind of line']);
    expect(result.plain.length).toBeGreaterThan(0);
  });

  describe('control_flow: compound conditions (Phase 2 revision)', () => {
    it('if with && enumerates two checks', () => {
      const result = explain(parseLine('if (right == 0 && down == 0)'));
      expect(labels(result.syntax)).toEqual(['what kind of line', 'check 1', 'check 2', 'how they combine']);
      expect(result.syntax[1]).toEqual({ label: 'check 1', value: 'right is 0' });
      expect(result.syntax[2]).toEqual({ label: 'check 2', value: 'down is 0' });
      expect(result.syntax[3]).toEqual({ label: 'how they combine', value: 'both must be true (&&)' });
      expect(result.plain).toBe(
        'Checks two things: right is 0, and down is 0. Both must be true for the block below to run.'
      );
    });

    it('if with || enumerates two checks', () => {
      const result = explain(parseLine('if (x == 5 || y < 0)'));
      expect(result.plain).toBe(
        'Checks two things: x is 5, or y is negative. If either one is true, the block below runs.'
      );
      expect(result.syntax[3]).toEqual({ label: 'how they combine', value: 'either can be true (||)' });
    });

    it('if with three && clauses uses "three things" and "All must be true"', () => {
      const result = explain(parseLine('if (a == 1 && b == 2 && c == 3)'));
      expect(result.plain).toBe(
        'Checks three things: a is 1, b is 2, and c is 3. All must be true for the block below to run.'
      );
    });

    it('while with && uses loop-appropriate wording', () => {
      const result = explain(parseLine('while (a == 1 && b == 2)'));
      expect(result.plain).toBe(
        'Checks two things: a is 1, and b is 2. Both must be true for the loop to keep going.'
      );
    });

    it('a single (non-compound) condition keeps the plain one-sentence form', () => {
      const result = explain(parseLine('if (x == 5)'));
      expect(labels(result.syntax)).toEqual(['what kind of line', 'the check']);
      expect(result.plain).toBe("Checks if x equals 5. If it's true, the block below runs.");
    });
  });

  it('control_flow (while): describes the loop condition in English', () => {
    const parsed: ParsedLine = { kind: 'control_flow', statement: 'while', condition: 'x < 10' };
    const result = explain(parsed);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).not.toContain('<');
    expect(result.plain).toContain('x is less than 10');
  });

  it('control_flow (for): splits setup/condition/step into English clauses', () => {
    const parsed: ParsedLine = {
      kind: 'control_flow',
      statement: 'for',
      condition: 'i = 0; i < 10; i++',
    };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['what kind of line', 'setup', 'keep-going condition', 'after each round']);
    expect(result.plain).toBe(
      'Starts i at 0, repeats the block below while i is less than 10, and adds 1 to i after each round.'
    );
  });

  it('control_flow (return): describes exiting with a value', () => {
    const parsed: ParsedLine = { kind: 'control_flow', statement: 'return', condition: '0' };
    const result = explain(parsed);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('0');
  });

  it('comment: echoes the comment text', () => {
    const parsed: ParsedLine = { kind: 'comment', text: 'initializes the fractal struct' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['comment']);
    expect(result.plain.length).toBeGreaterThan(0);
    expect(result.plain).toContain('initializes the fractal struct');
  });

  it('unknown: falls back to a safe, friendly explanation and flags isUnknown', () => {
    const parsed: ParsedLine = { kind: 'unknown', raw: 'switch (x) {' };
    const result = explain(parsed);
    expect(labels(result.syntax)).toEqual(['line']);
    expect(result.isUnknown).toBe(true);
    expect(result.plain).toBe("I can't break this line down yet — this is a preview of what the parser supports.");
  });

  describe('preprocessor', () => {
    it('include: describes a known header', () => {
      const result = explain(parseLine('#include <stdio.h>'));
      expect(result.plain).toContain('<stdio.h>');
      expect(result.plain).toContain('printf');
    });

    it('include: falls back to generic wording for an unknown header', () => {
      const result = explain(parseLine('#include "fractol.h"'));
      expect(result.plain).toContain('"fractol.h"');
    });

    it('define: describes a function-like macro', () => {
      const result = explain(parseLine('#define SQUARE(x) ((x) * (x))'));
      expect(result.plain).toContain('SQUARE');
      expect(result.plain).toContain('(x)');
    });

    it('ifndef: describes a header guard', () => {
      const result = explain(parseLine('#ifndef FRACTOL_H'));
      expect(result.plain).toContain('FRACTOL_H');
      expect(result.plain.length).toBeGreaterThan(0);
    });
  });

  describe('block_open / block_close', () => {
    it('block_open: describes a typedef struct opener', () => {
      const result = explain(parseLine('typedef struct s_point {'));
      expect(result.plain).toContain('struct');
      expect(result.plain).toContain('s_point');
    });

    it('block_open: describes an enum opener', () => {
      const result = explain(parseLine('enum e_color {'));
      expect(result.plain).toContain('enum');
      expect(result.plain).toContain('e_color');
    });

    it('block_close: names the typedef shorthand when present', () => {
      const result = explain(parseLine('} t_point;'));
      expect(result.plain).toContain('t_point');
    });
  });

  describe('incr_decr', () => {
    it('postfix increment reads as "adds 1 to"', () => {
      const result = explain(parseLine('i++;'));
      expect(result.plain).toBe('Adds 1 to i.');
    });

    it('prefix decrement reads as "subtracts 1 from"', () => {
      const result = explain(parseLine('--count;'));
      expect(result.plain).toBe('Subtracts 1 from count.');
    });
  });

  describe('arrays', () => {
    it('variable_decl: describes a fixed-size array', () => {
      const result = explain(parseLine('int arr[10];'));
      expect(result.plain).toContain('array');
      expect(result.plain).toContain('10');
      expect(result.plain).not.toContain('[10]');
    });

    it('assignment: describes indexing on the left-hand side', () => {
      const result = explain(parseLine('arr[i] = 5;'));
      expect(result.plain).not.toContain('[i]');
      expect(result.plain).toContain('arr');
      expect(result.plain).toContain('5');
    });
  });

  describe('pointer operations', () => {
    it('dereference assignment describes storing through a pointer', () => {
      const result = explain(parseLine('*ptr = 5;'));
      expect(result.plain).not.toContain('*ptr');
      expect(result.plain).toContain('ptr');
      expect(result.plain).toContain('5');
    });

    it('address-of value is translated to English', () => {
      const result = explain(parseLine('p = &x;'));
      expect(result.plain).not.toContain('&x');
      expect(result.plain).toContain('memory address of x');
    });

    it('arrow member assignment names the field and the struct pointer', () => {
      const result = explain(parseLine('f->width = 800;'));
      expect(result.plain).not.toContain('->');
      expect(result.plain).toContain('width');
      expect(result.plain).toContain('f');
      expect(result.plain).toContain('800');
    });

    it('dot member assignment names the field', () => {
      const result = explain(parseLine('p.x = 3;'));
      expect(result.plain).not.toContain('p.x');
      expect(result.plain).toContain('x');
      expect(result.plain).toContain('3');
    });
  });

  describe('casts', () => {
    it('adds a cast syntax entry and keeps the plain sentence symbol-free', () => {
      const result = explain(parseLine('int x = (int)y;'));
      expect(result.syntax.some(e => e.label === 'cast' && e.value === 'int')).toBe(true);
      expect(result.plain).not.toContain('(int)');
      expect(result.plain).toContain('y');
    });

    it('describes a pointer cast without a stray asterisk', () => {
      const result = explain(parseLine('t_data *ptr = (t_data *)malloc(sizeof(t_data));'));
      expect(result.plain).not.toContain('t_data *)');
      expect(result.plain).toContain('pointer to t_data');
    });
  });

  describe('ternary', () => {
    it('reads as an if/otherwise sentence, with the "? :" symbols only appearing inside the explanatory note', () => {
      const result = explain(parseLine('x = a > b ? a : b;'));
      const [translation, note] = result.plain.split(' (The "? :"');
      // The actual translation must stay symbol-free.
      expect(translation).not.toContain('?');
      expect(translation).not.toContain(':');
      expect(translation).toBe('Sets x to a if a is greater than b, otherwise b.');
      // The note exists specifically to define what "? :" means.
      expect(note).toContain('ternary');
    });

    it('does not add the ternary note to a non-ternary assignment', () => {
      const result = explain(parseLine('int x = y * 2;'));
      expect(result.plain).toBe('Creates an integer variable named x and sets it to y times 2.');
    });
  });

  describe('main special case', () => {
    it('explains argc/argv for the two-argument form', () => {
      const result = explain(parseLine('int main(int argc, char **argv)'));
      expect(result.plain).toContain('entry point');
      expect(result.plain).toContain('argc');
      expect(result.plain).toContain('argv');
    });

    it('explains the no-argument form without inventing argc/argv', () => {
      const result = explain(parseLine('int main(void)'));
      expect(result.plain).toContain('entry point');
      expect(result.plain).not.toContain('argc');
    });
  });

  describe('known function dictionary', () => {
    it('write: translates the file descriptor and byte count', () => {
      const result = explain(parseLine('write(1, "A", 1);'));
      expect(result.plain).toBe(
        'Writes "A" to the terminal — 1 byte of it. (The first 1 means "standard output", which is the terminal.)'
      );
    });

    it('malloc: describes heap allocation', () => {
      const result = explain(parseLine('malloc(20);'));
      expect(result.plain).toContain('20');
      expect(result.plain).toContain('heap');
    });

    it('strlen: describes counting characters', () => {
      const result = explain(parseLine('strlen(str);'));
      expect(result.plain).toContain('str');
      expect(result.plain).toContain('characters');
    });

    it('gives each argument its own labeled syntax row instead of a single "arguments" row', () => {
      const result = explain(parseLine('write(1, "A", 1);'));
      expect(labels(result.syntax)).toEqual([
        'function call',
        'where to send it',
        'what to send',
        'how many bytes',
      ]);
      // The fd row's value is annotated with its plain-English meaning.
      expect(result.syntax[1].value).toBe('1 (the terminal)');
    });

    it('unmapped functions keep the generic fallback sentence', () => {
      const result = explain(parseLine('close_window(f);'));
      expect(labels(result.syntax)).toEqual(['function call', 'arguments']);
      expect(result.plain).toBe('Calls the function "close_window" with f.');
    });
  });
});

describe('gold-standard sentences (PLAN.md quality bar)', () => {
  const cases: [string, string][] = [
    [
      'write(1, "A", 1);',
      'Writes "A" to the terminal — 1 byte of it. (The first 1 means "standard output", which is the terminal.)',
    ],
    [
      'if (x == 5)',
      "Checks if x equals 5. If it's true, the block below runs.",
    ],
    [
      'count += 1;',
      'Increases count by 1. (Same as count = count + 1.)',
    ],
    [
      'int x = y * 2;',
      'Creates an integer variable named x and sets it to y times 2.',
    ],
    [
      'return (0);',
      'Ends the function here and hands back 0. (0 usually means "everything went fine.")',
    ],
    [
      'char *str;',
      'Creates a variable named str that holds the memory address of a char — a "pointer". ' +
      "It doesn't hold text itself, it points to where text lives.",
    ],
    [
      'i++;',
      'Adds 1 to i.',
    ],
  ];

  it.each(cases)('%s', (line, expected) => {
    expect(explain(parseLine(line)).plain).toBe(expected);
  });

  it('for-loop gold sentence (tested via parseLine end-to-end)', () => {
    const result = explain(parseLine('for (i = 0; i < 10; i++)'));
    expect(result.plain).toBe(
      'Starts i at 0, repeats the block below while i is less than 10, and adds 1 to i after each round.'
    );
  });
});
