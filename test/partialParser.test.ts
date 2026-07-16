import { describe, it, expect } from 'vitest';
import { parsePartial } from '../src/parser/partialParser';
import { parseLine } from '../src/parser/cParser';

function labels(entries: { label: string }[]): string[] {
  return entries.map(e => e.label);
}

describe('parsePartial', () => {
  describe('required null cases', () => {
    it('returns null for an empty line', () => {
      expect(parsePartial('')).toBeNull();
    });

    it('returns null for a complete line', () => {
      expect(parsePartial('int x = 5;')).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(parsePartial('@@#!')).toBeNull();
    });
  });

  describe('type name then identifier then "=" with nothing after', () => {
    it('matches the gold example exactly', () => {
      const result = parsePartial('int x =');
      expect(result).toEqual({
        intent: "You're creating an integer variable named x.",
        soFar: [
          { label: 'data type', value: 'int' },
          { label: 'name', value: 'x' },
        ],
        hint: 'Now give it a starting value.',
      });
    });

    it('tolerates trailing whitespace while typing', () => {
      const result = parsePartial('int x = ');
      expect(result?.hint).toBe('Now give it a starting value.');
    });
  });

  describe('type name then identifier', () => {
    it('matches the gold example exactly', () => {
      const result = parsePartial('int x');
      expect(result).toEqual({
        intent: "You're creating an integer variable named x.",
        soFar: [
          { label: 'data type', value: 'int' },
          { label: 'name', value: 'x' },
        ],
      });
    });
  });

  describe('type name alone', () => {
    it('matches the gold example exactly, with the type gloss', () => {
      const result = parsePartial('int');
      expect(result).toEqual({
        intent: "You're starting to create something with data type int — a whole number.",
        soFar: [{ label: 'data type', value: 'int — a whole number' }],
      });
    });

    it('recognizes a 42-school custom type prefix', () => {
      const result = parsePartial('t_point');
      expect(result?.intent).toContain('t_point');
    });
  });

  describe('control keyword with unclosed paren', () => {
    it('"if (x ==" matches the gold example exactly', () => {
      const result = parsePartial('if (x ==');
      expect(result).toEqual({
        intent: "You're starting an if check — comparing x to something.",
        soFar: [
          { label: 'what kind of line', value: 'if statement' },
          { label: 'comparing', value: 'x' },
        ],
      });
    });

    it('"while (" matches the gold example exactly', () => {
      const result = parsePartial('while (');
      expect(result).toEqual({
        intent: "You're starting a while loop. It needs a condition that decides whether to keep going.",
        soFar: [{ label: 'what kind of line', value: 'while statement' }],
      });
    });

    it('"for (" gets a reasonable in-progress explanation', () => {
      const result = parsePartial('for (');
      expect(result?.intent).toContain('for loop');
      expect(labels(result!.soFar)).toEqual(['what kind of line']);
    });

    it('does not match once the paren is closed (that is a complete construct, not partial)', () => {
      expect(parsePartial('if (x == 5)')).toBeNull();
    });
  });

  describe('known function with unclosed paren', () => {
    it('"printf(" uses the knownFunctions summary and lists parameters in soFar', () => {
      const result = parsePartial('printf(');
      expect(result?.intent).toBe("You're calling printf, which prints formatted text to the terminal.");
      expect(result?.soFar).toEqual([
        { label: 'function', value: 'printf' },
        { label: 'parameter 1', value: 'format string' },
      ]);
    });

    it('"write(" lists all of write\'s parameters', () => {
      const result = parsePartial('write(');
      expect(labels(result!.soFar)).toEqual(['function', 'parameter 1', 'parameter 2', 'parameter 3']);
    });
  });

  describe('unknown identifier with unclosed paren', () => {
    it('matches the gold example exactly — no summary for a user-defined function', () => {
      const result = parsePartial('foo(');
      expect(result).toEqual({
        intent: "You're calling a function named foo.",
        soFar: [{ label: 'function', value: 'foo' }],
      });
    });
  });

  describe('reserved keywords are never treated as function calls', () => {
    it('"return (" does not claim to be calling a function named return', () => {
      expect(parsePartial('return (')).toBeNull();
    });
  });

  describe('character-by-character typing progression', () => {
    it('produces a sensible progression for "int x = 5;", ending with parseLine taking over once complete', () => {
      const steps: [string, boolean][] = [
        ['i', false],
        ['int', true],
        ['int x', true],
        ['int x =', true],
        ['int x = 5', false],
        ['int x = 5;', false],
      ];
      for (const [prefix, expectPartial] of steps) {
        const result = parsePartial(prefix);
        if (expectPartial) {
          expect(result, `expected a partial result for ${JSON.stringify(prefix)}`).not.toBeNull();
        }
      }
      // Once the line is syntactically complete, parseLine itself takes over
      // and parsePartial is no longer consulted (see extension.ts) — confirm
      // the handoff point actually produces a real ParsedLine.
      expect(parseLine('int x = 5;').kind).toBe('variable_decl');
    });
  });
});
