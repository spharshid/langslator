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

export function activate(context: vscode.ExtensionContext) {
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

            if (parsed !== null) {
                vscode.window.showInformationMessage('Detected JSON — translating values recursively...');
                const translated = await translateRecursive(parsed);

                const formatted = JSON.stringify(translated, null, 2);

                // Remove wrapping braces if originally not wrapped
                if (wrapped) {
                    const inner = formatted
                        .trim()
                        .replace(/^{/, '')
                        .replace(/}$/, '')
                        .trim();
                    resultText = inner + newline;
                } else {
                    resultText = formatted + newline;
                }
            } else {
                vscode.window.showInformationMessage('Translating plain text...');
                const translated = await translateText(text);
                const leadingWs = raw.match(/^\s*/)?.[0] ?? '';
                const trailingWs = raw.match(/\s*$/)?.[0] ?? '';
                resultText = leadingWs + translated + trailingWs;
            }

            await editor.edit(editBuilder => {
                editBuilder.replace(selection, resultText);
            });

            vscode.window.showInformationMessage('✅ Translation finished.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Translation failed: ${err?.message || err}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

// ----------------- Helpers -----------------
function detectNewline(s: string): string {
    return s.includes('\r\n') ? '\r\n' : '\n';
}
