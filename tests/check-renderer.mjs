import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Run the actual renderer with real GSettings/Gio and a memory settings backend.
// Replace only its application entry point so tests can control timer callbacks
// without opening windows or altering the desktop's settings.
const root = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = resolve(process.argv[2] ?? join(root, 'src/_build/renderer.js'));
const fixtures = mkdtempSync(join(tmpdir(), 'hanabi-continuous-fixtures-'));
for (let i = 0; i < 5; i++)
    symlinkSync(join(root, 'tests/fixtures/clip.webm'), join(fixtures, `clip-${i}.webm`));
const videoDirectory = process.argv[3] ?? fixtures;
const source = readFileSync(sourcePath, 'utf8');
assert.ok(source.endsWith('renderer.run(ARGV);\n'));
const checks = String.raw`
check(extSettings !== null, 'bundled schema must load without a global installation');
check(!Gio.SettingsSchemaSource.get_default()?.lookup(SETTINGS_SCHEMA, true), 'test must not rely on a globally installed fork schema');
print('PASS: renderer loads its bundled schema without a global installation');

function check(condition, message) {
    if (!condition)
        throw new Error(message);
}

const timers = new Map();
let nextTimerId = 1;
GLib.timeout_add_seconds = (_priority, seconds, callback) => {
    const id = nextTimerId++;
    timers.set(id, {seconds, callback});
    return id;
};
GLib.source_remove = id => {
    check(timers.delete(id), 'timer must exist when removed');
    return true;
};

const dir = Gio.File.new_for_path(ARGV[0]);
const files = dir.enumerate_children('standard::name,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
const videos = [];
let info;
while ((info = files.next_file(null))) {
    if (info.get_content_type()?.startsWith('video/'))
        videos.push(dir.get_child(info.get_name()).get_path());
}
files.close(null);
videos.sort();
check(videos.length >= 3, 'fixture requires at least three videos');

let plays = 0;
let pauses = 0;
const player = {
    set_uri(uri) { this.uri = uri; },
    play() { plays++; },
    pause() { pauses++; },
};
renderer.play = player;
extSettings.set_string('change-wallpaper-directory-path', ARGV[0]);
extSettings.set_string('video-path', videos[0]);
extSettings.set_int('change-wallpaper-interval', 10);
extSettings.set_int('change-wallpaper-mode', 0);
renderer.setPause();
extSettings.set_boolean('change-wallpaper', true);
function tick() {
    check(timers.size === 1, 'exactly one rotation timer should exist');
    check([...timers.values()][0].callback() === GLib.SOURCE_CONTINUE, 'rotation must keep repeating');
}
function current() { return extSettings.get_string('video-path'); }
check(current() === videos[0], 'enabling rotation must wait for the interval');
check([...timers.values()][0].seconds === 600, '10 minutes must schedule 600 seconds');
const playsBefore = plays;
tick();
check(current() === videos[1], 'first interval must advance while playback is paused');
check(plays === playsBefore && pauses >= 2, 'rotation must preserve paused playback');
print('PASS: first interval advances while paused and preserves the pause');

extSettings.set_string('video-path', videos[4 % videos.length]);
tick();
check(current() === videos[5 % videos.length], 'sequential rotation must follow a manual selection');
extSettings.set_int('change-wallpaper-mode', 1);
extSettings.set_string('video-path', videos[0]);
tick();
check(current() === videos[videos.length - 1], 'reverse rotation must wrap from the current video');
extSettings.set_int('change-wallpaper-mode', 2);
for (let i = 0; i < 100; i++) {
    const previous = current();
    tick();
    check(current() !== previous, 'random rotation must not immediately repeat');
}
print('PASS: sequential, reverse, random, and manual-selection behavior');

const beforeIntervalChange = current();
for (const minutes of [1, 3, 10]) {
    extSettings.set_int('change-wallpaper-interval', minutes);
    check(timers.size === 1, 'interval changes must replace the timer');
    check([...timers.values()][0].seconds === minutes * 60, 'interval change must update the delay');
    check(current() === beforeIntervalChange, 'interval edits must not immediately switch wallpaper');
}
const temporary = GLib.dir_make_tmp('hanabi-interval-check-XXXXXX');
try {
    extSettings.set_string('change-wallpaper-directory-path', temporary);
    check(timers.size === 0, 'empty directory must cancel the old timer');
    extSettings.set_string('change-wallpaper-directory-path', ARGV[0]);
    check(timers.size === 1, 'restoring a valid directory must recreate the timer');
    extSettings.set_string('change-wallpaper-directory-path', temporary + '/missing');
    check(timers.size === 0, 'invalid directory must cancel the old timer');
    extSettings.set_boolean('change-wallpaper', false);
    check(timers.size === 0, 'disabling with an invalid directory must leave no stale timer');
    extSettings.set_string('change-wallpaper-directory-path', ARGV[0]);
    extSettings.set_boolean('change-wallpaper', true);
    check(timers.size === 1, 'reenabling must recreate one timer');
    extSettings.set_boolean('change-wallpaper', false);
    check(timers.size === 0, 'disabling with a valid directory must cancel the timer');
} finally {
    Gio.File.new_for_path(temporary).delete(null);
}
print('PASS: interval updates, empty/missing directories, disable and reenable');

renderer.setPlay();
renderer.playing = false; // Backend state signals can lag behind the request.
let before = plays;
renderer.setFilePath(videos[0]);
check(plays === before + 1, 'a pending play request must survive video changes');
renderer.setPause();
before = plays;
renderer.setFilePath(videos[1]);
check(plays === before, 'a paused GStreamer backend must stay paused');
renderer.play = null;
renderer.media = {
    file: null,
    stream_unprepared() {},
    play() { plays++; },
    pause() { pauses++; },
};
renderer.setFilePath(videos[0]);
check(plays === before, 'a paused GtkMediaFile backend must stay paused');
renderer.setPlay();
before = plays;
renderer.setFilePath(videos[1]);
check(plays === before + 1, 'a playing GtkMediaFile backend must keep playing');
print('PASS: requested play/pause state survives changes for both backends');

const originalSource = Gio.SettingsSchemaSource.new_from_directory(ARGV[1], Gio.SettingsSchemaSource.get_default(), false);
const originalSchema = originalSource.lookup('io.github.jeffshee.hanabi-extension', true);
const original = new Gio.Settings({settings_schema: originalSchema});
original.set_boolean('mute', true);
original.set_int('volume', 75);
original.set_int('change-wallpaper-interval', 7);
const getDefaultSource = Gio.SettingsSchemaSource.get_default;
Gio.SettingsSchemaSource.get_default = () => originalSource;
try {
    migrateSettings(extSettings);
    check(extSettings.get_boolean('mute'), 'migration must copy existing preferences');
    check(extSettings.get_int('volume') === 75, 'migration must copy volume');
    check(extSettings.get_int('change-wallpaper-interval') === 10, 'migration must preserve fork preferences');
    check(extSettings.get_boolean('settings-migrated'), 'migration must be marked complete');
    original.set_int('volume', 20);
    migrateSettings(extSettings);
    check(extSettings.get_int('volume') === 75, 'migration must only run once');
    extSettings.set_int('volume', 55);
    const observer = new Gio.Settings({settings_schema: extSettings.settings_schema});
    check(observer.get_int('volume') === 55, 'migration must not leave subsequent preference writes delayed');
} finally {
    Gio.SettingsSchemaSource.get_default = getDefaultSource;
}
print('PASS: settings migration preserves fork preferences and runs only once');

`;
const temporary = mkdtempSync(join(tmpdir(), 'hanabi-interval-run-'));
try {
    const script = join(temporary, 'check.js');
    const schemas = dirname(sourcePath).endsWith('/renderer')
        ? join(dirname(dirname(sourcePath)), 'schemas') : join(dirname(sourcePath), 'schemas');
    cpSync(schemas, join(temporary, 'schemas'), {recursive: true});
    mkdirSync(join(temporary, 'empty-data'));
    // Isolate GSettings while keeping Gio's MIME database for real video discovery.
    symlinkSync('/usr/share/mime', join(temporary, 'empty-data/mime'));
    mkdirSync(join(temporary, 'old-schemas'));
    cpSync(join(root, 'tests/fixtures/original.gschema.xml'), join(temporary, 'old-schemas/original.gschema.xml'));
    const compile = spawnSync('glib-compile-schemas', [join(temporary, 'old-schemas')]);
    assert.equal(compile.status, 0);
    writeFileSync(script, source.slice(0, -'renderer.run(ARGV);\n'.length) + checks);
    const result = spawnSync('gjs', ['-m', script, videoDirectory, join(temporary, 'old-schemas')], {
        env: {...process.env, GSETTINGS_BACKEND: 'memory', GIO_USE_VFS: 'local', XDG_DATA_DIRS: join(temporary, 'empty-data'), XDG_DATA_HOME: join(temporary, 'empty-data')},
        encoding: 'utf8',
        timeout: 20000,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error)
        throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    rmSync(temporary, {recursive: true, force: true});
    rmSync(fixtures, {recursive: true, force: true});
}
