/* exported TranscriptsPage */
// Aba "Transcrições": lista, busca e filtro por datas. Não conhece a janela: quem a usa
// decide o que fazer com 'transcript-activated' (hoje, Window.showTranscript).
const { Gio, GLib, GObject, Gtk, Pango } = imports.gi;
const { listTranscripts } = imports.transcriptStore;
const {
    dateButtonLabel, dateFromCalendar, emptyState, isDayChoice, presentEntries, rowSummary,
    visibleEntries,
} = imports.transcriptsPageModel;

const EMPTY_ICON = 'text-x-generic-symbolic';
const NO_RESULTS_ICON = 'edit-find-symbolic';

var TranscriptsPage = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/transcripts-page.ui',
    InternalChildren: [
        'searchEntry', 'fromButton', 'fromPopover', 'fromCalendar', 'fromClearButton',
        'toButton', 'toPopover', 'toCalendar', 'toClearButton',
        'contentStack', 'listBox', 'emptyStatus',
    ],
    Signals: {
        'transcript-activated': { param_types: [Gio.File.$gtype, GObject.TYPE_JSOBJECT] },
    },
}, class TranscriptsPage extends Gtk.Box {
    // dir: pasta das gravações; existsFn(file): a gravação ainda está disponível?
    _init({ dir, existsFn = file => file.query_exists(null), ...params } = {}) {
        super._init(params);
        this._dir = dir;
        this._existsFn = existsFn;
        this._entries = [];
        this._from = null;
        this._to = null;

        // O próprio SearchEntry espera search_delay (200 ms) antes de 'search-changed'.
        this._searchEntry.connect('search-changed', () => this._render());

        this._setupDateFilter(this._fromCalendar, this._fromPopover, this._fromClearButton,
            () => this._from, date => {
                this._from = date;
            });
        this._setupDateFilter(this._toCalendar, this._toPopover, this._toClearButton,
            () => this._to, date => {
                this._to = date;
            });

        this._listBox.connect('row-activated', (_list, row) => {
            if (row._entry)
                this.emit('transcript-activated', row._entry.recordingFile, row._entry.transcript);
        });

        // Visível de novo (troca de aba, volta da visão de transcrição): relê do disco.
        this.connect('map', () => this.reload());
        this._render();
    }

    // Lê as transcrições de forma síncrona: em escala pessoal (dezenas) é instantâneo.
    reload() {
        let all = [];
        try {
            all = listTranscripts(this._dir);
        } catch (e) {
            log(`Não foi possível listar as transcrições: ${e.message}`);
        }
        this._entries = presentEntries(all, this._existsFn);
        this._render();
    }

    // Algo mudou no disco: relê agora se a aba está à vista; senão, ao aparecer ('map').
    invalidate() {
        if (this.get_mapped())
            this.reload();
    }

    _setupDateFilter(calendar, popover, clearButton, getDate, setDate) {
        let shown = [calendar.year, calendar.month];
        let resetting = false;
        // Ao abrir, o calendário mostra o filtro aplicado (ou hoje).
        popover.connect('show', () => {
            const date = getDate();
            resetting = true;
            calendar.select_day(date
                ? GLib.DateTime.new_local(date.getFullYear(), date.getMonth() + 1, date.getDate(), 0, 0, 0)
                : GLib.DateTime.new_now_local());
            resetting = false;
            shown = [calendar.year, calendar.month];
        });
        calendar.connect('day-selected', () => {
            const current = [calendar.year, calendar.month];
            const choice = isDayChoice(shown, current);
            shown = current;
            if (resetting || !choice)
                return;
            const dt = calendar.get_date();
            setDate(dateFromCalendar(dt.get_year(), dt.get_month(), dt.get_day_of_month()));
            this._render();
            popover.popdown();
        });
        clearButton.connect('clicked', () => {
            setDate(null);
            this._render();
            popover.popdown();
        });
    }

    _render() {
        this._fromButton.label = dateButtonLabel('De', this._from);
        this._toButton.label = dateButtonLabel('Até', this._to);

        const visible = visibleEntries(this._entries, {
            query: this._searchEntry.text,
            from: this._from,
            to: this._to,
        });

        this._listBox.remove_all();
        for (const entry of visible)
            this._listBox.append(this._createRow(entry));

        const empty = emptyState(this._entries.length, visible.length);
        if (empty) {
            this._emptyStatus.title = empty.title;
            this._emptyStatus.description = empty.description;
            this._emptyStatus.icon_name = this._entries.length === 0 ? EMPTY_ICON : NO_RESULTS_ICON;
            this._contentStack.visible_child_name = 'empty';
        } else {
            this._contentStack.visible_child_name = 'list';
        }
    }

    _createRow(entry) {
        const summary = rowSummary(entry);
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_start: 12,
            margin_end: 12,
            margin_top: 10,
            margin_bottom: 10,
        });
        const label = (text, classes, extra = {}) => {
            const l = new Gtk.Label(Object.assign({
                label: text,
                xalign: 0,
                use_markup: false,
                ellipsize: Pango.EllipsizeMode.END,
            }, extra));
            for (const c of classes)
                l.add_css_class(c);
            return l;
        };

        box.append(label(summary.title, ['heading']));
        const meta = [summary.dateTime, summary.duration, summary.speakers].filter(Boolean).join(' · ');
        box.append(label(meta, ['dim-label', 'caption']));
        if (summary.excerpt) {
            box.append(label(summary.excerpt, ['dim-label'], {
                wrap: true,
                wrap_mode: Pango.WrapMode.WORD_CHAR,
                lines: 2,
            }));
        }

        const row = new Gtk.ListBoxRow({ child: box, activatable: true });
        row._entry = entry;
        return row;
    }
});
