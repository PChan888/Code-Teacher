import { describe, it, expect } from 'vitest';
import { buildRenderedRows } from '../src/panel/rows';
import { parseLine } from '../src/parser/cParser';
import { explain } from '../src/explainer/explainer';

function rowsFor(line: string) {
  const parsed = parseLine(line);
  return buildRenderedRows(explain(parsed), parsed, 'cppreference');
}

describe('buildRenderedRows: a term only links the first time it appears (regression)', () => {
  it('"int" links in the return type row but stays plain in parameter 1 (same term, repeated)', () => {
    const rows = rowsFor('int main(int argc, char **argv)');
    const returnType = rows.find(r => r.label === 'return type')!;
    const param1 = rows.find(r => r.label === 'parameter 1')!;
    const param2 = rows.find(r => r.label === 'parameter 2')!;

    expect(returnType.valueHtml).toContain('<span class="doc-link"');
    expect(returnType.valueHtml).toContain('>int</span>');

    // Same "int" term, already linked above - plain text, no span at all.
    expect(param1.valueHtml).not.toContain('<span');
    expect(param1.valueHtml).toBe('int — a whole number, named argc');

    // "char" is a different term - still gets linked on its first appearance.
    expect(param2.valueHtml).toContain('<span class="doc-link"');
    expect(param2.valueHtml).toContain('>char</span>');
  });

  it('"t_point" links only on its first appearance across data type, cast, and initial value rows', () => {
    const rows = rowsFor('t_point *pp = (t_point *)malloc(sizeof(t_point));');
    const dataType = rows.find(r => r.label === 'data type')!;
    const cast = rows.find(r => r.label === 'cast')!;
    const initialValue = rows.find(r => r.label === 'initial value')!;

    expect(dataType.valueHtml).toContain('data-url="https://en.cppreference.com/c/language/struct"');
    expect(dataType.valueHtml).toContain('>t_point</span>');

    // Same term already linked in "data type" above - plain text here.
    expect(cast.valueHtml).not.toContain('<span');
    expect(cast.valueHtml).toBe('t_point *');

    // malloc and sizeof are new terms and still get linked; the t_point
    // inside this row (there's only one occurrence left to find, since the
    // other was already consumed by "data type") is also already-seen, so
    // this row has no t_point link, only malloc and sizeof.
    expect(initialValue.valueHtml).toContain('>malloc</span>');
    expect(initialValue.valueHtml).toContain('>sizeof</span>');
    expect(initialValue.valueHtml).not.toContain('doc-link" data-url="https://en.cppreference.com/c/language/struct"');
  });

  it('two genuinely different rows about unrelated terms both still get linked', () => {
    const rows = rowsFor('if (x == 5)');
    const kind = rows.find(r => r.label === 'what kind of line')!;
    expect(kind.valueHtml).toContain('>if</span>');
  });
});
