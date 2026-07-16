/**
 * Builds the prompt sent to Ollama for a "Deeper Dive" explanation.
 * Pure — no VS Code API, no network — so it's unit-testable on its own.
 */

import { parseLine } from '../parser/cParser';

/**
 * Finds the enclosing function's source text: scans upward from `cursorLine`
 * for the nearest `function_def` line, then downward from there for the
 * matching closing brace via best-effort brace counting (a line-by-line
 * scan, not a real parser — doesn't account for braces inside strings or
 * comments, matching this codebase's regex-based philosophy). Returns null
 * if no enclosing `function_def` is found above the cursor.
 */
export function findEnclosingFunctionText(lines: string[], cursorLine: number): string | null {
  let startLine = -1;
  for (let i = cursorLine; i >= 0; i--) {
    if (parseLine(lines[i]).kind === 'function_def') {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;

  let depth = 0;
  let sawOpenBrace = false;
  let endLine = lines.length - 1;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; sawOpenBrace = true; }
      else if (ch === '}') depth--;
    }
    if (sawOpenBrace && depth <= 0) {
      endLine = i;
      break;
    }
  }
  return lines.slice(startLine, endLine + 1).join('\n');
}

/**
 * Assembles the one-shot prompt: the current line, the enclosing function's
 * text (if found), and the rule-based explanation already shown in the
 * panel, with an explicit instruction not to repeat that breakdown.
 */
export function buildDeeperDivePrompt(currentLine: string, functionText: string | null, ruleBasedExplanation: string): string {
  const functionContext = functionText
    ? `Here is the function this line belongs to:\n\`\`\`c\n${functionText}\n\`\`\`\n\n`
    : '';
  return (
    `${functionContext}` +
    `The current line is:\n\`\`\`c\n${currentLine.trim()}\n\`\`\`\n\n` +
    `A rule-based tool already explained the syntax as: "${ruleBasedExplanation}"\n\n` +
    `In 2-3 sentences and plain English, explain WHY this line exists in this function. Do not repeat the syntax breakdown.\n\n` +
    `You are explaining to a beginner who has never programmed before. Follow the same style as the explanation above: plain English, no jargon without immediately defining it, never condescending. Only go deeper into the "why" — do not restate what the line does.`
  );
}
