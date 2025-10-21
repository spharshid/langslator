"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
// Language dropdown mapping
const LANG_MAP = {
    "English": "en",
    "French": "fr",
    "Spanish": "es",
    "German": "de",
    "Italian": "it",
    "Dutch": "nl",
};
function activate(context) {
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
        const choice = await vscode.window.showQuickPick(Object.keys(LANG_MAP), { placeHolder: 'Select target language' });
        if (!choice)
            return;
        const lang = LANG_MAP[choice];
        // API URL
        const apiUrl = vscode.workspace.getConfiguration('lightTranslator').get('apiUrl') || 'https://harshiddev-text-translator.hf.space/translate';
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
            }
            else if (data.error) {
                vscode.window.showErrorMessage(`Translation error: ${data.error}`);
            }
            else {
                vscode.window.showErrorMessage('Unexpected response from translator API');
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Request failed: ${err.message}`);
        }
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map