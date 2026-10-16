// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SETTINGS_SCHEMA = 'io.github.alhimowicz.hanabi-continuous';
const ORIGINAL_SCHEMA = 'io.github.jeffshee.hanabi-extension';

/** Load schemas bundled with the extension, including in the standalone renderer. */
export function loadSettings(): Gio.Settings | null {
    const directory = Gio.File.new_for_uri(import.meta.url).get_parent();
    const candidates = [directory?.get_child('schemas'), directory?.get_parent()?.get_child('schemas')];
    let source = Gio.SettingsSchemaSource.get_default();
    for (const candidate of candidates) {
        if (candidate?.get_child('gschemas.compiled').query_exists(null)) {
            source = Gio.SettingsSchemaSource.new_from_directory(candidate.get_path()!, source, false);
            break;
        }
    }
    const schema = source?.lookup(SETTINGS_SCHEMA, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

/** Copy existing Hanabi preferences once, preserving any fork preferences. */
export function migrateSettings(settings: Gio.Settings): void {
    if (settings.get_boolean('settings-migrated'))
        return;

    let source = Gio.SettingsSchemaSource.get_default();
    const directory = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'extensions',
        'hanabi-extension@jeffshee.github.io', 'schemas',
    ]));
    if (directory.get_child('gschemas.compiled').query_exists(null))
        source = Gio.SettingsSchemaSource.new_from_directory(directory.get_path()!, source, false);
    const originalSchema = source?.lookup(ORIGINAL_SCHEMA, true);
    if (originalSchema) {
        const original = new Gio.Settings({settings_schema: originalSchema});
        for (const key of originalSchema.list_keys()) {
            if (!settings.settings_schema.has_key(key) || settings.get_user_value(key) !== null)
                continue;
            const value = original.get_user_value(key);
            if (value !== null && settings.settings_schema.get_key(key).range_check(value))
                settings.set_value(key, value);
        }
    }
    settings.set_boolean('settings-migrated', true);
}
