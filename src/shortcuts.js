/* exported SHORTCUTS shortcutFor shouldHandleShortcut deletedToastTitle deleteKeyGuard */
// Atalhos de teclado da janela (modo lista), sem GTK: qual tecla chama qual ação win.* e
// quando a tecla é do app ou de quem tem o foco.
//
// Regra (Review Focus 5): a janela escuta as teclas na fase de captura, antes do widget
// focado, e só as trata se
//   - a janela está no modo lista (no RECORDER valem os atalhos recorder.*);
//   - a tecla não veio de um popover/diálogo (menus ⋮, velocidade, etc.);
//   - o foco não está num campo de texto (Gtk.Editable / Gtk.TextView): ali as teclas
//     simples (espaço, B, N, F2, Delete) são do texto; só Ctrl+S continua valendo;
//   - para o espaço: o foco não está num botão (espaço ativa o botão focado).
// Fora disso a tecla segue para o widget focado como sempre.
var SHORTCUTS = [
    { action: 'play-pause', key: 'space', ctrl: false },
    { action: 'seek-backward', key: 'b', ctrl: false },
    { action: 'seek-forward', key: 'n', ctrl: false },
    { action: 'rename', key: 'F2', ctrl: false },
    { action: 'delete', key: 'Delete', ctrl: false },
    { action: 'export-audio', key: 's', ctrl: true },
];

// Ação para a tecla `key` (nome do keyval em minúsculas, ex.: 'b', 'space', 'F2') com os
// modificadores dados; null se não é atalho. Modificador a mais não casa (Shift+B não é B).
var shortcutFor = ({ key, ctrl = false, shift = false, alt = false } = {}) => {
    if (shift || alt)
        return null;
    return SHORTCUTS.find(s => s.key === key && s.ctrl === Boolean(ctrl))?.action ?? null;
};

var shouldHandleShortcut = ({ action, focusIsEditable, focusIsButton, inDialog, recorderState } = {}) => {
    const shortcut = SHORTCUTS.find(s => s.action === action);
    if (!shortcut || recorderState || inDialog)
        return false;
    if (focusIsEditable && !shortcut.ctrl)
        return false;
    if (focusIsButton && action === 'play-pause')
        return false;
    return true;
};

// Auto-repeat envia presses sem releases: só soltar a tecla permite outro Delete.
var deleteKeyGuard = (held, event) => ({
    held: event === 'press',
    delete: event === 'press' && !held,
});

const TITLE_NAME_MAX = 40;

// Título do toast de exclusão (texto puro: o toast é criado com use_markup = false).
var deletedToastTitle = name => {
    const text = name ?? '';
    const shown = [...text].length > TITLE_NAME_MAX
        ? `${[...text].slice(0, TITLE_NAME_MAX - 1).join('')}…` : text;
    return `"${shown}" excluída`;
};
