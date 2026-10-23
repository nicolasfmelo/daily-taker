/* exported summaryConfirmMessage summaryFailureMessage summaryRetryPlan */
const { estimateSummaryCostUsd } = imports.summarizer;
const { formatUsd, retryPlan } = imports.transcriptionUi;
const { TranscribeError } = imports.transcriber;

var summaryConfirmMessage = (t, model, { regenerate = false } = {}) => {
    const cost = estimateSummaryCostUsd(t, model);
    const parts = [cost === null ? `Custo estimado indisponível para o modelo ${model}.`
        : `Custo estimado: ${formatUsd(cost)}.`];
    parts.push('O texto da transcrição será enviado ao OpenRouter.');
    if (regenerate)
        parts.push('O resumo atual será substituído.');
    return { heading: `Gerar resumo com ${model}?`, body: parts.join(' ') };
};

var summaryRetryPlan = (error, { hasUnsaved, recordingExists = true }) => {
    if (error?.kind === 'transcriptUnavailable' && hasUnsaved && recordingExists)
        return 'discard';
    const plan = retryPlan(error, { hasUnsaved, recordingExists });
    return plan === 'transcribe' ? 'summarize' : plan;
};

var summaryFailureMessage = (error, plan) => {
    const message = error instanceof TranscribeError ? error.message : 'Erro inesperado ao gerar o resumo.';
    return plan === 'save' ? `${message} Tentar de novo só salva, sem nova cobrança.` : message;
};
