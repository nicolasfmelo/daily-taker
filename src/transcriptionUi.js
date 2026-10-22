/* exported rowStatus, formatUsd, formatDuration, confirmMessage, hasKey, statusInfo,
   guardedSave, canRetry, rowActions */
// Decisões da interface de "Gerar transcrição", sem GTK: testáveis isoladamente.
const { TranscribeError, estimateCostUsd } = imports.transcriber;

// Ordem: execução em andamento > última execução falhou > transcrição salva > nada.
// O serviço só informa 'error' se a ÚLTIMA execução falhou (um novo run limpa o erro),
// então o erro prevalece sobre uma transcrição antiga até o usuário tentar de novo.
var rowStatus = ({ hasTranscript, serviceStatus }) => {
    if (serviceStatus === 'running' || serviceStatus === 'error')
        return serviceStatus;
    return hasTranscript ? 'ready' : 'none';
};

var formatUsd = value => {
    if (value >= 0.01 || value <= 0)
        return `US$ ${Math.max(value, 0).toFixed(2).replace('.', ',')}`;
    // Abaixo de um centavo: até 4 casas, sem zeros à direita (mínimo 2).
    const text = value.toFixed(4);
    if (Number(text) === 0)
        return 'menos de US$ 0,0001';
    return `US$ ${text.replace(/0{1,2}$/, '').replace('.', ',')}`;
};

const UNKNOWN_DURATION = 'A duração ainda não é conhecida, então não é possível estimar o custo.';

var formatDuration = seconds => {
    const s = Math.round(seconds);
    if (s < 60)
        return `${s} s`;
    const totalMin = Math.round(s / 60);
    if (totalMin < 60)
        return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return min ? `${h} h ${min} min` : `${h} h`;
};

// regenerate: a gravação já tem transcrição e o usuário pede outra (cobrada de novo).
var confirmMessage = (seconds, { regenerate = false } = {}) => {
    // Sem duração conhecida não há estimativa honesta: não mostra "0 s / US$ 0,00".
    const known = Number.isFinite(seconds) && seconds > 0;
    if (regenerate) {
        return {
            heading: 'Gerar novamente?',
            body: known
                ? `Isto cobra de novo (${formatUsd(estimateCostUsd(seconds))}).`
                : `Isto cobra de novo. ${UNKNOWN_DURATION}`,
        };
    }
    if (!known)
        return { heading: 'Transcrever esta gravação?', body: UNKNOWN_DURATION };
    return {
        heading: `Transcrever ${formatDuration(seconds)}?`,
        body: `Custo estimado: ${formatUsd(estimateCostUsd(seconds))}`,
    };
};

// Ações da linha que dependem da transcrição. Renomear durante a execução é bloqueado:
// o serviço grava ao lado do arquivo antigo e a transcrição paga se perderia.
// Abrir só faz sentido com a transcrição pronta.
var rowActions = ({ status, seconds, editMode }) => ({
    transcribe: !editMode && status !== 'running' && Number.isFinite(seconds) && seconds > 0,
    rename: !editMode && status !== 'running',
    open: !editMode && status === 'ready',
});

var hasKey = entry => Boolean(entry && entry.key);

const STATUS_INFO = {
    none: { icon: null, tooltip: '' },
    running: { icon: null, tooltip: 'Transcrevendo…' },
    ready: { icon: 'emblem-ok-symbolic', tooltip: 'Transcrição pronta' },
    error: { icon: 'dialog-warning-symbolic', tooltip: 'A última transcrição falhou' },
};

var statusInfo = status => STATUS_INFO[status] ?? STATUS_INFO.none;

// Envolve o save do serviço: o serviço transforma qualquer erro não-TranscribeError em
// 'unknown'; aqui damos uma mensagem clara (sem detalhes do erro original) e não
// recriamos o .transcript.json de uma gravação que já foi para a lixeira.
var guardedSave = save => (recordingFile, transcript) => {
    if (!recordingFile.query_exists(null)) {
        throw new TranscribeError('recordingGone', 0,
            'A gravação foi excluída antes de a transcrição terminar.');
    }
    try {
        save(recordingFile, transcript);
    } catch (e) {
        throw new TranscribeError('saveFailed', 0,
            'A transcrição foi feita, mas não foi possível salvá-la no disco.');
    }
};

var canRetry = (error, recordingExists) =>
    recordingExists && !(error instanceof TranscribeError && error.kind === 'recordingGone');
