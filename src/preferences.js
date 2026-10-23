/* exported PreferencesWindow */
const { Adw, GObject, Gtk } = imports.gi;

const { Settings } = imports.application;
const { defaultKeyStore } = imports.secrets;
const { checkApiKey } = imports.transcriber;
const { describeKeySource, removeOutcome, languageToIndex, indexToLanguage, normalizeSummaryModel } = imports.preferencesLogic;

// A chave nunca é exibida, registrada em log nem colocada em toast: o campo de entrada
// começa sempre vazio e só serve para digitar uma chave nova.
var PreferencesWindow = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/preferences.ui',
    InternalChildren: [
        'envRow', 'saveEnvButton', 'keyRow', 'statusRow', 'spinner',
        'removeButton', 'testButton', 'saveButton', 'languageRow', 'summaryModelRow',
    ],
}, class PreferencesWindow extends Adw.PreferencesWindow {

    _init(params) {
        super._init(params);

        this._store = defaultKeyStore();
        this._busy = false;
        this._destroyed = false;
        this.connect('destroy', () => {
            this._destroyed = true;
        });

        this._languageRow.selected = languageToIndex(Settings.get_string('language'));
        this._languageRow.connect('notify::selected', row => {
            Settings.set_string('language', indexToLanguage(row.selected));
        });

        this._summaryModelRow.text = normalizeSummaryModel(Settings.get_string('summary-model'));
        const saveModel = () => {
            const model = normalizeSummaryModel(this._summaryModelRow.text);
            this._summaryModelRow.text = model;
            Settings.set_string('summary-model', model);
        };
        this._summaryModelRow.connect('entry-activated', saveModel);
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', saveModel);
        this._summaryModelRow.add_controller(focus);

        this._keyRow.connect('changed', () => this._updateSensitivity());
        this._keyRow.connect('entry-activated', () => this._onSave());
        this._saveButton.connect('clicked', () => this._onSave());
        this._testButton.connect('clicked', () => this._onTest());
        this._removeButton.connect('clicked', () => this._onRemove());
        this._saveEnvButton.connect('clicked', () => this._onSaveEnv());

        this._refresh();
    }

    _typedKey() {
        return this._keyRow.text.trim();
    }

    // Relê o store e atualiza rótulo, linha da env e botões. Devolve o info lido.
    _refresh() {
        const info = this._store.get();
        const desc = describeKeySource(info);
        this._statusRow.subtitle = desc.label;
        this._envRow.visible = desc.offerSaveEnv;
        this._info = info;
        this._updateSensitivity();
        return info;
    }

    _updateSensitivity() {
        const typed = this._typedKey() !== '';
        const hasKey = this._info != null;
        const stored = hasKey && this._info.source !== 'env';
        this._saveButton.sensitive = !this._busy && typed;
        this._testButton.sensitive = !this._busy && (typed || hasKey);
        this._removeButton.sensitive = !this._busy && stored;
        this._saveEnvButton.sensitive = !this._busy;
        this._keyRow.sensitive = !this._busy;
    }

    _setBusy(busy) {
        this._busy = busy;
        this._spinner.visible = busy;
        this._spinner.spinning = busy;
        this._updateSensitivity();
    }

    _toast(message) {
        this.add_toast(new Adw.Toast({ title: message, use_markup: false }));
    }

    _onSave() {
        const typed = this._typedKey();
        if (this._busy || typed === '')
            return;
        try {
            this._store.save(typed);
        } catch (e) {
            this._toast('Não foi possível salvar a chave');
            return;
        }
        this._keyRow.text = '';
        this._refresh();
        this._toast('Chave salva');
    }

    _onSaveEnv() {
        const info = this._store.get();
        if (this._busy || info?.source !== 'env')
            return;
        try {
            this._store.save(info.key);
        } catch (e) {
            this._toast('Não foi possível salvar a chave');
            return;
        }
        this._refresh();
        this._toast('Chave salva');
    }

    async _onTest() {
        if (this._busy)
            return;
        const apiKey = this._typedKey() || this._store.get()?.key;
        if (!apiKey) {
            this._toast('Nenhuma chave configurada');
            return;
        }
        this._setBusy(true);
        let message;
        try {
            const result = await checkApiKey({ apiKey });
            message = result.ok ? 'Chave válida' : result.error.message;
        } catch (e) {
            message = 'Erro inesperado ao testar a chave';
        }
        if (this._destroyed)
            return;
        this._setBusy(false);
        this._toast(message);
    }

    _onRemove() {
        if (this._busy)
            return;
        try {
            this._store.clear();
        } catch (e) {
            // a verificação abaixo decide o resultado
        }
        // clear() engole falhas do keyring: confere o que ainda é legível.
        const outcome = removeOutcome(this._refresh());
        this._toast(outcome.message);
    }
});
