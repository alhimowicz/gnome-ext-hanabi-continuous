// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Logger} from './logger.js';

const logger = new Logger('rotation');

// Scheduling belongs to GNOME Shell, so a blocked video driver cannot stop it.
export class WallpaperRotation {
    private timerId = 0;
    private signalIds: number[] = [];

    constructor(private settings: Gio.Settings) {}

    start(): void {
        this.stop();
        for (const key of ['change-wallpaper', 'change-wallpaper-interval', 'change-wallpaper-directory-path'])
            this.signalIds.push(this.settings.connect(`changed::${key}`, () => this.reset()));
        this.reset();
    }

    stop(): void {
        if (this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        for (const id of this.signalIds)
            this.settings.disconnect(id);
        this.signalIds = [];
    }

    private reset(): void {
        if (this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        if (!this.settings.get_boolean('change-wallpaper'))
            return;
        this.timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this.settings.get_int('change-wallpaper-interval') * 60,
            () => {
                this.advance();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    private advance(): void {
        const directory = Gio.File.new_for_path(this.settings.get_string('change-wallpaper-directory-path'));
        const videos: string[] = [];
        try {
            const files = directory.enumerate_children('standard::name,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
            try {
                let info: Gio.FileInfo | null;
                while ((info = files.next_file(null))) {
                    if (info.get_content_type()?.startsWith('video/')) {
                        const path = directory.get_child(info.get_name()).get_path();
                        if (path)
                            videos.push(path);
                    }
                }
            } finally {
                files.close(null);
            }
        } catch (error) {
            logger.warn(`Unable to read wallpaper directory: ${error}`);
            return;
        }
        if (videos.length === 0)
            return;
        videos.sort();
        const current = videos.indexOf(this.settings.get_string('video-path'));
        const mode = this.settings.get_int('change-wallpaper-mode');
        let next = 0;
        if (mode === 2) {
            next = current < 0 ? Math.floor(Math.random() * videos.length)
                : (current + 1 + Math.floor(Math.random() * (videos.length - 1))) % videos.length;
        } else if (current >= 0) {
            next = (current + (mode === 1 ? videos.length - 1 : 1)) % videos.length;
        }
        this.settings.set_string('video-path', videos[next]);
        logger.debug(`Selected ${videos[next]}`);
    }
}
