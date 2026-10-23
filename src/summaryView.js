/* exported SummaryView */
const { GObject, Gtk, Pango } = imports.gi;
const { parseMarkdown } = imports.markdownRender;

var SummaryView = GObject.registerClass(class SummaryView extends Gtk.ScrolledWindow {
    _init(params = {}) {
        super._init({ hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true, ...params });
        this._blocks = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_start: 28, margin_end: 28, margin_top: 12, margin_bottom: 24 });
        this.child = this._blocks;
    }

    setText(text) {
        for (let child = this._blocks.get_first_child(); child;) {
            const next = child.get_next_sibling();
            this._blocks.remove(child);
            child = next;
        }
        for (const block of parseMarkdown(text)) {
            const prefix = block.kind === 'li' ? '• ' : block.kind === 'oli' ? `${block.index}. ` : '';
            const label = new Gtk.Label({ label: prefix + block.markup, use_markup: true,
                wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR, selectable: true, xalign: 0,
                hexpand: true, max_width_chars: 76 });
            label.add_css_class(`summary-${block.kind === 'oli' ? 'li' : block.kind}`);
            this._blocks.append(label);
        }
        this.get_vadjustment().value = 0;
    }
});
