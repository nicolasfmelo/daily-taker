const { test, assert, finish } = imports.harness;
const P = imports.preferencesLogic;

test('describeKeySource: chaveiro', () => {
    const d = P.describeKeySource({ key: 'k', source: 'secret' });
    assert.equal(d.label, 'Chave salva no chaveiro');
    assert.equal(d.offerSaveEnv, false);
    assert.equal(d.hasKey, true);
});

test('describeKeySource: arquivo', () => {
    const d = P.describeKeySource({ key: 'k', source: 'file' });
    assert.equal(d.label, 'Chave salva em arquivo');
    assert.equal(d.offerSaveEnv, false);
    assert.equal(d.hasKey, true);
});

test('describeKeySource: só a variável de ambiente oferece salvar', () => {
    const d = P.describeKeySource({ key: 'k', source: 'env' });
    assert.equal(d.label, 'Usando a variável DAILY_TAKER_OP_KEY');
    assert.equal(d.offerSaveEnv, true);
    assert.equal(d.hasKey, true);
});

test('describeKeySource: sem chave', () => {
    const d = P.describeKeySource(null);
    assert.equal(d.label, 'Nenhuma chave configurada');
    assert.equal(d.offerSaveEnv, false);
    assert.equal(d.hasKey, false);
});

test('describeKeySource: o rótulo nunca contém a chave', () => {
    for (const source of ['secret', 'file', 'env']) {
        const d = P.describeKeySource({ key: 'sk-segredo-123', source });
        assert.equal(JSON.stringify(d).includes('sk-segredo-123'), false);
    }
});

test('removeOutcome: nada sobrou', () => {
    const r = P.removeOutcome(null);
    assert.equal(r.ok, true);
    assert.equal(r.message, 'Chave removida');
});

test('removeOutcome: sobrou só a env', () => {
    const r = P.removeOutcome({ key: 'k', source: 'env' });
    assert.equal(r.ok, true);
    assert.equal(r.message, 'Chave removida');
});

test('removeOutcome: chave ainda no chaveiro é falha', () => {
    const r = P.removeOutcome({ key: 'k', source: 'secret' });
    assert.equal(r.ok, false);
    assert.equal(r.message, 'Não foi possível remover a chave do chaveiro');
});

test('removeOutcome: chave ainda no arquivo é falha', () => {
    const r = P.removeOutcome({ key: 'k', source: 'file' });
    assert.equal(r.ok, false);
    assert.equal(r.message, 'Não foi possível remover a chave do chaveiro');
});

test('languageToIndex / indexToLanguage', () => {
    assert.equal(P.languageToIndex('pt'), 0);
    assert.equal(P.languageToIndex('auto'), 1);
    assert.equal(P.languageToIndex('xx'), 0);
    assert.equal(P.indexToLanguage(0), 'pt');
    assert.equal(P.indexToLanguage(1), 'auto');
    assert.equal(P.indexToLanguage(7), 'pt');
});

finish();
