import { describe, it, expect } from 'vitest';
import { parseLine, bitShiftVisual, parseShiftLiteral } from '../src/parser/cParser';

describe('parseLine', () => {
  describe('preprocessor', () => {
    it('parses a system #include', () => {
      const result = parseLine('#include <stdio.h>');
      expect(result).toEqual({
        kind: 'preprocessor',
        directive: 'include',
        header: 'stdio.h',
        system: true,
      });
    });

    it('parses a local #include', () => {
      const result = parseLine('#include "fractol.h"');
      expect(result).toEqual({
        kind: 'preprocessor',
        directive: 'include',
        header: 'fractol.h',
        system: false,
      });
    });

    it('parses a simple #define constant', () => {
      const result = parseLine('#define WIDTH 800');
      expect(result).toEqual({
        kind: 'preprocessor',
        directive: 'define',
        name: 'WIDTH',
        params: undefined,
        value: '800',
      });
    });

    it('parses a function-like #define macro', () => {
      const result = parseLine('#define SQUARE(x) ((x) * (x))');
      expect(result).toEqual({
        kind: 'preprocessor',
        directive: 'define',
        name: 'SQUARE',
        params: ['x'],
        value: '((x) * (x))',
      });
    });

    it('parses an #ifndef header guard', () => {
      const result = parseLine('#ifndef FRACTOL_H');
      expect(result).toEqual({ kind: 'preprocessor', directive: 'ifndef', name: 'FRACTOL_H' });
    });

    it('parses an #endif', () => {
      const result = parseLine('#endif');
      expect(result).toEqual({ kind: 'preprocessor', directive: 'endif', name: undefined });
    });
  });

  describe('block_open / block_close', () => {
    it('parses a typedef struct opener', () => {
      const result = parseLine('typedef struct s_point {');
      expect(result).toEqual({ kind: 'block_open', blockType: 'struct', isTypedef: true, tag: 's_point' });
    });

    it('parses a plain struct opener', () => {
      const result = parseLine('struct s_point {');
      expect(result).toEqual({ kind: 'block_open', blockType: 'struct', isTypedef: false, tag: 's_point' });
    });

    it('parses an enum opener', () => {
      const result = parseLine('enum e_color {');
      expect(result).toEqual({ kind: 'block_open', blockType: 'enum', isTypedef: false, tag: 'e_color' });
    });

    it('parses a closer with a typedef name', () => {
      const result = parseLine('} t_point;');
      expect(result).toEqual({ kind: 'block_close', name: 't_point' });
    });

    it('parses a bare closer', () => {
      const result = parseLine('};');
      expect(result).toEqual({ kind: 'block_close', name: undefined });
    });

    it('does not treat a bare closing brace (no semicolon) as a block_close', () => {
      // Closes an if/while/for/function body, not a struct/enum declaration.
      const result = parseLine('}');
      expect(result.kind).toBe('unknown');
    });
  });

  describe('function_def', () => {
    it('parses a typical function definition with a pointer param', () => {
      const result = parseLine('int close_window(t_fractol *f)');
      expect(result).toEqual({
        kind: 'function_def',
        returnType: 'int',
        returnPointer: false,
        name: 'close_window',
        params: [{ type: 't_fractol', pointer: true, name: 'f' }],
      });
    });

    it('parses a function definition with no parameters', () => {
      const result = parseLine('int main(void)');
      expect(result).toEqual({
        kind: 'function_def',
        returnType: 'int',
        returnPointer: false,
        name: 'main',
        params: [],
      });
    });

    // Regression (found via stress.c): the return-type pointer star was
    // captured but silently discarded, so "char *get_name(void)" reported
    // its return type as plain "char".
    it('captures a pointer return type', () => {
      const result = parseLine('char *get_name(void)');
      expect(result).toEqual({
        kind: 'function_def',
        returnType: 'char',
        returnPointer: true,
        name: 'get_name',
        params: [],
      });
    });

    // Regression (found via stress.c, fixed out-of-band during the Phase 2 revision):
    // malformed params used to be accepted, so invalid C like
    // "char argv[][]" was confidently explained as a valid main.
    // parseParams now rejects bad param names and the line falls to unknown.
    it('rejects a malformed parameter list — invalid C must be unknown, not explained', () => {
      const result = parseLine('int main(int argc, char argv[][])');
      expect(result).toEqual({ kind: 'unknown', raw: 'int main(int argc, char argv[][])' });
    });

    it('still accepts valid array-style params (argv[], argv[][10])', () => {
      expect(parseLine('int main(int argc, char *argv[])')).toEqual({
        kind: 'function_def',
        returnType: 'int',
        returnPointer: false,
        name: 'main',
        params: [
          { type: 'int', pointer: false, name: 'argc' },
          { type: 'char', pointer: true, name: 'argv[]' },
        ],
      });
      expect(parseLine('int main(int argc, char argv[][10])').kind).toBe('function_def');
    });
  });

  describe('function_call', () => {
    it('parses a standalone call with one argument', () => {
      const result = parseLine('close_window(f);');
      expect(result).toEqual({
        kind: 'function_call',
        name: 'close_window',
        args: ['f'],
      });
    });

    it('parses a call with no arguments', () => {
      const result = parseLine('init();');
      expect(result).toEqual({
        kind: 'function_call',
        name: 'init',
        args: [],
      });
    });
  });

  describe('variable_decl', () => {
    it('parses a declaration with an initial value', () => {
      const result = parseLine('int x = 5;');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 'int',
        pointer: false,
        name: 'x',
        value: '5',
      });
    });

    it('parses a bare pointer declaration', () => {
      const result = parseLine('char *str;');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 'char',
        pointer: true,
        name: 'str',
        value: undefined,
      });
    });

    it('parses a fixed-size array declaration', () => {
      const result = parseLine('int arr[10];');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 'int',
        pointer: false,
        name: 'arr',
        arraySize: '10',
        value: undefined,
      });
    });

    it('parses a size-inferred array with a string initializer', () => {
      const result = parseLine('char name[] = "hi";');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 'char',
        pointer: false,
        name: 'name',
        arraySize: '',
        value: '"hi"',
      });
    });

    it('parses a cast inside a declaration initializer', () => {
      const result = parseLine('t_data *ptr = (t_data *)malloc(sizeof(t_data));');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 't_data',
        pointer: true,
        name: 'ptr',
        arraySize: undefined,
        value: '(t_data *)malloc(sizeof(t_data))',
      });
    });
  });

  describe('assignment', () => {
    it('parses a plain assignment', () => {
      const result = parseLine('x = 5;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'x',
        operator: '=',
        value: '5',
      });
    });

    it('parses a compound += assignment', () => {
      const result = parseLine('count += 1;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'count',
        operator: '+=',
        value: '1',
      });
    });

    it('parses compound shift assignment x <<= 2 as an assignment', () => {
      // Regression test for current behavior. The "=" between "<<" and the
      // amount prevents the bit_shift regex from matching, so this already
      // falls through to the assignment branch (kind "<<=").
      const result = parseLine('x <<= 2;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'x',
        operator: '<<=',
        value: '2',
      });
    });

    it('parses array indexing on the left-hand side', () => {
      const result = parseLine('arr[i] = 5;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'arr',
        operator: '=',
        value: '5',
        target: { form: 'index', index: 'i' },
      });
    });

    it('parses a pointer dereference assignment', () => {
      const result = parseLine('*ptr = 5;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'ptr',
        operator: '=',
        value: '5',
        target: { form: 'deref' },
      });
    });

    it('parses an arrow (struct pointer) member assignment', () => {
      const result = parseLine('f->width = 800;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'f',
        operator: '=',
        value: '800',
        target: { form: 'member', op: '->', field: 'width' },
      });
    });

    it('parses a dot (struct value) member assignment', () => {
      const result = parseLine('p.x = 3;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'p',
        operator: '=',
        value: '3',
        target: { form: 'member', op: '.', field: 'x' },
      });
    });

    it('parses an address-of value', () => {
      const result = parseLine('p = &x;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'p',
        operator: '=',
        value: '&x',
        target: undefined,
      });
    });

    it('parses a ternary value', () => {
      const result = parseLine('x = a > b ? a : b;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'x',
        operator: '=',
        value: 'a > b ? a : b',
        target: undefined,
      });
    });
  });

  describe('incr_decr', () => {
    it('parses postfix increment', () => {
      const result = parseLine('i++;');
      expect(result).toEqual({ kind: 'incr_decr', name: 'i', op: '++', position: 'postfix' });
    });

    it('parses prefix decrement', () => {
      const result = parseLine('--count;');
      expect(result).toEqual({ kind: 'incr_decr', name: 'count', op: '--', position: 'prefix' });
    });
  });

  describe('bit_shift', () => {
    it('parses a literal left shift expression', () => {
      const result = parseLine('255 << 16');
      expect(result).toEqual({
        kind: 'bit_shift',
        left: '255',
        direction: 'left',
        amount: '16',
      });
    });

    it('FIXED (Phase 1): a shift embedded in an assignment value is now an ' +
      'assignment, not a bit_shift — the value still carries the shift text ' +
      'so the explainer can attach the binary visual itself', () => {
      const result = parseLine('x = 1 << 3;');
      expect(result).toEqual({
        kind: 'assignment',
        name: 'x',
        operator: '=',
        value: '1 << 3',
      });
    });

    it('does not fire on a standalone shift with no assignment', () => {
      const result = parseLine('arr_len << 2;');
      expect(result).toEqual({
        kind: 'bit_shift',
        left: 'arr_len',
        direction: 'left',
        amount: '2',
      });
    });
  });

  describe('control_flow', () => {
    it('parses an if statement', () => {
      const result = parseLine('if (x == 5)');
      expect(result).toEqual({
        kind: 'control_flow',
        statement: 'if',
        condition: 'x == 5',
      });
    });

    it('parses an else block', () => {
      const result = parseLine('else');
      expect(result).toEqual({ kind: 'control_flow', statement: 'else' });
    });

    it('parses an else with opening brace', () => {
      const result = parseLine('else {');
      expect(result).toEqual({ kind: 'control_flow', statement: 'else' });
    });

    it('parses a while loop', () => {
      const result = parseLine('while (x < 10)');
      expect(result).toEqual({
        kind: 'control_flow',
        statement: 'while',
        condition: 'x < 10',
      });
    });

    it('parses a for loop', () => {
      const result = parseLine('for (i = 0; i < 10; i++)');
      expect(result).toEqual({
        kind: 'control_flow',
        statement: 'for',
        condition: 'i = 0; i < 10; i++',
      });
    });

    it('parses a return statement with a value', () => {
      const result = parseLine('return 0;');
      expect(result).toEqual({
        kind: 'control_flow',
        statement: 'return',
        condition: '0',
      });
    });

    it('parses a bare return statement', () => {
      const result = parseLine('return;');
      expect(result).toEqual({
        kind: 'control_flow',
        statement: 'return',
        condition: '',
      });
    });
  });

  describe('comment', () => {
    it('parses a single-line comment', () => {
      const result = parseLine('// initializes the fractal struct');
      expect(result).toEqual({
        kind: 'comment',
        text: 'initializes the fractal struct',
      });
    });

    it('parses a block comment line', () => {
      const result = parseLine('* multiplies two numbers');
      expect(result).toEqual({
        kind: 'comment',
        text: 'multiplies two numbers',
      });
    });
  });

  describe('unknown', () => {
    it('falls through to unknown for unsupported constructs (switch statements)', () => {
      const result = parseLine('switch (x) {');
      expect(result).toEqual({ kind: 'unknown', raw: 'switch (x) {' });
    });

    it('falls through to unknown for a blank line', () => {
      const result = parseLine('');
      expect(result).toEqual({ kind: 'unknown', raw: '' });
    });
  });

  // Regressions found via test/fixtures/stress.c: each of these used to
  // produce a confident but WRONG explanation (a TRAP, worse than unknown)
  // rather than correctly falling through. See KNOWN_GAPS.md.
  describe('stress.c fixes: previously-wrong parses now correctly fall to unknown', () => {
    it('"switch (argc)" (no trailing brace) no longer misparses as a call to a function named "switch"', () => {
      const result = parseLine('switch (argc)');
      expect(result).toEqual({ kind: 'unknown', raw: 'switch (argc)' });
    });

    it('a bare comparison used as a statement no longer misparses as an assignment', () => {
      const result = parseLine('i == 5;');
      expect(result).toEqual({ kind: 'unknown', raw: 'i == 5;' });
    });

    it('combined shifts ("1 << 8 | 1 << 16") no longer merge into one garbled bit_shift', () => {
      const result = parseLine('1 << 8 | 1 << 16;');
      expect(result).toEqual({ kind: 'unknown', raw: '1 << 8 | 1 << 16;' });
    });

    it('a 2D array declaration no longer captures a garbled array size ("2][2")', () => {
      const result = parseLine('int grid[2][2];');
      expect(result).toEqual({ kind: 'unknown', raw: 'int grid[2][2];' });
    });

    it('a 2D array index assignment no longer captures a garbled index ("1][1")', () => {
      const result = parseLine('grid[1][1] = 3;');
      expect(result).toEqual({ kind: 'unknown', raw: 'grid[1][1] = 3;' });
    });

    it('a trailing "// comment" no longer gets swallowed into the assignment value', () => {
      const result = parseLine('i = 7; // this whole comment becomes part of the value');
      expect(result).toEqual({ kind: 'assignment', name: 'i', operator: '=', value: '7', target: undefined });
    });

    it('a trailing comment is stripped without touching "//" inside a string literal', () => {
      const result = parseLine('char *url = "http://example.com"; // the site');
      expect(result).toEqual({
        kind: 'variable_decl',
        type: 'char',
        pointer: true,
        name: 'url',
        arraySize: undefined,
        value: '"http://example.com"',
      });
    });

    it('a single valid shift still works (guarding combined shifts did not over-reject)', () => {
      expect(parseLine('255 << 16')).toEqual({ kind: 'bit_shift', left: '255', direction: 'left', amount: '16' });
    });

    it('valid array-index and 1D-array declarations still work (guarding 2D arrays did not over-reject)', () => {
      expect(parseLine('int arr[10];')).toEqual({
        kind: 'variable_decl', type: 'int', pointer: false, name: 'arr', arraySize: '10', value: undefined,
      });
      expect(parseLine('arr[0] = 5;')).toEqual({
        kind: 'assignment', name: 'arr', operator: '=', value: '5', target: { form: 'index', index: '0' },
      });
    });

    it('a real "==" condition inside if/while still works (guarding the assignment regex did not over-reject)', () => {
      expect(parseLine('if (x == 5)')).toEqual({ kind: 'control_flow', statement: 'if', condition: 'x == 5' });
    });

    it('a comma inside a string literal argument no longer splits printf args at the wrong places', () => {
      const result = parseLine('printf("point: %d,%d\\n", pt.x, pp->y);');
      expect(result).toEqual({
        kind: 'function_call',
        name: 'printf',
        args: ['"point: %d,%d\\n"', 'pt.x', 'pp->y'],
      });
    });

    it('a normal (no-string-literal) call still splits args correctly', () => {
      expect(parseLine('write(1, "A", 1);')).toEqual({
        kind: 'function_call',
        name: 'write',
        args: ['1', '"A"', '1'],
      });
    });
  });
});

describe('parseShiftLiteral', () => {
  it('parses a decimal literal', () => {
    expect(parseShiftLiteral('255')).toBe(255);
  });

  it('parses a hex literal', () => {
    expect(parseShiftLiteral('0xFF')).toBe(255);
  });

  it('returns null for a variable name (not a literal)', () => {
    expect(parseShiftLiteral('arr_len')).toBeNull();
  });

  it('returns null for a partially-numeric string', () => {
    expect(parseShiftLiteral('12abc')).toBeNull();
  });
});

describe('bitShiftVisual', () => {
  it('renders 8-bit-grouped binary before/after for a left shift', () => {
    const visual = bitShiftVisual(1, 'left', 3);
    expect(visual).toBe(
      'before: 00000000 00000000 00000000 00000001\n' +
      'after:  00000000 00000000 00000000 00001000'
    );
  });

  it('renders binary before/after for a right shift', () => {
    const visual = bitShiftVisual(16, 'right', 2);
    expect(visual).toBe(
      'before: 00000000 00000000 00000000 00010000\n' +
      'after:  00000000 00000000 00000000 00000100'
    );
  });
});
