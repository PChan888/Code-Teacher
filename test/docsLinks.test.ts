import { describe, it, expect } from 'vitest';
import { getDocsUrl, getDocsLink, getEmbeddedDocsLinks } from '../src/docs/docsLinks';
import { parseLine, ParsedLine } from '../src/parser/cParser';
import { explain, SyntaxEntry } from '../src/explainer/explainer';
import { wrapLinkedTerms } from '../src/panel/highlight';

function entryFor(parsed: ParsedLine, label: string): SyntaxEntry {
  const entry = explain(parsed).syntax.find(e => e.label === label);
  if (!entry) throw new Error(`no syntax entry with label ${JSON.stringify(label)}`);
  return entry;
}

describe('getDocsUrl', () => {
  it('clicking "printf" opens its cppreference page (acceptance criterion)', () => {
    const parsed = parseLine('printf("hi");');
    const entry = entryFor(parsed, 'function call');
    expect(entry.value).toBe('printf');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/io/fprintf');
  });

  it('user-defined function names are not clickable (acceptance criterion)', () => {
    const parsed = parseLine('close_window(f);');
    const entry = entryFor(parsed, 'function call');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBeUndefined();
  });

  it('changing the provider switches the URL for the same entry (acceptance criterion)', () => {
    const parsed = parseLine('printf("hi");');
    const entry = entryFor(parsed, 'function call');
    const cpp = getDocsUrl(entry, parsed, 'cppreference');
    const gfg = getDocsUrl(entry, parsed, 'geeksforgeeks');
    expect(cpp).toContain('cppreference.com');
    expect(gfg).toContain('geeksforgeeks.org');
    expect(cpp).not.toBe(gfg);
  });

  it('a recognized-but-unmapped known function (POSIX write) falls back to a cppreference search, not a broken guess', () => {
    const parsed = parseLine('write(1, "A", 1);');
    const entry = entryFor(parsed, 'function call');
    const url = getDocsUrl(entry, parsed, 'cppreference');
    expect(url).toBe('https://en.cppreference.com/mwiki/index.php?search=write');
  });

  it('function call arguments are never clickable, only the function name row', () => {
    const parsed = parseLine('printf("hi");');
    const entry = entryFor(parsed, 'format string');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBeUndefined();
  });

  it('a built-in type in a variable_decl links to the arithmetic types page', () => {
    const parsed = parseLine('int x = 5;');
    const entry = entryFor(parsed, 'data type');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/arithmetic_types');
  });

  it('a custom 42-school type (t_*) is not itself documented anywhere, but links to the general struct concept', () => {
    // t_point the *name* has no page (it's user-defined), but t_/s_ always
    // means "a typedef'd struct" by the same naming convention C_TYPES
    // already relies on for parsing — so it links to what a struct *is*.
    const parsed = parseLine('t_point pt;');
    const entry = entryFor(parsed, 'data type');
    expect(entry.value).toContain('t_point');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/struct');
  });

  it('a custom enum type (e_*) links to the enum concept, not struct', () => {
    const parsed = parseLine('e_color c;');
    const entry = entryFor(parsed, 'data type');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/enum');
  });

  it('a pointer type strips "pointer to" and still resolves the base type', () => {
    const parsed = parseLine('char *str;');
    const entry = entryFor(parsed, 'data type');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/arithmetic_types');
  });

  it('a cast type resolves the same as a declared type', () => {
    const parsed = parseLine('int x = (int)y;');
    const entry = entryFor(parsed, 'cast');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/arithmetic_types');
  });

  it('the "if" keyword links to its language reference page', () => {
    const parsed = parseLine('if (x == 5)');
    const entry = entryFor(parsed, 'what kind of line');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/if');
  });

  it('an assignment operator links to the assignment operators page', () => {
    const parsed = parseLine('count += 1;');
    const entry = entryFor(parsed, 'operation');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/operator_assignment');
  });

  it('increment/decrement links to the incdec operators page', () => {
    const parsed = parseLine('i++;');
    const entry = entryFor(parsed, 'operation');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBe('https://en.cppreference.com/c/language/operator_incdec');
  });

  it('variable and field names are never clickable', () => {
    const parsed = parseLine('int x = 5;');
    const nameEntry = entryFor(parsed, 'name');
    expect(getDocsUrl(nameEntry, parsed, 'cppreference')).toBeUndefined();
  });

  it('the raw bit-shift visual row is never clickable', () => {
    const parsed = parseLine('255 << 16');
    const entry = entryFor(parsed, 'binary');
    expect(getDocsUrl(entry, parsed, 'cppreference')).toBeUndefined();
  });
});

describe('getDocsLink term (regression: only the type keyword should be highlighted, not the whole gloss)', () => {
  it('a plain type row: term is just "int", not the whole gloss', () => {
    const parsed = parseLine('int x = 5;');
    const entry = entryFor(parsed, 'data type');
    expect(entry.value).toBe('int — a whole number');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('int');
  });

  it('a pointer type row: term is just "char", not "pointer to char — holds..."', () => {
    const parsed = parseLine('char *str;');
    const entry = entryFor(parsed, 'data type');
    expect(entry.value).toContain('pointer to char — holds the memory address');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('char');
  });

  it('a function_def parameter row: term is just the type, not ", named argc" too', () => {
    const parsed = parseLine('int main(int argc, char **argv)');
    const entry = entryFor(parsed, 'parameter 1');
    expect(entry.value).toBe('int — a whole number, named argc');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('int');
  });

  it('increment operation: term is "increment", not "increment (+1)"', () => {
    const parsed = parseLine('i++;');
    const entry = entryFor(parsed, 'operation');
    expect(entry.value).toBe('increment (+1)');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('increment');
  });

  it('decrement operation: term is "decrement", not "decrement (-1)"', () => {
    const parsed = parseLine('--count;');
    const entry = entryFor(parsed, 'operation');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('decrement');
  });

  it('a short symbol operator (e.g. "+=") is highlighted whole, since there is no extra description to over-select', () => {
    const parsed = parseLine('count += 1;');
    const entry = entryFor(parsed, 'operation');
    expect(getDocsLink(entry, parsed, 'cppreference')?.term).toBe('+=');
  });
});

describe('getEmbeddedDocsLinks (regression: malloc/sizeof inside an initializer had no links at all)', () => {
  it('finds malloc, sizeof, and the custom struct type inside a cast + call initializer', () => {
    // t_point is linked here too (to the general struct concept, not a page
    // "about" t_point) — the name itself is never documented anywhere, but
    // struct/enum-ness is inferred from the same naming convention the
    // parser already relies on, so it's linkable wherever it appears.
    const value = '(t_point *)malloc(sizeof(t_point))';
    const links = getEmbeddedDocsLinks(value, 'cppreference');
    const terms = links.map(l => l.term).sort();
    expect(terms).toEqual(['malloc', 'sizeof', 't_point']);
    expect(links.find(l => l.term === 'malloc')?.url).toBe('https://en.cppreference.com/c/memory/malloc');
    expect(links.find(l => l.term === 'sizeof')?.url).toBe('https://en.cppreference.com/c/language/sizeof');
    expect(links.find(l => l.term === 't_point')?.url).toBe('https://en.cppreference.com/c/language/struct');
  });

  it('the full "initial value" row for this line renders malloc, sizeof, and t_point (struct concept) as clickable', () => {
    const parsed = parseLine('t_point *pp = (t_point *)malloc(sizeof(t_point));');
    const entry = entryFor(parsed, 'initial value');
    expect(entry.value).toBe('(t_point *)malloc(sizeof(t_point))');
    const links = getEmbeddedDocsLinks(entry.value, 'cppreference');
    const html = wrapLinkedTerms(entry.value, links);
    expect(html).toBe(
      '(<span class="doc-link" data-url="https://en.cppreference.com/c/language/struct">t_point</span> *)' +
      '<span class="doc-link" data-url="https://en.cppreference.com/c/memory/malloc">malloc</span>' +
      '(<span class="doc-link" data-url="https://en.cppreference.com/c/language/sizeof">sizeof</span>(t_point))'
    );
  });

  it('an unrecognized (user-defined) function call inside an expression is not linked', () => {
    const links = getEmbeddedDocsLinks('helper_function(x) + 1', 'cppreference');
    expect(links).toEqual([]);
  });

  it('a plain value with nothing embedded returns no links', () => {
    expect(getEmbeddedDocsLinks('5', 'cppreference')).toEqual([]);
    expect(getEmbeddedDocsLinks('y * 2', 'cppreference')).toEqual([]);
  });

  it('a POSIX function recognized by knownFunctions but not cppreference-mapped still gets an embedded link via search fallback', () => {
    const links = getEmbeddedDocsLinks('write(1, buf, n)', 'cppreference');
    expect(links).toEqual([{ term: 'write', url: 'https://en.cppreference.com/mwiki/index.php?search=write' }]);
  });
});

describe('block_open/block_close: the actual struct/enum declaration line is linkable too', () => {
  it('a typedef struct opener links both "typedef" and "struct" independently', () => {
    const parsed = parseLine('typedef struct s_point');
    const entry = entryFor(parsed, 'kind');
    expect(entry.value).toBe('typedef struct');
    const links = getEmbeddedDocsLinks(entry.value, 'cppreference');
    const terms = links.map(l => l.term).sort();
    expect(terms).toEqual(['struct', 'typedef']);
    expect(links.find(l => l.term === 'typedef')?.url).toBe('https://en.cppreference.com/c/language/typedef');
    expect(links.find(l => l.term === 'struct')?.url).toBe('https://en.cppreference.com/c/language/struct');
  });

  it('an enum opener links "enum"', () => {
    const parsed = parseLine('enum e_color');
    const entry = entryFor(parsed, 'kind');
    const links = getEmbeddedDocsLinks(entry.value, 'cppreference');
    expect(links).toEqual([{ term: 'enum', url: 'https://en.cppreference.com/c/language/enum' }]);
  });

  it('the tag row (e.g. "s_point") also links to the struct concept, same rule as any other t_*/s_* name', () => {
    const parsed = parseLine('typedef struct s_point');
    const entry = entryFor(parsed, 'tag');
    expect(entry.value).toBe('s_point');
    expect(getEmbeddedDocsLinks(entry.value, 'cppreference')).toEqual([
      { term: 's_point', url: 'https://en.cppreference.com/c/language/struct' },
    ]);
  });

  it('a bare closer\'s "(none)" placeholder does not accidentally trigger a struct/enum link', () => {
    const parsed = parseLine('};');
    const entry = entryFor(parsed, 'closes');
    expect(entry.value).toBe('(none)');
    expect(getEmbeddedDocsLinks(entry.value, 'cppreference')).toEqual([]);
  });

  it('a closer with a typedef name links the name to the struct concept', () => {
    const parsed = parseLine('} t_point;');
    const entry = entryFor(parsed, 'closes');
    expect(entry.value).toBe('t_point');
    const links = getEmbeddedDocsLinks(entry.value, 'cppreference');
    expect(links).toEqual([{ term: 't_point', url: 'https://en.cppreference.com/c/language/struct' }]);
  });
});
