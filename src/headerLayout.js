/* exported stripIconFromLayout */
// Layout dos botões da barra de título (gtk-decoration-layout), sem GTK.
//
// O token `icon` do layout do sistema (ex.: `icon:minimize,maximize,close`) faz o GTK
// desenhar um ícone pequeno do app no início de toda barra de cabeçalho. A barra do Daily
// Taker já tem o ícone maior ao lado do título, então ela usa o layout do sistema sem esse
// token: os demais botões e os lados continuam como o usuário configurou.

// `layout` sem o token exato `icon` ('icons' e 'Icon' ficam), com as vírgulas arrumadas
// (nada de vírgula no começo ou no fim de um lado, nem ',,'). O ':' que separa os lados é
// mantido. Um layout que só tinha `icon` (ex.: 'icon') vira ':' (nenhum botão), e não ''
// (a janela trocaria '' pelo padrão do GTK, que pode trazer o ícone de volta). Vazio, null
// ou undefined dão ''.
var stripIconFromLayout = layout => {
    if (!layout)
        return '';
    const stripped = String(layout).split(':')
        .map(side => side.split(',').map(token => token.trim()).filter(token => token && token !== 'icon').join(','))
        .join(':');
    return stripped === '' && String(layout).trim() !== '' ? ':' : stripped;
};
