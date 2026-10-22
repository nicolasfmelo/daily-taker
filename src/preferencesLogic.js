/* exported describeKeySource removeOutcome languageToIndex indexToLanguage */
// Lógica pura (sem GTK) da tela de preferências, para ser testável em gjs puro.
// Nada aqui devolve ou inclui a chave da API.

var LANGUAGES = ['pt', 'auto'];

// info: resultado de KeyStore.get() ({key, source}) ou null.
var describeKeySource = info => {
    switch (info?.source) {
    case 'secret':
        return { label: 'Chave salva no chaveiro', hasKey: true, offerSaveEnv: false };
    case 'file':
        return { label: 'Chave salva em arquivo', hasKey: true, offerSaveEnv: false };
    case 'env':
        return { label: 'Usando a variável DAILY_TAKER_OP_KEY', hasKey: true, offerSaveEnv: true };
    default:
        return { label: 'Nenhuma chave configurada', hasKey: false, offerSaveEnv: false };
    }
};

// KeyStore.clear() engole erros do keyring; por isso a UI relê o store: se ainda há
// uma chave que não seja a da env, a remoção falhou.
var removeOutcome = afterClearInfo => {
    if (afterClearInfo && afterClearInfo.source !== 'env')
        return { ok: false, message: 'Não foi possível remover a chave do chaveiro' };
    return { ok: true, message: 'Chave removida' };
};

var languageToIndex = language => {
    const i = LANGUAGES.indexOf(language);
    return i < 0 ? 0 : i;
};

var indexToLanguage = index => LANGUAGES[index] ?? LANGUAGES[0];
