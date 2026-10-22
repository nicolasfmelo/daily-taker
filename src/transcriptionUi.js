/* exported rowStatus, formatUsd, formatDuration, confirmMessage, hasNamedSpeakers, hasKey,
   guardedSave, canRetry, rowActions, retryPlan, failureMessage, recordingNameProblem */
// Decisões da interface de "Gerar transcrição", sem GTK: testáveis isoladamente.
const { TranscribeError, estimateCostUsd } = imports.transcriber;
const { isTranscriptFileName } = imports.transcriptStore;

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
// namedSpeakers: a transcrição atual tem nomes dados pelo usuário, que a nova não terá
// (os ids de uma nova diarização não correspondem necessariamente às mesmas pessoas).
var confirmMessage = (seconds, { regenerate = false, namedSpeakers = false } = {}) => {
    // Sem duração conhecida não há estimativa honesta: não mostra "0 s / US$ 0,00".
    const known = Number.isFinite(seconds) && seconds > 0;
    if (regenerate) {
        const parts = [known
            ? `Isto cobra de novo: ${formatDuration(seconds)}, custo estimado ${formatUsd(estimateCostUsd(seconds))}.`
            : `Isto cobra de novo. ${UNKNOWN_DURATION}`];
        if (namedSpeakers)
            parts.push('Os nomes dados aos locutores serão perdidos.');
        return { heading: 'Gerar novamente?', body: parts.join(' ') };
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
// Abrir vale sempre que há transcrição no disco e nada em andamento: uma nova
// execução que falhou ('error') não apaga a transcrição anterior.
var rowActions = ({ status, seconds, editMode, hasTranscript = false }) => ({
    transcribe: !editMode && status !== 'running' && Number.isFinite(seconds) && seconds > 0,
    rename: !editMode && status !== 'running',
    open: !editMode && status !== 'running' && (status === 'ready' || hasTranscript),
});

var hasNamedSpeakers = t => Object.values(t?.speakers ?? {}).some(Boolean);

var hasKey = entry => Boolean(entry && entry.key);

// Envolve o save do serviço: o serviço transforma qualquer erro não-TranscribeError em
// 'unknown'; aqui damos uma mensagem clara (sem detalhes do erro original) e não
// recriamos o .transcript.json de uma gravação que já foi para a lixeira.
// isRemoved(file): a gravação saiu da biblioteca mas o arquivo ainda existe (exclusão
// esperando o "Desfazer"): conta como excluída.
var guardedSave = (save, { isRemoved = () => false } = {}) => (recordingFile, transcript) => {
    if (!recordingFile.query_exists(null) || isRemoved(recordingFile)) {
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

// O que o "Tentar de novo" de um toast de falha faz: 'save' (só salva a transcrição já
// paga que ficou em memória, sem diálogo de custo nem API), 'transcribe' (fluxo normal,
// com confirmação de custo) ou null (sem botão).
var retryPlan = (error, { recordingExists, hasUnsaved }) => {
    if (!canRetry(error, recordingExists))
        return null;
    if (error instanceof TranscribeError && error.kind === 'saveFailed' && hasUnsaved)
        return 'save';
    return 'transcribe';
};

// Só a mensagem fixa do TranscribeError chega à tela (nunca chave nem resposta bruta).
var failureMessage = (error, plan) => {
    const message = error instanceof TranscribeError
        ? error.message : new TranscribeError('unknown').message;
    return plan === 'save' ? `${message} Tentar de novo só salva, sem nova cobrança.` : message;
};

// Um nome terminado em .transcript.json esconderia o áudio da lista (seria lido como
// transcrição) na próxima abertura.
var recordingNameProblem = name => isTranscriptFileName(name)
    ? 'O nome da gravação não pode terminar em ".transcript.json".'
    : null;
