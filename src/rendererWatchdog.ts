// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {APPLICATION_ID, RENDERER_OBJECT_PATH} from './constants.js';
import type {WaylandSubprocess} from './waylandSubprocess.js';
import {Logger} from './logger.js';

const logger = new Logger('watchdog');
const CHECK_INTERVAL_SECONDS = 15;
const RESPONSE_TIMEOUT_MS = 5000;

export class RendererWatchdog {
    private timerId = 0;
    private request: Gio.Cancellable | null = null;

    constructor(private getProcess: () => WaylandSubprocess | null, private restart: () => void) {}

    start(): void {
        this.stop();
        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_INTERVAL_SECONDS, () => {
            this.check();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop(): void {
        if (this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        this.request?.cancel();
        this.request = null;
    }

    private check(): void {
        const process = this.getProcess();
        if (!process?.subprocess || this.request)
            return;
        const request = new Gio.Cancellable();
        this.request = request;
        // Reading this JS property requires the GTK main loop to respond.
        // D-Bus Peer.Ping can be answered without dispatching the GTK main loop.
        Gio.DBus.session.call(APPLICATION_ID, RENDERER_OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [APPLICATION_ID, 'isPlaying']), null, Gio.DBusCallFlags.NONE,
            RESPONSE_TIMEOUT_MS, request, (connection, result) => {
                let failed = false;
                try {
                    connection!.call_finish(result);
                } catch {
                    failed = true;
                }
                if (this.request !== request)
                    return;
                this.request = null;
                if (failed && this.getProcess() === process) {
                    logger.warn('Renderer stopped responding; restarting it');
                    this.restart();
                }
            });
    }
}
