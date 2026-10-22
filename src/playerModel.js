/* exported RATES formatShortClock positionLabel rateLabel clampVolume fractionFromX bucketPeaks shouldScroll toggleMute volumeIcon */

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
        let max = 0;
        for (let j = start; j < end; j++) {
            if (finite(values[j]) && values[j] > max)
                max = values[j];
        }
        out.push(max);
    }
    return out;
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
