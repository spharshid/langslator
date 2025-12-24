import * as vscode from 'vscode';

// ✅ Explicit lightweight declaration
declare const fetch: any;

// Language dropdown mapping
const LANG_MAP: Record<string, string> = {
    "English": "en",
    "French": "fr",
    "Spanish": "es",
    "German": "de",
    "Italian": "it",
    "Dutch": "nl",
    "Chinese": "zh",
    "Arabic": "ar",
    "Russian": "ru"
};

// State for pending translations
interface PendingTranslation {
    originalUri: vscode.Uri; // The actual file on disk
    originalText: string; // The FULL text before translation
    selection: vscode.Selection;
}

const pendingTranslations = new Map<string, PendingTranslation>();

// Status Bar Items
let acceptSbItem: vscode.StatusBarItem;
let rejectSbItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // Register the Read-Only provider for the Left Side (Original Content)
    const originalProvider = new OriginalDocumentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(OriginalDocumentProvider.scheme, originalProvider));

    // Initialize Status Bar Items
    acceptSbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    acceptSbItem.text = "$(check) Accept Translation";
    acceptSbItem.tooltip = "Keep the applied translation";
    acceptSbItem.command = "langslator.acceptTranslation";
    acceptSbItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground'); 
    
    rejectSbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    rejectSbItem.text = "$(close) Reject Translation";
    rejectSbItem.tooltip = "Revert the translation";
    rejectSbItem.command = "langslator.rejectTranslation";
    rejectSbItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground'); 

    context.subscriptions.push(acceptSbItem);
    context.subscriptions.push(rejectSbItem);

    // Update Status Bar Visibility
    const updateStatusBar = (editor: vscode.TextEditor | undefined) => {
        // We show controls if the ACTIVE editor is the one being reviewed.
        // In Diff View, the active editor is the modified file (Right side).
        if (!editor || !pendingTranslations.has(editor.document.uri.toString())) {
            acceptSbItem.hide();
            rejectSbItem.hide();
        } else {
            acceptSbItem.show();
            rejectSbItem.show();
        }
    };

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));

    // Command: Accept Translation
    context.subscriptions.push(vscode.commands.registerCommand('langslator.acceptTranslation', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const state = pendingTranslations.get(editor.document.uri.toString());
        if (!state) {
            vscode.window.showWarningMessage("No active translation review found.");
            return;
        }
        try {
            pendingTranslations.delete(editor.document.uri.toString());
            
            // Clean up the left-side entry
             for (const [key, value] of pendingTranslations.entries()) {
                if (value === state && key.startsWith(OriginalDocumentProvider.scheme)) {
                    pendingTranslations.delete(key);
                    break;
                }
            }

            updateStatusBar(undefined);
            
            // Close the Diff Editor.
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            vscode.window.showInformationMessage('Translation accepted.');
        } catch (err) {
            vscode.window.showErrorMessage(`Error accepting translation: ${err}`);
        }
    }));

    // Command: Reject Translation
    context.subscriptions.push(vscode.commands.registerCommand('langslator.rejectTranslation', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const state = pendingTranslations.get(editor.document.uri.toString());
        if (state) {
            try {
                // Logic: Revert the file to originalText
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE);
                edit.replace(state.originalUri, fullRange, state.originalText);
                
                // Set 'isRefactoring' or similar tag if needed to avoid triggers? No.
                const success = await vscode.workspace.applyEdit(edit);

                if (success) {
                    pendingTranslations.delete(editor.document.uri.toString());
                    for (const [key, value] of pendingTranslations.entries()) {
                        if (value === state && key.startsWith(OriginalDocumentProvider.scheme)) {
                            pendingTranslations.delete(key);
                            break;
                        }
                    }

                    updateStatusBar(undefined);
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    vscode.window.showInformationMessage('Translation reverted.');
                } else {
                    vscode.window.showErrorMessage('Failed to revert translation.');
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error reverting translation: ${err}`);
            }
        }
    }));

    // Command: Translate Selection
    const disposable = vscode.commands.registerCommand('lightTranslator.translateSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Open a file and select text to translate.');
            return;
        }

        const selection = editor.selection;
        const raw = editor.document.getText(selection);
        const text = raw.trim();
        if (!text) {
            vscode.window.showInformationMessage('No text selected.');
            return;
        }

        const choice = await vscode.window.showQuickPick(Object.keys(LANG_MAP), { placeHolder: 'Select target language' });
        if (!choice) return;
        const lang = LANG_MAP[choice];

        const apiUrl = vscode.workspace.getConfiguration('lightTranslator').get('apiUrl') as string || 'https://harshiddev-text-translator.hf.space/translate';
        const newline = detectNewline(raw);

        // --- Improved JSON detection ---
        let parsed: any = null;
        let wrapped = false;

        const tryParseJson = (candidate: string): any | null => {
            try {
                return JSON.parse(candidate);
            } catch {
                return null;
            }
        };

        // Normalize possible trailing commas
        const normalized = text.replace(/,\s*([}\]])/g, '$1');

        // Try raw
        parsed = tryParseJson(normalized);

        // Try wrapping in {}
        if (parsed === null && /^[\s\r\n]*"[^"]+"\s*:/.test(normalized)) {
            parsed = tryParseJson(`{${normalized}}`);
            if (parsed) wrapped = true;
        }

        // Try trimming stray commas
        if (parsed === null && /,\s*$/.test(normalized)) {
            parsed = tryParseJson(`{${normalized.replace(/,\s*$/, '')}}`);
            if (parsed) wrapped = true;
        }

        // Recursive translation of values only
        async function translateRecursive(obj: any): Promise<any> {
            if (typeof obj === 'string') {
                return await translateText(obj);
            } else if (Array.isArray(obj)) {
                return Promise.all(obj.map(item => translateRecursive(item)));
            } else if (obj && typeof obj === 'object') {
                const out: any = {};
                for (const [k, v] of Object.entries(obj)) {
                    out[k] = await translateRecursive(v);
                }
                return out;
            } else {
                return obj;
            }
        }

        async function translateText(s: string): Promise<string> {
            if (!s || s.trim() === '') return s;
            try {
                const resp = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: s, lang })
                });
                const data = await resp.json();
                return data.translated ?? s;
            } catch {
                return s;
            }
        }

        try {
            let resultText: string;
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Translating...", cancellable: false }, async () => {
                if (parsed !== null) {
                    const translated = await translateRecursive(parsed);
                    const formatted = JSON.stringify(translated, null, 2);
                    if (wrapped) {
                        const inner = formatted.trim().replace(/^{/, '').replace(/}$/, '').trim();
                        resultText = inner + newline;
                    } else resultText = formatted + newline;
                } else {
                    const translated = await translateText(text);
                    const leadingWs = raw.match(/^\s*/)?.[0] ?? '';
                    const trailingWs = raw.match(/\s*$/)?.[0] ?? '';
                    resultText = leadingWs + translated + trailingWs;
                }

                // --- DIRECT EDIT & DIFF VIEW ---
                const originalDocText = editor.document.getText();
                // 1. APPLY CHANGE IMMEDIATELY TO ACTIVE FILE
                // The editor might move, so we rely on the workspace edit.
                const edit = new vscode.WorkspaceEdit();
                edit.replace(editor.document.uri, selection, resultText);
                const applied = await vscode.workspace.applyEdit(edit);
                
                if (!applied) {
                    vscode.window.showErrorMessage("Could not apply translation edit.");
                    return;
                }

                // 2. PREPARE LEFT SIDE (Original Backup)
                const originalReadonlyUri = editor.document.uri.with({ 
                    scheme: OriginalDocumentProvider.scheme,
                    query: `ts=${Date.now()}` // Unique per run
                });
                
                // Store State
                const pendingState = {
                    originalUri: editor.document.uri,
                    originalText: originalDocText, // BACKUP
                    selection
                };

                // Map Real File URI -> State
                pendingTranslations.set(editor.document.uri.toString(), pendingState);
                pendingTranslations.set(originalReadonlyUri.toString(), pendingState);
                
                originalProvider.update(originalReadonlyUri);

                // 3. OPEN DIFF: Left=Backup, Right=Actual File
                await vscode.commands.executeCommand('vscode.diff', 
                    originalReadonlyUri, 
                    editor.document.uri, 
                    `Review: ${choice} Translation`
                );

                // Show Controls
                updateStatusBar(vscode.window.activeTextEditor);
                vscode.window.showInformationMessage(`Reviewing ${choice} Translation. Accept to keep, Reject to revert.`, "Accept", "Reject")
                    .then(sel => {
                        if (sel === "Accept") vscode.commands.executeCommand('langslator.acceptTranslation');
                        else if (sel === "Reject") vscode.commands.executeCommand('langslator.rejectTranslation');
                    });
            });
            
        } catch (err: any) {
            vscode.window.showErrorMessage(`Translation failed: ${err?.message || err}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

class OriginalDocumentProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'langslator-orig';
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    get onDidChange(): vscode.Event<vscode.Uri> { return this._onDidChange.event; }

    update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const state = pendingTranslations.get(uri.toString());
        return state ? state.originalText : '';
    }
}

// ----------------- Helpers -----------------
function detectNewline(s: string): string {
    return s.includes('\r\n') ? '\r\n' : '\n';
}
