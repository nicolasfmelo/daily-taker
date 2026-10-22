const { test, assert, finish } = imports.harness;
const { stripIconFromLayout } = imports.headerLayout;

test('icon no início do lado esquerdo: só o token sai, os botões e os lados ficam', () => {
    assert.equal(stripIconFromLayout('icon:minimize,maximize,close'), ':minimize,maximize,close');
});

test('sem icon: layout intacto', () => {
    assert.equal(stripIconFromLayout('appmenu:close'), 'appmenu:close');
    assert.equal(stripIconFromLayout('menu:close'), 'menu:close');
    assert.equal(stripIconFromLayout('close,minimize,maximize:'), 'close,minimize,maximize:');
    assert.equal(stripIconFromLayout(':close'), ':close');
});

test('icon seguido de outro botão: sem vírgula sobrando', () => {
    assert.equal(stripIconFromLayout('icon,appmenu:minimize,maximize,close'), 'appmenu:minimize,maximize,close');
});

test('icon no meio ou no fim do lado: vírgulas arrumadas', () => {
    assert.equal(stripIconFromLayout('appmenu,icon,menu:close'), 'appmenu,menu:close');
    assert.equal(stripIconFromLayout('appmenu,icon:close'), 'appmenu:close');
});

test('icon no lado direito: removido, sem vírgula no começo nem no fim', () => {
    assert.equal(stripIconFromLayout('close,icon:'), 'close:');
    assert.equal(stripIconFromLayout(':minimize,icon,close'), ':minimize,close');
    assert.equal(stripIconFromLayout(':icon,close'), ':close');
    assert.equal(stripIconFromLayout(':close,icon'), ':close');
    assert.equal(stripIconFromLayout('menu:icon'), 'menu:');
});

test('icon dos dois lados: removido dos dois', () => {
    assert.equal(stripIconFromLayout('icon:close,icon'), ':close');
});

test('layout só com icon: vazio (o padrão do GTK vale)', () => {
    assert.equal(stripIconFromLayout('icon'), '');
    assert.equal(stripIconFromLayout('icon:'), ':');
    assert.equal(stripIconFromLayout(':icon'), ':');
});

test('vazio, null ou undefined: texto vazio', () => {
    assert.equal(stripIconFromLayout(''), '');
    assert.equal(stripIconFromLayout(null), '');
    assert.equal(stripIconFromLayout(undefined), '');
});

test('só o token exato icon sai (não um token que o contenha)', () => {
    assert.equal(stripIconFromLayout('icons:close'), 'icons:close');
    assert.equal(stripIconFromLayout('myicon,icon:close'), 'myicon:close');
    assert.equal(stripIconFromLayout('Icon:close'), 'Icon:close');
    assert.equal(stripIconFromLayout('icon-x,appmenu:close'), 'icon-x,appmenu:close');
});

test('espaços ao redor dos tokens são tolerados', () => {
    assert.equal(stripIconFromLayout('icon , appmenu : close'), 'appmenu:close');
});

finish();
