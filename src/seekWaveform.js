/* exported SeekWaveform */
// Forma de onda clicável do player: barras de 3 px (2 px de intervalo) da gravação
// inteira, parte já tocada em laranja, resto no cinza secundário translúcido, e um
// marcador redondo na posição. Clique e arraste emitem `seek-requested(fração)`.
const { GObject, Gtk } = imports.gi;
const Cairo = imports.cairo;

const { bucketPeaks, fractionFromX } = imports.playerModel;

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 2;
const MARKER_RADIUS = 5;
const REST_ALPHA = 0.55;

var SeekWaveform = GObject.registerClass({
    Properties: {
        'position': GObject.ParamSpec.double('position', 'position',
            'Playback position as a fraction (0-1)',
            GObject.ParamFlags.READWRITE, 0, 1, 0),
    },
    Signals: {
        'seek-requested': { param_types: [GObject.TYPE_DOUBLE] },
    },
}, class SeekWaveform extends Gtk.DrawingArea {
    _init(params = {}) {
        this._peaks = [];
        this._position = 0;
        this._dragging = false;
        this._dragStartX = 0;
        super._init({ height_request: 44, hexpand: true, ...params });
        this.add_css_class('seek-waveform');
        this.set_cursor_from_name('pointer');
        this.set_draw_func((_area, cr, width, height) => this._draw(cr, width, height));

        const drag = new Gtk.GestureDrag();
        drag.connect('drag-begin', (gesture, x) => {
            gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            this._dragging = true;
            this._dragStartX = x;
            this._requestSeek(x);
        });
        drag.connect('drag-update', (_gesture, dx) => this._requestSeek(this._dragStartX + dx));
        drag.connect('drag-end', (_gesture, dx) => {
            this._requestSeek(this._dragStartX + dx);
            this._dragging = false;
        });
        this.add_controller(drag);
        this.connect('notify::sensitive', () => this.queue_draw());
    }

    get position() {
        return this._position;
    }

    set position(value) {
        const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
        if (next === this._position)
            return;
        this._position = next;
        this.notify('position');
        this.queue_draw();
    }

    // true enquanto o usuário arrasta: quem atualiza a posição pelo player deve esperar.
    get dragging() {
        return this._dragging;
    }

    setPeaks(peaks) {
        this._peaks = Array.isArray(peaks) ? peaks : [];
        this.queue_draw();
    }

    _requestSeek(x) {
        const fraction = fractionFromX(x, this.get_width());
        this.position = fraction;
        this.emit('seek-requested', fraction);
    }

    _colors() {
        // Cores nomeadas do tema (data/style.css): accent_color e dimmed_color.
        const style = this.get_style_context();
        const fg = this.get_color();
        const [hasAccent, accent] = style.lookup_color('accent_color');
        const [hasDim, dim] = style.lookup_color('dimmed_color');
        return { fg, accent: hasAccent ? accent : fg, dim: hasDim ? dim : fg };
    }

    _draw(cr, width, height) {
        const { fg, accent, dim } = this._colors();
        const step = BAR_WIDTH + BAR_GAP;
        const count = Math.max(0, Math.floor((width + BAR_GAP) / step));
        const offset = (width - (count * step - BAR_GAP)) / 2;
        const middle = height / 2;
        const usable = height - 2 * MARKER_RADIUS;
        const markerX = Math.min(width - MARKER_RADIUS, Math.max(MARKER_RADIUS, this._position * width));

        const bars = bucketPeaks(this._peaks, count);
        // Normaliza pelo maior pico para gravações baixas não virarem uma linha.
        const loudest = Math.max(...bars, 0);
        const scale = loudest > 0 ? 1 / loudest : 0;

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(BAR_WIDTH);
        // Com tampas redondas o traço cresce BAR_WIDTH/2 em cada ponta.
        const cap = BAR_WIDTH / 2;
        const paint = (played, color, alpha) => {
            cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha * alpha);
            bars.forEach((value, i) => {
                const x = offset + i * step + BAR_WIDTH / 2;
                if ((x <= markerX) !== played)
                    return;
                const h = Math.max(MIN_BAR_HEIGHT, value * scale * usable);
                const half = Math.max(0, h / 2 - cap);
                cr.moveTo(x, middle - half);
                cr.lineTo(x, middle + half);
            });
            cr.stroke();
        };
        paint(true, accent, 1);
        paint(false, dim, REST_ALPHA);

        // Sem gravação (insensível) não há posição a marcar.
        if (!this.is_sensitive()) {
            cr.$dispose();
            return;
        }
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, accent.alpha);
        cr.arc(markerX, middle, MARKER_RADIUS, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(fg.red, fg.green, fg.blue, fg.alpha);
        cr.arc(markerX, middle, MARKER_RADIUS - 2, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }
});
