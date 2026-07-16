import * as vscode from 'vscode';
import { parseLine } from './parser/cParser';
import { parsePartial } from './parser/partialParser';
import { explain } from './explainer/explainer';
import { ExplainerPanel } from './panel/ExplainerPanel';
import { generate } from './ai/ollamaClient';
import { findEnclosingFunctionText, buildDeeperDivePrompt } from './ai/prompt';

const PARTIAL_DEBOUNCE_MS = 150;
const AI_DEBOUNCE_MS = 800;

export function activate(context: vscode.ExtensionContext): void {
  const panel = new ExplainerPanel();
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    ExplainerPanel.viewId,
    panel,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // Command to reveal/focus the sidebar view manually
  const openCmd = vscode.commands.registerCommand('codeTranslator.openPanel', () => {
    panel.reveal();
  });

  let aiDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let aiAbortController: AbortController | undefined;
  // Set after the first failed Ollama request (unreachable, timeout, bad
  // response). Once true, no further attempts are made for the rest of the
  // session — matches "silently disable for the session" rather than
  // retrying (and potentially re-notifying) on every cursor move.
  let aiSessionDisabled = false;

  function cancelPendingAiRequest(): void {
    if (aiDebounceTimer) {
      clearTimeout(aiDebounceTimer);
      aiDebounceTimer = undefined;
    }
    if (aiAbortController) {
      aiAbortController.abort();
      aiAbortController = undefined;
    }
  }

  function scheduleAiRequest(editor: vscode.TextEditor, lineIndex: number, line: string, ruleBasedPlain: string): void {
    if (aiSessionDisabled) return;
    const aiEnabled = vscode.workspace.getConfiguration('codeTranslator').get<boolean>('ai.enabled', false);
    if (!aiEnabled) return; // no network calls at all unless explicitly enabled

    aiDebounceTimer = setTimeout(() => {
      aiDebounceTimer = undefined;
      // Cursor may have moved to a different line within the debounce
      // window without a new render() call landing here yet - double-check
      // before spending a network round trip on a line that's no longer current.
      if (vscode.window.activeTextEditor !== editor || editor.selection.active.line !== lineIndex) return;

      const controller = new AbortController();
      aiAbortController = controller;

      const config = vscode.workspace.getConfiguration('codeTranslator');
      const model = config.get<string>('ai.model', 'llama3.2');

      const allLines: string[] = [];
      for (let i = 0; i < editor.document.lineCount; i++) allLines.push(editor.document.lineAt(i).text);
      const functionText = findEnclosingFunctionText(allLines, lineIndex);
      const prompt = buildDeeperDivePrompt(line, functionText, ruleBasedPlain);

      generate({ model, prompt, signal: controller.signal })
        .then(text => {
          if (controller.signal.aborted) return; // stale - a newer request superseded this one
          panel.updateAiResult(lineIndex + 1, text);
        })
        .catch(() => {
          if (controller.signal.aborted) return; // cancelled by cursor movement, not a real failure
          aiSessionDisabled = true;
          panel.updateAiUnavailable(lineIndex + 1);
          vscode.window.showInformationMessage(
            'Code Translator: could not reach Ollama — "Deeper Dive" is disabled for the rest of this session.'
          );
        });
    }, AI_DEBOUNCE_MS);
  }

  function render(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== 'c') return;

    const lineIndex = editor.selection.active.line;
    const line = editor.document.lineAt(lineIndex).text;

    // The line is changing - any previous line's pending/in-flight AI
    // request is no longer relevant.
    cancelPendingAiRequest();

    if (!line.trim()) {
      panel.showEmpty();
      return;
    }

    const parsed = parseLine(line);
    if (parsed.kind === 'unknown') {
      const partial = parsePartial(line);
      if (partial) {
        panel.updatePartial(lineIndex + 1, line, partial);
        return;
      }
    }

    const explanation = explain(parsed);
    panel.update(lineIndex + 1, line, parsed, explanation);

    // Deeper Dive only makes sense once there's a real rule-based
    // explanation to build on - not for the unknown-line fallback.
    if (!explanation.isUnknown) {
      scheduleAiRequest(editor, lineIndex, line, explanation.plain);
    }
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Typing changes the document, which fires both this listener and the
  // selection listener below for the same keystroke. Debouncing here (and
  // having the selection listener skip while a debounce is pending) means a
  // burst of keystrokes settles into one render ~150ms after typing pauses,
  // rather than one instant render per character.
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) return;
    if (editor.document.languageId !== 'c') return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (vscode.window.activeTextEditor === editor) render(editor);
    }, PARTIAL_DEBOUNCE_MS);
  });

  // Pure cursor movement (arrow keys, clicks) has no pending document-change
  // debounce, so it renders instantly — this is what keeps arrowing through
  // a file flicker-free per Phase 2. When a debounce IS pending, this is a
  // typing-driven selection change; skip it and let the debounced handler
  // above render once, instead of rendering twice for the same keystroke.
  const cursorListener = vscode.window.onDidChangeTextEditorSelection(event => {
    if (debounceTimer) return;
    render(event.textEditor);
  });

  context.subscriptions.push(viewRegistration, openCmd, cursorListener, documentChangeListener);
}

export function deactivate(): void {}
