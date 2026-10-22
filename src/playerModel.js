/* exported RATES formatShortClock positionLabel rateLabel clampVolume fractionFromX bucketPeaks shouldScroll toggleMute volumeIcon
   SeekCoalescer positionHeld BAR_FLOOR normalizeBars waveformBars BarsCache */

var RATES = [0.75, 1, 1.25, 1.5, 2];

const pad2 = n => String(n).padStart(2, '0');

const finite = v => typeof v === 'number' && Number.isFinite(v);

var formatShortClock = sec => {
    const total = finite(sec) && sec > 0 ? Math.floor(sec) : 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
        ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
        : `${pad2(minutes)}:${pad2(seconds)}`;
};

var positionLabel = (pos, dur) => `${formatShortClock(pos)} / ${formatShortClock(dur)}`;

var rateLabel = r => `${finite(r) && r > 0 ? String(r).replace('.', ',') : '1'}x`;

var clampVolume = v => finite(v) ? Math.min(1, Math.max(0, v)) : 1;

var fractionFromX = (x, width) => {
    if (!finite(x) || !finite(width) || width <= 0)
        return 0;
    return Math.min(1, Math.max(0, x / width));
};

// Energia de cada balde (RMS dos picos de 100 ms que caem nele; não finito conta como 0).
// O máximo por balde deixava uma gravação longa de fala com todas as barras no topo: em
// ~16 s de fala sempre há uma sílaba alta.
var bucketPeaks = (peaks, bars) => {
    if (!finite(bars) || bars < 1)
        return [];
    const count = Math.floor(bars);
    const values = Array.isArray(peaks) ? peaks : [];
    if (values.length === 0)
        return new Array(count).fill(0);
    const out = [];
    for (let i = 0; i < count; i++) {
        const start = Math.floor(i * values.length / count);
        const end = Math.max(Math.floor((i + 1) * values.length / count), start + 1);
        let sum = 0;
        for (let j = start; j < end; j++) {
            const v = finite(values[j]) ? values[j] : 0;
            sum += v * v;
        }
        out.push(Math.sqrt(sum / (end - start)));
    }
    return out;
};

// Altura mínima (fração) de uma barra que não é silêncio.
var BAR_FLOOR = 0.18;

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

// Alturas 0–1 das barras: estica os valores entre os percentis 5 e 95 (acima satura em 1;
// o que não é silêncio fica pelo menos em BAR_FLOOR), para as diferenças de volume da fala
// aparecerem como na mockup. Silêncio (0) fica 0. Um sinal quase constante (variação menor
// que 10 % do p95) não é esticado: só dividido pelo p95, para não inventar variação.
var normalizeBars = values => {
    const list = Array.isArray(values) ? values.map(v => finite(v) && v > 0 ? v : 0) : [];
    if (list.length === 0)
        return [];
    const sorted = [...list].sort((a, b) => a - b);
    const high = percentile(sorted, 0.95);
    if (!(high > 0))
        return list.map(() => 0);
    const low = percentile(sorted, 0.05);
    const spread = high - low;
    if (spread < 0.1 * high)
        return list.map(v => Math.min(1, v / high));
    return list.map(v => v <= 0 ? 0
        : BAR_FLOOR + (1 - BAR_FLOOR) * Math.min(1, Math.max(0, (v - low) / spread)));
};

// Alturas das `bars` barras da onda a partir dos picos da gravação.
var waveformBars = (peaks, bars) => normalizeBars(bucketPeaks(peaks, bars));

// Guarda as últimas barras calculadas: o desenho (a cada quadro do marcador) só recalcula
// quando os picos (outro array) ou o número de barras (outra largura) mudam.
var BarsCache = class BarsCache {
    constructor(compute = waveformBars) {
        this._compute = compute;
        this.clear();
    }

    get(peaks, count) {
        if (peaks !== this._peaks || count !== this._count) {
            this._peaks = peaks;
            this._count = count;
            this._bars = this._compute(peaks, count);
        }
        return this._bars;
    }

    clear() {
        this._peaks = undefined;
        this._count = undefined;
        this._bars = [];
    }
};

var shouldScroll = ({ follow, index, previousIndex } = {}) =>
    follow === true && finite(index) && index >= 0 && index !== previousIndex;

// Ícone do botão de volume: mudo (ou 0), baixo abaixo de 0,34, médio abaixo de 0,67, alto acima.
var volumeIcon = (volume, muted) => {
    const v = clampVolume(volume);
    let level = 'high';
    if (muted || v <= 0)
        level = 'muted';
    else if (v < 0.34)
        level = 'low';
    else if (v < 0.67)
        level = 'medium';
    return `audio-volume-${level}-symbolic`;
};

// Clique no botão de volume. Com som: guarda o volume e zera (mudo). Mudo ou em 0:
// volta ao volume guardado (ou a 100 % se não houver um).
var toggleMute = ({ volume, muted, previous } = {}) => {
    const v = clampVolume(volume);
    if (muted === true || v <= 0) {
        const restored = finite(previous) && previous > 0 ? clampVolume(previous) : 1;
        return { volume: restored, muted: false, previous: restored };
    }
    return { volume: 0, muted: true, previous: v };
};

// Seeks pedidos durante o arraste na onda: o primeiro vai já; depois, no máximo um a cada
// `interval` ms (só o último pedido pendente sai no fim do intervalo); flush() (ao soltar)
// manda o pendente na hora. Relógio e temporizadores injetados (testável sem GLib).
var SeekCoalescer = class SeekCoalescer {
    constructor({ interval = 60, now, schedule, cancel, send }) {
        this._interval = interval;
        this._now = now;
        this._schedule = schedule;
        this._cancelTimer = cancel;
        this._send = send;
        this._lastSent = -Infinity;
        this._pending = null;
        this._timer = null;
    }

    request(value) {
        const elapsed = this._now() - this._lastSent;
        if (this._timer === null && elapsed >= this._interval) {
            this._emit(value);
            return;
        }
        this._pending = value;
        if (this._timer === null) {
            this._timer = this._schedule(this._interval - elapsed, () => {
                this._timer = null;
                this._emitPending();
            });
        }
    }

    flush() {
        this._stopTimer();
        this._emitPending();
    }

    cancel() {
        this._stopTimer();
        this._pending = null;
    }

    _emitPending() {
        if (this._pending === null)
            return;
        const value = this._pending;
        this._pending = null;
        this._emit(value);
    }

    _emit(value) {
        this._lastSent = this._now();
        this._send(value);
    }

    _stopTimer() {
        if (this._timer !== null) {
            this._cancelTimer(this._timer);
            this._timer = null;
        }
    }
};

// Logo depois de soltar o arraste (até `holdMs`), a posição que o player informa ainda
// pode ser a de antes do seek: o marcador não deve pular de volta.
var positionHeld = (now, releasedAt, holdMs) =>
    finite(releasedAt) && now - releasedAt < holdMs;
