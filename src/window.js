/* exported Window */
/*
* Copyright 2013 Meg Ford
* This library is free software; you can redistribute it and/or
* modify it under the terms of the GNU Library General Public
* License as published by the Free Software Foundation; either
* version 2 of the License, or (at your option) any later version.
*
* This library is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
* Library General Public License for more details.
*
* You should have received a copy of the GNU Library General Public
* License along with this library; if not, see <http://www.gnu.org/licenses/>.
*
* Author: Meg Ford <megford@gnome.org>
*
*/

const { Adw, Gio, GLib, GObject, Gst, GstPlayer, Gtk } = imports.gi;

const { Recorder } = imports.recorder;
const { RecordingList } = imports.recordingList;
const { RecordingsListWidget } = imports.recordingListWidget;
const { RecorderWidget } = imports.recorderWidget;

var WindowState = {
    EMPTY: 0,
    LIST: 1,
    RECORDER: 2,
};

var Window = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/window.ui',
    InternalChildren: [
        'mainStack', 'emptyPage', 'column', 'headerRevealer', 'toastOverlay',
    ],
}, class Window extends Adw.ApplicationWindow {

    _init(params) {
        super._init(Object.assign({
            icon_name: pkg.name,
        }, params));

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, 'recorder');

        const dispatcher = GstPlayer.PlayerGMainContextSignalDispatcher.new(null);
        this.player = GstPlayer.Player.new(null, dispatcher);
        this.player.connect('end-of-stream', _p => this.player.stop());


        this._recordingList = new RecordingList();
        this.itemsSignalId = this._recordingList.connect('items-changed', _ => {
            if (this.state !== WindowState.RECORDER) {
                if (this._recordingList.get_n_items() === 0)
                    this.state = WindowState.EMPTY;
                else
                    this.state = WindowState.LIST;
            }
        });

        this._recordingListWidget = new RecordingsListWidget(this._recordingList, this.player);

        this._recordingListWidget.connect('row-deleted', (_listBox, recording, index) => {
            this._recordingList.remove(index);
            this.sendNotification(_('"%s" deleted').format(recording.name), recording, index);
        });

        const builder = Gtk.Builder.new_from_resource('/dev/nicolas/DailyTaker/gtk/help-overlay.ui');
        const dialog = builder.get_object('help_overlay');
        this.set_help_overlay(dialog);

        this.toastUndo = false;
        this.undoSignalID = null;
        this.undoAction = new Gio.SimpleAction({ name: 'undo' });
        this.add_action(this.undoAction);

        let openMenuAction = new Gio.SimpleAction({ name: 'open-primary-menu', state: new GLib.Variant('b', true) });
        openMenuAction.connect('activate', action => {
            const state = action.get_state().get_boolean();
            action.state = new GLib.Variant('b', !state);
        });
        this.add_action(openMenuAction);
        this._column.set_child(this._recordingListWidget);

        this.recorderWidget.connect('started', this.onRecorderStarted.bind(this));
        this.recorderWidget.connect('canceled', this.onRecorderCanceled.bind(this));
        this.recorderWidget.connect('stopped', this.onRecorderStopped.bind(this));
        this.insert_action_group('recorder', this.recorderWidget.actionsGroup);
        this._emptyPage.icon_name = `${pkg.name}-symbolic`;
    }

    vfunc_close_request() {
        this._recordingList.cancellable.cancel();
        if (this.itemsSignalId)
            this._recordingList.disconnect(this.itemsSignalId);

        for (let i = 0; i < this._recordingList.get_n_items(); i++) {
            const recording = this._recordingList.get_item(i);
            if (recording.pipeline)
                recording.pipeline.set_state(Gst.State.NULL);
        }

        this.recorder.stop();
        this.application.quit();
    }

    onRecorderStarted() {
        this.player.stop();

        const activeRow = this._recordingListWidget.activeRow;
        if (activeRow && activeRow.editMode)
            activeRow.editMode = false;

        this.state = WindowState.RECORDER;
    }

    onRecorderCanceled() {
        if (this._recordingList.get_n_items() === 0)
            this.state = WindowState.EMPTY;
        else
            this.state = WindowState.LIST;
    }

    onRecorderStopped(widget, recording) {
        this._recordingList.insert(0, recording);
        this._recordingListWidget.list.get_row_at_index(0).editMode = true;
        this.state = WindowState.LIST;
    }

    sendNotification(message, recording, index) {
        const toast = Adw.Toast.new(message);
        toast.connect('dismissed', () => {
            if (!this.toastUndo)
                recording.delete();

            this.toastUndo = false;
        });

        if (this.undoSignalID !== null)
            this.undoAction.disconnect(this.undoSignalID);

        this.undoSignalID = this.undoAction.connect('activate', () => {
            this._recordingList.insert(index, recording);
            this.toastUndo = true;
        });

        toast.set_action_name('win.undo');
        toast.set_button_label(_('Undo'));
        this._toastOverlay.add_toast(toast);
    }

    set state(state) {
        let visibleChild;
        let isHeaderVisible;

        switch (state) {
        case WindowState.RECORDER:
            visibleChild = 'recorder';
            isHeaderVisible = false;
            break;
        case WindowState.LIST:
            visibleChild = 'recordings';
            isHeaderVisible = true;
            break;
        case WindowState.EMPTY:
            visibleChild = 'empty';
            isHeaderVisible = true;
            break;
        }

        this._mainStack.visible_child_name = visibleChild;
        this._headerRevealer.reveal_child = isHeaderVisible;
        this._state = state;
    }

    get state() {
        return this._state;
    }
});
