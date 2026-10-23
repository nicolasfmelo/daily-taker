const { test, assert, finish } = imports.harness;
const M = imports.markdownRender;
const { Pango } = imports.gi;

test('títulos, parágrafos e pares de negrito/código', () => {
    assert.deepEqual(M.parseMarkdown('## Resumo\n\nTexto **forte**.'), [
        { kind: 'h2', markup: 'Resumo' }, { kind: 'p', markup: 'Texto <b>forte</b>.' },
    ]);
    assert.deepEqual(M.parseMarkdown('### Detalhe\n**a** **b** `x<&`\ncontinua'), [
        { kind: 'h3', markup: 'Detalhe' }, { kind: 'p', markup: '<b>a</b> <b>b</b> <tt>x&lt;&amp;</tt> continua' },
    ]);
});

test('conteúdo hostil é texto e delimitadores sem par não abrem tags', () => {
    for (const [text, markup] of [
        ['<script>&"x"', '&lt;script&gt;&amp;&quot;x&quot;'],
        ["'", '&apos;'], ['**sem fechar', '**sem fechar'],
        ['<b>cru</b>', '&lt;b&gt;cru&lt;/b&gt;'],
        ['**<b>&**', '<b>&lt;b&gt;&amp;</b>'],
        ['`**texto**`', '<tt>**texto**</tt>'],
        ['**a\0b**', '<b>ab</b>'],
        ['`a\0b`', '<tt>ab</tt>'],
        ['**a\x01\x08\x0bb\x1f**', '<b>ab</b>'],
    ]) {
        const blocks = M.parseMarkdown(text);
        assert.deepEqual(blocks, [{ kind: 'p', markup }]);
        for (const block of blocks)
            assert.equal(Pango.parse_markup(block.markup, -1, '\0')[0], true);
    }
});

test('listas simples, recuadas e numeradas; títulos vazios ignorados', () => {
    assert.deepEqual(M.parseMarkdown('##\n### \n- um\n* dois\n    - três\n2. quatro'), [
        { kind: 'li', markup: 'um' }, { kind: 'li', markup: 'dois' },
        { kind: 'li', markup: 'três' }, { kind: 'oli', markup: 'quatro', index: 2 },
    ]);
});

test('limites truncam texto antes de gerar markup sempre balanceado', () => {
    assert.equal(M.parseMarkdown('- x\n'.repeat(10000)).length, 400);
    assert.deepEqual(M.parseMarkdown('a'.repeat(100000)), [{ kind: 'p', markup: 'a'.repeat(2000) + '…' }]);
    assert.deepEqual(M.parseMarkdown('## ' + 'a'.repeat(100000)), [{ kind: 'h2', markup: 'a'.repeat(2000) + '…' }]);
    assert.equal(M.parseMarkdown('**' + 'x'.repeat(5000))[0].markup, '**' + 'x'.repeat(1998) + '…');
    assert.deepEqual(M.parseMarkdown(''), []);
    assert.deepEqual(M.parseMarkdown(null), []);
});

finish();
