import * as vscode from 'vscode';
import { Explanation } from '../explainer/explainer';
import { PartialParse } from '../parser/partialParser';
import { ParsedLine } from '../parser/cParser';
import { DocsProvider } from '../docs/docsLinks';
import { escapeHtml, highlightLine } from './highlight';
import { buildRenderedRows, RenderedRow } from './rows';

// Only these origins are ever opened, regardless of what a webview message
// claims — a defense-in-depth check, since a doc-link URL is always one we
// generated ourselves via docsLinks.ts, never webview-supplied content.
const ALLOWED_DOCS_ORIGINS = ['https://en.cppreference.com', 'https://www.geeksforgeeks.org'];

type PanelMessage =
  | { type: 'empty' }
  | { type: 'unknown'; lineNumber: number; lineHtml: string; plain: string }
  | { type: 'partial'; lineNumber: number; lineHtml: string; intent: string; soFar: RenderedRow[]; hint?: string }
  | { type: 'update'; lineNumber: number; lineHtml: string; rows: RenderedRow[]; plain: string; aiEnabled: boolean }
  | { type: 'aiResult'; lineNumber: number; text: string }
  | { type: 'aiUnavailable'; lineNumber: number };

/**
 * Sidebar webview view (not an editor-column panel, so it never steals editor
 * space). One instance is created in extension.ts's activate() and registered
 * as the provider for the view declared in package.json's `contributes.views`.
 */
export class ExplainerPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'codeTranslator.explainerView';

  private _view: vscode.WebviewView | undefined;
  // Re-sent on resolve so a fresh/cold webview (or one recreated after
  // retainContextWhenHidden was unavailable) immediately shows the last
  // known state instead of a blank shell.
  private _lastMessage: PanelMessage = { type: 'empty' };
  // aiResult/aiUnavailable are follow-ups to the last "primary" message
  // (empty/unknown/partial/update), not a state on their own — replaying
  // just one without the other would leave the webview showing a Deeper
  // Dive answer with no surrounding panel, or vice versa. Cleared whenever
  // a new primary message is posted (a new line was rendered).
  private _lastAiMessage: PanelMessage | undefined;

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();
    webviewView.webview.postMessage(this._lastMessage);
    if (this._lastAiMessage) webviewView.webview.postMessage(this._lastAiMessage);

    // Docs links are opened here (extension host), never directly from the
    // webview. The URL always came from getDocsUrl in the first place, but
    // the origin check below is a deliberate belt-and-suspenders guard.
    webviewView.webview.onDidReceiveMessage(message => {
      if (message?.type !== 'openDocs' || typeof message.url !== 'string') return;
      const isAllowed = ALLOWED_DOCS_ORIGINS.some(origin => message.url.startsWith(origin));
      if (isAllowed) vscode.env.openExternal(vscode.Uri.parse(message.url));
    });
  }

  /**
   * Reveals the view without stealing focus from the editor; used by the
   * codeTranslator.openPanel command. VS Code auto-generates a
   * `<viewId>.focus` command for contributed views, but that's undocumented
   * enough to not fully trust — fall back to revealing the view container (a
   * documented, stable command) if it's ever unavailable, rather than
   * surface an error to the user.
   */
  public async reveal(): Promise<void> {
    try {
      await vscode.commands.executeCommand(`${ExplainerPanel.viewId}.focus`, { preserveFocus: true });
    } catch {
      await vscode.commands.executeCommand('workbench.view.extension.codeTranslator');
    }
  }

  public showEmpty(): void {
    this._post({ type: 'empty' });
  }

  public updatePartial(lineNumber: number, line: string, partial: PartialParse): void {
    const lineHtml = highlightLine(line.trim());
    const soFar: RenderedRow[] = partial.soFar.map(e => ({ label: e.label, valueHtml: escapeHtml(e.value) }));
    this._post({ type: 'partial', lineNumber, lineHtml, intent: partial.intent, soFar, hint: partial.hint });
  }

  public update(lineNumber: number, line: string, parsed: ParsedLine, explanation: Explanation): void {
    const lineHtml = highlightLine(line.trim());

    if (explanation.isUnknown) {
      this._post({ type: 'unknown', lineNumber, lineHtml, plain: explanation.plain });
      return;
    }

    // Read fresh on every render (not cached) so changing either setting
    // takes effect on the next cursor move, with no webview reload needed.
    const config = vscode.workspace.getConfiguration('codeTranslator');
    const provider = config.get<DocsProvider>('docsProvider', 'cppreference');
    const aiEnabled = config.get<boolean>('ai.enabled', false);
    const rows = buildRenderedRows(explanation, parsed, provider);
    this._post({ type: 'update', lineNumber, lineHtml, rows, plain: explanation.plain, aiEnabled });
  }

  /** Populates the Deeper Dive section once the Ollama request for `lineNumber` resolves. */
  public updateAiResult(lineNumber: number, text: string): void {
    this._post({ type: 'aiResult', lineNumber, text });
  }

  /** Hides the Deeper Dive section for `lineNumber` — used once AI is disabled for the session after a failed request. */
  public updateAiUnavailable(lineNumber: number): void {
    this._post({ type: 'aiUnavailable', lineNumber });
  }

  private _post(message: PanelMessage): void {
    if (message.type === 'aiResult' || message.type === 'aiUnavailable') {
      this._lastAiMessage = message;
    } else {
      this._lastMessage = message;
      this._lastAiMessage = undefined;
    }
    this._view?.webview.postMessage(message);
  }

  /**
   * Shell HTML is set exactly once per webview resolve. All subsequent
   * updates go through postMessage + the inline script's DOM patching below,
   * so arrowing through a file never triggers a full webview reload (which
   * causes visible flicker and would reset scroll position).
   */
  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Translator</title>
  <style>
    * { box-sizing: border-box; }
    /* Base text scale tracks the panel's own width (the webview is its own
       document, so vw here means "% of this panel," not the whole VS Code
       window) - this is what makes text resize automatically as the panel
       is resized or dragged to a narrower/wider region, with no manual step.
       Manual zoom (see #zoomControls below) overrides this via a runtime
       <style> tag targeting body with !important.

       WHY body AND NOT html: VS Code injects a default stylesheet
       (id="_defaultStyles") into every webview that sets body's font-size
       to var(--vscode-font-size) - an absolute px value.
       That severs font-size inheritance from <html>, so any rule on html
       (this one included) has zero visible effect: every em in this panel
       resolves against body's pinned size. The rule must live on body, and
       needs !important to reliably beat _defaultStyles regardless of where
       VS Code inserts it in the head. */
    body {
      /* clamp(10px, 6px + 1.6vw, 16px): 6px + 1.6% of panel width, so the
         scale actually varies across realistic sidebar widths (~250-625px)
         instead of a plain "%vw" formula, which only varies between 400px
         and 640px - well above most sidebar widths, so it sat pinned at the
         floor the entire time regardless of resizing. */
      font-size: clamp(10px, 6px + 1.6vw, 16px) !important;
      font-family: var(--vscode-font-family, sans-serif);
      padding: 12px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      overflow-x: hidden;
    }
    #emptyState, #unknownState, #partialState { display: none; }
    body.state-empty #emptyState { display: block; }
    body.state-empty #content { display: none; }
    body.state-unknown #unknownState { display: block; }
    body.state-unknown #syntaxSection { display: none; }
    body.state-normal #unknownState { display: none; }
    body.state-normal #syntaxSection { display: block; }
    body.state-partial #partialState { display: block; }
    body.state-partial #unknownState, body.state-partial #syntaxSection { display: none; }

    .placeholder {
      color: var(--vscode-descriptionForeground);
      padding: 8px 0;
    }
    .lineNumber {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .line-preview {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-focusBorder);
      padding: 8px 12px;
      margin-bottom: 16px;
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre;
      overflow-x: auto;
    }
    h2 {
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 8px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
      margin-bottom: 20px;
    }
    td {
      padding: 4px 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .label {
      color: var(--vscode-descriptionForeground);
      white-space: normal;
      width: 30%;
      font-size: 0.92em;
    }
    .label::after { content: ':'; }
    .value {
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .doc-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
      cursor: pointer;
    }
    .doc-link:hover {
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
    }
    .plain {
      line-height: 1.6;
      padding: 10px 12px;
      background: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
      white-space: pre-wrap;
    }
    .unknown-callout {
      line-height: 1.6;
      padding: 10px 12px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-textBlockQuote-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-widget-border));
      border-radius: 4px;
    }
    .typing-badge {
      display: inline-block;
      font-size: 0.77em;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-bottom: 10px;
    }
    .partial-callout {
      border: 1px dashed var(--vscode-widget-border);
      border-radius: 4px;
      padding: 10px 12px;
    }
    .partial-intent {
      line-height: 1.6;
    }
    .partial-hint {
      margin-top: 8px;
      font-size: 0.92em;
      font-style: italic;
      color: var(--vscode-descriptionForeground);
    }
    #aiSection { display: none; }
    .ai-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      margin-right: 8px;
      vertical-align: middle;
      animation: ai-spin 0.8s linear infinite;
    }
    @keyframes ai-spin {
      to { transform: rotate(360deg); }
    }
    .ai-thinking {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .divider {
      border: none;
      border-top: 1px solid var(--vscode-widget-border);
      margin: 16px 0;
    }
    .bit-changed {
      background: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.4));
      border-radius: 2px;
      font-weight: 700;
    }
    .tok-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
    .tok-preprocessor { color: var(--vscode-charts-yellow, #C586C0); }
    .tok-string, .tok-char { color: var(--vscode-charts-orange, #CE9178); }
    .tok-number { color: var(--vscode-charts-purple, #B5CEA8); }
    .tok-keyword { color: var(--vscode-charts-blue, #569CD6); font-weight: 600; }
    .tok-type { color: var(--vscode-charts-green, #4EC9B0); }

    /* Deliberately fixed-size (not em/rem) so these stay usable even when
       manual zoom has shrunk the rest of the panel's text far below normal
       reading size - you always need a way back to a legible size. */
    #zoomControls {
      position: fixed;
      top: 6px;
      right: 6px;
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      padding: 2px;
      font-size: 11px;
      z-index: 10;
    }
    #zoomControls button {
      all: unset;
      cursor: pointer;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-foreground);
      border-radius: 3px;
    }
    #zoomControls button:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
    }
    #zoomLevel {
      min-width: 32px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body class="state-empty">
  <div id="zoomControls" title="Text size">
    <button id="zoomOut" aria-label="Decrease text size">&minus;</button>
    <span id="zoomLevel">Auto</span>
    <button id="zoomIn" aria-label="Increase text size">+</button>
    <button id="zoomReset" aria-label="Reset to automatic text size" title="Reset to automatic">&#8635;</button>
  </div>

  <div id="emptyState" class="placeholder">Move your cursor to a line of code to see an explanation.</div>

  <div id="content">
    <div class="lineNumber" id="lineNumber"></div>
    <div class="line-preview" id="linePreview"></div>

    <div id="unknownState" class="unknown-callout">
      I can't break this line down yet — this is a preview of what the parser supports.
    </div>

    <div id="partialState" class="partial-callout">
      <div class="typing-badge">Still typing…</div>
      <div class="partial-intent" id="partialIntent"></div>
      <table><tbody id="partialSoFarBody"></tbody></table>
      <div class="partial-hint" id="partialHint"></div>
    </div>

    <div id="syntaxSection">
      <h2>Syntax Breakdown</h2>
      <table><tbody id="syntaxBody"></tbody></table>

      <hr class="divider">

      <h2>What's Happening</h2>
      <div class="plain" id="plainText"></div>

      <div id="aiSection">
        <hr class="divider">
        <h2>Deeper Dive</h2>
        <div class="plain" id="aiContent">
          <span class="ai-spinner" id="aiSpinner"></span><span class="ai-thinking" id="aiThinking">Thinking…</span>
          <span id="aiText" style="display: none;"></span>
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const body = document.body;
    const lineNumberEl = document.getElementById('lineNumber');
    const linePreviewEl = document.getElementById('linePreview');
    const syntaxBodyEl = document.getElementById('syntaxBody');
    const plainTextEl = document.getElementById('plainText');
    const partialIntentEl = document.getElementById('partialIntent');
    const partialSoFarBodyEl = document.getElementById('partialSoFarBody');
    const partialHintEl = document.getElementById('partialHint');
    const aiSectionEl = document.getElementById('aiSection');
    const aiSpinnerEl = document.getElementById('aiSpinner');
    const aiThinkingEl = document.getElementById('aiThinking');
    const aiTextEl = document.getElementById('aiText');
    const zoomOutEl = document.getElementById('zoomOut');
    const zoomInEl = document.getElementById('zoomIn');
    const zoomResetEl = document.getElementById('zoomReset');
    const zoomLevelEl = document.getElementById('zoomLevel');

    // Manual zoom: null means "no override, follow the automatic
    // width-based scale in the stylesheet." A number is a user-chosen pixel
    // size that overrides it. The override targets BODY, not html - VS
    // Code's injected _defaultStyles pins body's font-size to an absolute
    // px value (var(--vscode-font-size)), which severs inheritance from
    // html: an html-level font-size change computes "correctly" on html
    // while rendering nothing, because no visible text inherits from it.
    // (That was the font-scaling bug: right value, wrong element.) The
    // runtime <style> tag is appended last in head and uses !important so
    // it wins over both _defaultStyles and the stylesheet's clamp() rule.
    // Persisted with the webview's own state API so it survives the webview
    // being hidden/recreated, same as _lastMessage on the extension side
    // survives a fresh resolveWebviewView.
    const MIN_FONT_PX = 4;
    const MAX_FONT_PX = 20;
    const FONT_STEP_PX = 1;
    let manualFontPx = (vscode.getState() || {}).manualFontPx;
    if (typeof manualFontPx !== 'number') manualFontPx = null;

    const zoomStyleEl = document.createElement('style');
    document.head.appendChild(zoomStyleEl);

    function applyManualFontSize() {
      zoomStyleEl.textContent = manualFontPx === null ? '' : 'body { font-size: ' + manualFontPx + 'px !important; }';
      zoomLevelEl.textContent = manualFontPx === null ? 'Auto' : (manualFontPx + 'px');
    }
    applyManualFontSize();

    function setManualFontPx(px) {
      manualFontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, px));
      vscode.setState(Object.assign({}, vscode.getState(), { manualFontPx: manualFontPx }));
      applyManualFontSize();
    }

    zoomOutEl.addEventListener('click', () => {
      const current = manualFontPx !== null ? manualFontPx : parseFloat(getComputedStyle(document.body).fontSize);
      setManualFontPx(current - FONT_STEP_PX);
    });
    zoomInEl.addEventListener('click', () => {
      const current = manualFontPx !== null ? manualFontPx : parseFloat(getComputedStyle(document.body).fontSize);
      setManualFontPx(current + FONT_STEP_PX);
    });
    zoomResetEl.addEventListener('click', () => {
      manualFontPx = null;
      vscode.setState(Object.assign({}, vscode.getState(), { manualFontPx: null }));
      applyManualFontSize();
    });

    // Tracks which line the panel is currently showing, so a slow/late
    // aiResult or aiUnavailable message for a line the user has since
    // scrolled away from never overwrites what's on screen now.
    let currentLineNumber = null;

    // Docs links never navigate directly in the webview - clicking just
    // posts the (already-vetted) URL back to the extension host, which
    // opens it via vscode.env.openExternal.
    document.addEventListener('click', event => {
      const link = event.target.closest ? event.target.closest('.doc-link') : null;
      if (link && link.dataset.url) {
        vscode.postMessage({ type: 'openDocs', url: link.dataset.url });
      }
    });

    window.addEventListener('message', event => {
      const msg = event.data;

      if (msg.type === 'aiResult' || msg.type === 'aiUnavailable') {
        // Stale response for a line we've since moved away from - ignore.
        if (msg.lineNumber !== currentLineNumber) return;
        if (msg.type === 'aiUnavailable') {
          aiSectionEl.style.display = 'none';
          return;
        }
        aiSpinnerEl.style.display = 'none';
        aiThinkingEl.style.display = 'none';
        aiTextEl.style.display = 'inline';
        aiTextEl.textContent = msg.text;
        return;
      }

      if (msg.type === 'empty') {
        body.className = 'state-empty';
        currentLineNumber = null;
        return;
      }

      currentLineNumber = msg.lineNumber;
      lineNumberEl.textContent = 'Line ' + msg.lineNumber;
      linePreviewEl.innerHTML = msg.lineHtml;

      if (msg.type === 'unknown') {
        body.className = 'state-unknown';
        return;
      }

      if (msg.type === 'partial') {
        body.className = 'state-partial';
        partialIntentEl.textContent = msg.intent;
        partialSoFarBodyEl.innerHTML = msg.soFar.map(function (row) {
          return '<tr><td class="label">' + escapeHtml(row.label) + '</td><td class="value">' + row.valueHtml + '</td></tr>';
        }).join('');
        partialHintEl.textContent = msg.hint || '';
        partialHintEl.style.display = msg.hint ? 'block' : 'none';
        return;
      }

      body.className = 'state-normal';
      syntaxBodyEl.innerHTML = msg.rows.map(function (row) {
        return '<tr><td class="label">' + escapeHtml(row.label) + '</td><td class="value">' + row.valueHtml + '</td></tr>';
      }).join('');
      plainTextEl.textContent = msg.plain;

      aiSectionEl.style.display = msg.aiEnabled ? 'block' : 'none';
      if (msg.aiEnabled) {
        aiSpinnerEl.style.display = 'inline-block';
        aiThinkingEl.style.display = 'inline';
        aiTextEl.style.display = 'none';
        aiTextEl.textContent = '';
      }
    });

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }
}
