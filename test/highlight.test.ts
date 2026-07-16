import { describe, it, expect } from 'vitest';
import { escapeHtml, highlightLine, renderBitVisual, wrapLinkedTerm, wrapLinkedTerms } from '../src/panel/highlight';
import { bitShiftVisual } from '../src/parser/cParser';

describe('escapeHtml', () => {
  it('escapes <, >, & and "', () => {
    expect(escapeHtml('<a> & "b"')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });
});

describe('highlightLine', () => {
  it('tags a type, identifier, operator, number and trailing comment', () => {
    const html = highlightLine('int x = 5; // set x');
    expect(html).toContain('<span class="tok-type">int</span>');
    expect(html).toContain('<span class="tok-identifier">x</span>');
    expect(html).toContain('<span class="tok-number">5</span>');
    expect(html).toContain('<span class="tok-comment">// set x</span>');
  });

  it('tags a preprocessor directive', () => {
    const html = highlightLine('#include <stdio.h>');
    expect(html).toContain('<span class="tok-preprocessor">#include</span>');
  });

  it('tags a control-flow keyword', () => {
    const html = highlightLine('if (x == 5)');
    expect(html).toContain('<span class="tok-keyword">if</span>');
  });

  it('tags a string literal', () => {
    const html = highlightLine('printf("hi");');
    expect(html).toContain('<span class="tok-string">&quot;hi&quot;</span>');
  });

  it('escapes HTML-significant characters inside tokens', () => {
    const html = highlightLine('if (x < 5)');
    expect(html).not.toContain('<5');
    expect(html).toContain('&lt;');
  });

  it('never drops characters — output text content matches the input line', () => {
    const line = 'x = (a > b) ? a : b;';
    const html = highlightLine(line);
    const textOnly = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    expect(textOnly).toBe(line);
  });
});

describe('renderBitVisual', () => {
  it('highlights only the bit positions that actually changed', () => {
    const raw = bitShiftVisual(1, 'left', 3);
    const html = renderBitVisual(raw);
    // 00000001 -> 00001000: the 1 moves from the last bit to the 4th-from-last.
    expect(html).toContain('<span class="bit-changed">1</span>');
    expect(html).toContain('<span class="bit-changed">0</span>');
    // Unchanged leading zero groups must not be wrapped.
    expect(html).toContain('before: 00000000 00000000 00000000 00000001');
  });

  it('falls back to escaped raw text for an unrecognized shape', () => {
    expect(renderBitVisual('not a before/after string')).toBe('not a before/after string');
  });
});

describe('wrapLinkedTerm', () => {
  it('wraps only the leading type word, leaving the gloss description plain (regression: whole phrase was blue)', () => {
    const html = wrapLinkedTerm('int — a whole number', 'int', 'https://en.cppreference.com/c/language/arithmetic_types');
    expect(html).toBe(
      '<span class="doc-link" data-url="https://en.cppreference.com/c/language/arithmetic_types">int</span> — a whole number'
    );
  });

  it('wraps the type after a "pointer to" prefix, not the whole pointer gloss', () => {
    const html = wrapLinkedTerm(
      'pointer to char — holds the memory address of a single character (one letter, digit, or symbol), named argv',
      'char',
      'https://en.cppreference.com/c/language/arithmetic_types'
    );
    expect(html).toBe(
      'pointer to <span class="doc-link" data-url="https://en.cppreference.com/c/language/arithmetic_types">char</span>' +
      ' — holds the memory address of a single character (one letter, digit, or symbol), named argv'
    );
  });

  it('does not match the term as a substring of a longer word (e.g. "char" inside "character")', () => {
    const html = wrapLinkedTerm('a single character value', 'char', 'https://example.com');
    // No standalone "char" exists here ("character" doesn't count as a whole-word
    // match), so this hits the same "term not found" fallback as the test below:
    // the whole value gets wrapped rather than an accidental partial-word match.
    expect(html).toBe('<span class="doc-link" data-url="https://example.com">a single character value</span>');
  });

  it('falls back to wrapping the whole value when the term cannot be located as a standalone word', () => {
    const html = wrapLinkedTerm('something else entirely', 'int', 'https://example.com');
    expect(html).toBe('<span class="doc-link" data-url="https://example.com">something else entirely</span>');
  });

  it('escapes HTML-significant characters in both the linked term and the surrounding text', () => {
    const html = wrapLinkedTerm('int<x> — a whole number', 'int', 'https://example.com');
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('<x>');
  });
});

describe('wrapLinkedTerms', () => {
  it('wraps multiple independent terms, each with its own URL, in their order of appearance', () => {
    const html = wrapLinkedTerms('(t_point *)malloc(sizeof(t_point))', [
      { term: 'sizeof', url: 'https://en.cppreference.com/c/language/sizeof' },
      { term: 'malloc', url: 'https://en.cppreference.com/c/memory/malloc' },
    ]);
    // malloc appears before sizeof in the text, regardless of input array order.
    expect(html).toBe(
      '(t_point *)<span class="doc-link" data-url="https://en.cppreference.com/c/memory/malloc">malloc</span>' +
      '(<span class="doc-link" data-url="https://en.cppreference.com/c/language/sizeof">sizeof</span>(t_point))'
    );
  });

  it('returns plain escaped text (no wrapping) when none of the terms are found — no forced fallback', () => {
    const html = wrapLinkedTerms('5', [{ term: 'malloc', url: 'https://example.com' }]);
    expect(html).toBe('5');
  });

  it('skips terms that are not found while still wrapping the ones that are', () => {
    const html = wrapLinkedTerms('malloc(10)', [
      { term: 'malloc', url: 'https://example.com/malloc' },
      { term: 'sizeof', url: 'https://example.com/sizeof' },
    ]);
    expect(html).toBe('<span class="doc-link" data-url="https://example.com/malloc">malloc</span>(10)');
  });
});
