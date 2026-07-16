/**
 * Builds Syntax Breakdown rows (with doc-link HTML baked in) from an
 * Explanation. Pure — no VS Code API — so the dedup behavior below is
 * actually unit-testable, unlike the rest of ExplainerPanel.ts.
 */

import { Explanation } from '../explainer/explainer';
import { ParsedLine } from '../parser/cParser';
import { getDocsLink, getEmbeddedDocsLinks, DocsProvider } from '../docs/docsLinks';
import { escapeHtml, renderBitVisual, wrapLinkedTerm, wrapLinkedTerms } from './highlight';

export interface RenderedRow {
  label: string;
  valueHtml: string;
}

/**
 * A term (e.g. "int", "t_point") only gets link styling the first time it
 * shows up anywhere in the line's rows — "int main(int argc, ...)" would
 * otherwise link "int" in both the return type row and parameter 1's row,
 * which reads as noisy repetition rather than useful signal. `linkedTerms`
 * is fresh per call (per rendered line), never persisted across lines.
 */
export function buildRenderedRows(explanation: Explanation, parsed: ParsedLine, provider: DocsProvider): RenderedRow[] {
  const linkedTerms = new Set<string>();

  return explanation.syntax.map(e => {
    if (e.label === 'binary') return { label: e.label, valueHtml: renderBitVisual(e.value) };

    const link = getDocsLink(e, parsed, provider);
    if (link) {
      if (linkedTerms.has(link.term)) return { label: e.label, valueHtml: escapeHtml(e.value) };
      linkedTerms.add(link.term);
      return { label: e.label, valueHtml: wrapLinkedTerm(e.value, link.term, link.url) };
    }

    // No single whole-row topic (e.g. a "new value"/"initial value" row
    // holding an arbitrary expression) — check for known function calls or
    // sizeof/struct/enum/typedef/custom-type names embedded anywhere inside
    // it instead, e.g. "malloc(sizeof(t_point))" has both `malloc` and
    // `sizeof` clickable.
    const embedded = getEmbeddedDocsLinks(e.value, provider).filter(l => !linkedTerms.has(l.term));
    embedded.forEach(l => linkedTerms.add(l.term));
    const valueHtml = embedded.length > 0 ? wrapLinkedTerms(e.value, embedded) : escapeHtml(e.value);
    return { label: e.label, valueHtml };
  });
}
