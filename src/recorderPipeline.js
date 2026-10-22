/* exported buildPipelineDescription quoteValue */
// Descrição gst-launch do pipeline de gravação: microfone + áudio do sistema
// mixados em mono 16 kHz e gravados continuamente em Ogg/Opus.
// Não importa imports.application para poder ser carregado em gjs puro (testes).

// Aspas no estilo gst-launch: envolve em aspas duplas e escapa `\` e `"`.
function quoteValue(value) {
    return `"${String(value).replace(/[\\"]/g, c => `\\${c}`)}"`;
}

function _branch(source, levelName) {
    return `${source} ! audioconvert ! audioresample ! ` +
        `audio/x-raw,rate=16000,channels=1 ! level name=${levelName} ! mixer.`;
}

function buildPipelineDescription({
    micSource = 'pulsesrc device=@DEFAULT_SOURCE@',
    systemSource = 'pulsesrc device=@DEFAULT_MONITOR@',
    location,
} = {}) {
    return [
        'audiomixer name=mixer ! audioconvert ! level name=mix ! ' +
            'opusenc bitrate=32000 ! oggmux ! ' +
            // Sem buffer em espaço de usuário: cada página Ogg (≤ 0,5 s) vai
            // direto ao disco, então um crash deixa um arquivo parcial tocável.
            'filesink name=filesink buffer-mode=unbuffered ' +
            `location=${quoteValue(location)}`,
        _branch(micSource, 'mic'),
        _branch(systemSource, 'system'),
    ].join(' ');
}
