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
};

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('lightTranslator.translateSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Open a file and select text to translate.');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection).trim();
        if (!text) {
            vscode.window.showInformationMessage('No text selected.');
            return;
        }

        // Language selection
        const choice = await vscode.window.showQuickPick(
            Object.keys(LANG_MAP),
            { placeHolder: 'Select target language' }
        );

        if (!choice) return;

        const lang = LANG_MAP[choice];

        // API URL
        const apiUrl = vscode.workspace.getConfiguration('lightTranslator').get('apiUrl') as string || 'https://harshiddev-text-translator.hf.space/translate';

        try {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, lang })
            });

            const data = await resp.json();

            if (data.translated) {
                const summary = data.translated.length > 250 ? data.translated.slice(0, 250) + '...' : data.translated;
                vscode.window.showInformationMessage(`Translation: ${summary}`);

                editor.edit(editBuilder => {
                    editBuilder.replace(selection, data.translated);
                });
            } else if (data.error) {
                vscode.window.showErrorMessage(`Translation error: ${data.error}`);
            } else {
                vscode.window.showErrorMessage('Unexpected response from translator API');
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(`Request failed: ${err.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
