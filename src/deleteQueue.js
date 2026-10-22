/* exported DeleteQueue */
// Exclusões pendentes ("Desfazer"), sem GTK. Cada exclusão tem um id próprio (o
// parâmetro da ação win.undo-delete do seu toast): duas exclusões seguidas nunca se
// confundem. Um item sai da fila uma única vez, por undo (volta para a lista) ou por
// commit (vai de fato para a lixeira); depois disso o id não vale mais nada.
var DeleteQueue = class DeleteQueue {
    constructor() {
        this._nextId = 1;
        this._items = new Map();     // id → { recording, index }, na ordem de inserção
    }

    // Enfileira `recording`, que estava na posição `index` da lista. Devolve o id.
    add(recording, index) {
        const id = this._nextId++;
        const position = Number.isInteger(index) && index > 0 ? index : 0;
        this._items.set(id, { recording, index: position });
        return id;
    }

    // Desfaz: { recording, index } e o item sai da fila; null se o id não está pendente.
    undo(id) {
        const item = this._take(id);
        return item ? { recording: item.recording, index: item.index } : null;
    }

    // Confirma: a gravação a apagar de fato (e o item sai da fila); null se não pendente.
    commit(id) {
        return this._take(id)?.recording ?? null;
    }

    // Confirma todas (ao fechar a janela), na ordem de inserção, e esvazia a fila.
    commitAll() {
        const all = [...this._items.values()].map(item => item.recording);
        this._items.clear();
        return all;
    }

    has(recording) {
        for (const item of this._items.values()) {
            if (item.recording === recording)
                return true;
        }
        return false;
    }

    // Gravações pendentes, na ordem de inserção (cópia).
    pending() {
        return [...this._items.values()].map(item => item.recording);
    }

    _take(id) {
        const item = this._items.get(id);
        if (!item)
            return null;
        this._items.delete(id);
        return item;
    }
};
