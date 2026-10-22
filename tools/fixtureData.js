// Usado por tools/make-fixtures.sh: grava as transcrições v1 das fixtures e acerta
// as datas de modificação (o app ordena a lista por elas).
//   GJS_PATH=src gjs tools/fixtureData.js DIR/daily-taker
const { Gio, GLib } = imports.gi;
const { stringifyTranscript } = imports.transcript;

const BLOCKS = [
    [0, 0, 'Bom dia, pessoal. Vamos começar pelo que avançou ontem e pelo que precisamos resolver hoje.'],
    [18, 1, 'Finalizei a captura de áudio. Agora estou ajustando a visualização das transcrições.'],
    [34, 0, 'A ideia é conseguir ouvir e acompanhar o texto sem precisar trocar de tela.'],
    [47, 1, 'Vou deixar os horários clicáveis para voltar direto ao trecho da gravação.'],
    [62, 0, 'Ótimo. E a busca nas transcrições já funciona com acentos?'],
    [76, 1, 'Funciona. A busca ignora acentos e também filtra pela data da gravação.'],
    [92, 0, 'Perfeito. Depois quero ver o resumo gerado ao lado da transcrição.'],
    [108, 1, 'Combinado. Vou preparar uma versão para testarmos amanhã cedo.'],
    [123, 0, 'Então fechamos assim. Alguém tem mais algum ponto para hoje?'],
    [138, 1, 'Só lembrar de exportar o áudio da reunião de ontem para a pasta do projeto.'],
    [155, 0, 'Anotado. Obrigado, pessoal, até amanhã.'],
];
const LAST_END = 162;

// [nome, dias atrás, hora, minuto, duração nominal em s, tem transcrição]
const RECORDINGS = [
    ['Daily · Projeto Atlas', 0, 9, 30, 1148, true],
    ['Ideias para o app', 0, 8, 12, 272, true],
    ['Notas da reunião', 1, 16, 45, 760, true],
    ['Sem transcrição', 3, 14, 5, 95, false],
];

const round = x => Math.round(x * 1000) / 1000;

const buildWords = () => {
    const words = [];
    BLOCKS.forEach(([start, speaker, text], i) => {
        const next = i + 1 < BLOCKS.length ? BLOCKS[i + 1][0] : LAST_END;
        const parts = text.split(' ');
        const slot = (next - start - 1.5) / parts.length;
        parts.forEach((word, j) => {
            const s = start + j * slot;
            words.push({ word, start: round(s), end: round(s + slot * 0.8), speaker, type: 'word' });
        });
    });
    return words;
};

const dir = Gio.File.new_for_path(ARGV[0]);
const today = GLib.DateTime.new_now_local();

for (const [name, daysAgo, hour, minute, duration, transcribed] of RECORDINGS) {
    const day = today.add_days(-daysAgo);
    const recordedAt = GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(),
        hour, minute, 0);
    const file = dir.get_child(name);
    const files = [file];

    if (transcribed) {
        const t = {
            version: 1,
            title: name,
            recorded_at: recordedAt.format_iso8601(),
            transcribed_at: recordedAt.add_seconds(duration + 120).format_iso8601(),
            duration,
            language: 'por',
            model: 'elevenlabs/scribe-v2',
            cost_usd: round(duration / 3600 * 0.4),
            text: BLOCKS.map(b => b[2]).join(' '),
            speakers: { '0': 'Nicolas' },
            words: buildWords(),
        };
        const json = dir.get_child(`${name}.transcript.json`);
        json.replace_contents(stringifyTranscript(t), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        files.push(json);
    }

    // A lista mostra a data de modificação: igual ao início da gravação.
    const mtime = recordedAt.to_unix();
    for (const f of files) {
        f.set_attribute_uint64('time::modified', mtime, Gio.FileQueryInfoFlags.NONE, null);
        f.set_attribute_uint32('time::modified-usec', 0, Gio.FileQueryInfoFlags.NONE, null);
    }
}
