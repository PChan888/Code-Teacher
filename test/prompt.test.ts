import { describe, it, expect } from 'vitest';
import { findEnclosingFunctionText, buildDeeperDivePrompt } from '../src/ai/prompt';

describe('findEnclosingFunctionText', () => {
  it('finds the function body from the cursor line down to the matching closing brace', () => {
    const lines = [
      'int add(int a, int b)',
      '{',
      '\tint result = a + b;',
      '\treturn result;',
      '}',
    ];
    const text = findEnclosingFunctionText(lines, 2); // cursor on "int result = ..."
    expect(text).toBe(lines.join('\n'));
  });

  it('works with a same-line opening brace', () => {
    const lines = [
      'int add(int a, int b) {',
      '\treturn a + b;',
      '}',
    ];
    expect(findEnclosingFunctionText(lines, 1)).toBe(lines.join('\n'));
  });

  it('returns null when there is no function_def above the cursor', () => {
    const lines = ['int x = 5;', 'int y = 10;'];
    expect(findEnclosingFunctionText(lines, 1)).toBeNull();
  });

  it('finds the nearest enclosing function, not an earlier one, for nested top-level functions', () => {
    const lines = [
      'int first(void)',
      '{',
      '\treturn 1;',
      '}',
      '',
      'int second(void)',
      '{',
      '\treturn 2;',
      '}',
    ];
    const text = findEnclosingFunctionText(lines, 7); // cursor on "return 2;"
    expect(text).toBe(lines.slice(5).join('\n'));
  });

  it('best-effort: stops at the first line where brace depth returns to zero, even without a real C parser', () => {
    const lines = [
      'int f(void)',
      '{',
      '\tint x = 1;',
      '}',
      'int unrelated_after = 99;',
    ];
    const text = findEnclosingFunctionText(lines, 2);
    expect(text).toBe(lines.slice(0, 4).join('\n'));
    expect(text).not.toContain('unrelated_after');
  });

  it('falls through to the last line if the closing brace is never found (malformed/truncated input)', () => {
    const lines = ['int f(void)', '{', '\tint x = 1;'];
    expect(findEnclosingFunctionText(lines, 2)).toBe(lines.join('\n'));
  });
});

describe('buildDeeperDivePrompt', () => {
  it('includes the current line, the function context, the rule-based explanation, and the instruction', () => {
    const prompt = buildDeeperDivePrompt(
      '\tint result = a + b;',
      'int add(int a, int b)\n{\n\tint result = a + b;\n\treturn result;\n}',
      'Creates an integer variable named result and sets it to a plus b.'
    );
    expect(prompt).toContain('int result = a + b;');
    expect(prompt).toContain('int add(int a, int b)');
    expect(prompt).toContain('Creates an integer variable named result and sets it to a plus b.');
    expect(prompt).toContain('WHY this line exists in this function');
    expect(prompt).toContain('Do not repeat the syntax breakdown');
  });

  it('omits the function-context block entirely when no enclosing function was found', () => {
    const prompt = buildDeeperDivePrompt('int x = 5;', null, 'Creates an integer variable named x and sets it to 5.');
    expect(prompt).not.toContain('Here is the function this line belongs to');
    expect(prompt).toContain('int x = 5;');
  });
});
