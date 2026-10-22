/* exported formatTime */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Meg Ford <megford@gnome.org>
 *
 */
const { Gst } = imports.gi;

var formatTime = nanoSeconds => {
    const time = new Date(0, 0, 0, 0, 0, 0, parseInt(nanoSeconds / Gst.MSECOND));

    const miliseconds = parseInt(time.getMilliseconds() / 100).toString();
    const seconds = time.getSeconds().toString().padStart(2, '0');
    const minutes = time.getMinutes().toString().padStart(2, '0');
    const hours = time.getHours().toString().padStart(2, '0');

    // eslint-disable-next-line no-irregular-whitespace
    return `${hours} ∶ ${minutes} ∶ ${seconds} . <small>${miliseconds}</small>`;
};
