const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const source = fs.readFileSync(process.env.HANABI_EXTENSION_SOURCE ?? path.join(__dirname, '../src/extension.ts'), 'utf8');
const compiled = esbuild.transformSync(source, {loader: 'ts', format: 'cjs'}).code;

function harness(startingUp = false) {
    class Emitter {
        handlers = new Map();
        nextId = 1;
        connect(signal, callback) {
            const id = this.nextId++;
            this.handlers.set(id, {signal, callback});
            return id;
        }
        disconnect(id) { this.handlers.delete(id); }
        emit(signal) {
            for (const handler of [...this.handlers.values()]) {
                if (handler.signal === signal)
                    handler.callback(this);
            }
        }
    }
    class Settings extends Emitter {
        values = {'startup-delay': 1000, 'video-path': '/pack/videos/gif_01.webm', 'show-on-lock-screen': true};
        get_int(key) { return this.values[key] ?? 0; }
        get_string(key) { return this.values[key] ?? ''; }
        get_boolean(key) { return this.values[key] ?? false; }
        set_string(key, value) {
            this.values[key] = value;
            this.emit(`changed::${key}`);
        }
        delay() {}
        apply() {}
    }
    const settings = new Settings();
    const background = new Settings();
    const timers = new Map();
    let timerId = 1;
    let activeOverrides = 0;
    let rendererStarts = 0;
    const main = {layoutManager: new Emitter(), sessionMode: new Emitter()};
    main.layoutManager._startingUp = startingUp;
    main.sessionMode.currentMode = 'user';
    class Component { enable() {} disable() {} }
    class Override extends Component {
        enable() { activeOverrides++; }
        disable() { activeOverrides--; }
    }
    class BaseExtension { getSettings() { return settings; } }
    const glib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        timeout_add(_priority, _delay, callback) {
            const id = timerId++;
            timers.set(id, callback);
            return id;
        },
        source_remove(id) { return timers.delete(id); },
        path_get_basename: path.basename,
        path_get_dirname: path.dirname,
        build_filenamev: parts => path.join(...parts),
    };
    const gio = {
        Settings: {new: () => background},
        File: {new_for_path: filename => ({
            query_exists: () => ['/pack/stills/gif_01.png', '/pack/stills/gif_02.png'].includes(filename),
            get_uri: () => `file://${filename}`,
        })},
    };
    const modules = {
        'gi://Gio': gio,
        'gi://GLib': glib,
        'resource:///org/gnome/shell/ui/main.js': main,
        'resource:///org/gnome/shell/extensions/extension.js': {Extension: BaseExtension},
        './gnomeShellOverride.js': {GnomeShellOverride: Override},
        './waylandSubprocess.js': {WaylandSubprocess: Component},
        './windowManager.js': {WindowManager: Component},
        './playbackState.js': {PlaybackState: Component},
        './wallpaperRotation.js': {WallpaperRotation: class {start() {} stop() {}}},
        './rendererWatchdog.js': {RendererWatchdog: class {start() {} stop() {}}},
        './autoPause.js': {AutoPause: Component},
        './panelMenu.js': {HanabiPanelMenu: Component},
        './settings.js': {migrateSettings() {}},
        './logger.js': {Logger: class {debug() {}}},
    };
    const sandbox = {TextDecoder, module: {exports: {}}, require: name => {
        assert.ok(name in modules, `Unexpected module: ${name}`);
        return modules[name];
    }};
    vm.runInNewContext(compiled, sandbox);
    const Extension = sandbox.module.exports.default;
    const cleanOrphans = Extension.prototype.killAllProcesses;
    Extension.prototype.killAllProcesses = function () {};
    Extension.prototype.launchRenderer = function () { rendererStarts++; };
    const extension = new Extension();
    return {
        extension, settings, background, main, timers, gio,
        cleanOrphans: () => cleanOrphans.call(extension),
        get activeOverrides() { return activeOverrides; },
        get rendererStarts() { return rendererStarts; },
        runTimers() {
            for (const [id, callback] of [...timers]) {
                timers.delete(id);
                callback();
            }
        },
    };
}

{
    const h = harness();
    h.extension.enable();
    assert.equal(h.activeOverrides, 1, 'Install hooks synchronously in GNOME extension order');
    assert.equal(h.rendererStarts, 0, 'Keep the renderer startup delay');
    h.runTimers();
    assert.equal(h.rendererStarts, 1);
    h.extension.disable();
    assert.equal(h.activeOverrides, 0);
    assert.equal(h.timers.size, 0);
    console.log('PASS: synchronous hooks, delayed renderer, clean shutdown');
}
{
    const h = harness();
    for (let rebase = 0; rebase < 6; rebase++) {
        h.extension.enable();
        h.extension.disable();
        assert.equal(h.timers.size, 0, 'Cancel pending startup on each lock-screen rebase');
        assert.equal(h.activeOverrides, 0);
    }
    h.extension.enable();
    assert.equal(h.activeOverrides, 1);
    assert.equal(h.timers.size, 1);
    h.runTimers();
    assert.equal(h.rendererStarts, 1, 'Launch only once after all rebases');
    console.log('PASS: repeated lock-screen rebases do not stack hooks or renderer startups');
}
{
    const h = harness(true);
    h.extension.enable();
    assert.equal(h.activeOverrides, 1);
    assert.equal(h.timers.size, 0);
    h.main.layoutManager.emit('startup-complete');
    assert.equal(h.timers.size, 1);
    h.extension.disable();
    h.runTimers();
    h.main.layoutManager.emit('startup-complete');
    assert.equal(h.rendererStarts, 0);
    assert.equal(h.timers.size, 0);
    console.log('PASS: disabled extension cannot start from an old session startup signal');
}
{
    const h = harness();
    h.extension.enable();
    assert.equal(h.background.get_string('picture-uri'), 'file:///pack/stills/gif_01.png');
    assert.equal(h.background.get_string('picture-uri-dark'), 'file:///pack/stills/gif_01.png');
    h.settings.set_string('video-path', '/pack/videos/gif_02.webm');
    assert.equal(h.background.get_string('picture-uri'), 'file:///pack/stills/gif_02.png');
    assert.equal(h.background.get_string('picture-uri-dark'), 'file:///pack/stills/gif_02.png');
    h.settings.set_string('video-path', '/elsewhere/video.mp4');
    assert.equal(h.background.get_string('picture-uri'), 'file:///pack/stills/gif_02.png');
    h.extension.disable();
    h.settings.set_string('video-path', '/pack/videos/gif_01.webm');
    assert.equal(h.background.get_string('picture-uri'), 'file:///pack/stills/gif_02.png');
    console.log('PASS: wallpaper rotation synchronizes panel/lock-screen fallback and disconnects on disable');
}
{
    const h = harness();
    h.extension.path = '/pack/hanabi';
    const renderer = '/pack/hanabi/renderer/renderer.js';
    const processes = {
        101: ['gjs', '-m', renderer, '-F', '/pack/videos/gif_01.webm'],
        102: ['/usr/bin/gjs', renderer],
        103: ['gjs', '-m', '/somewhere/else/renderer.js'],
        104: ['node', renderer],
        105: ['gjs', '-m', renderer + '.unrelated'],
        106: null,
    };
    const killed = [];
    h.gio.FileQueryInfoFlags = {NONE: 0};
    h.gio.Subprocess = class {
        constructor({argv}) { assert.equal(argv[1], '-KILL'); killed.push(argv[2]); }
        init() {}
        wait() {}
    };
    h.gio.File.new_for_path = filename => {
        if (filename === '/proc') {
            return {
                query_exists: () => true,
                enumerate_children: () => {
                    const iterator = Object.keys(processes)[Symbol.iterator]();
                    return {next_file: () => {
                        const next = iterator.next();
                        return next.done ? null : {get_name: () => next.value};
                    }};
                },
            };
        }
        const pid = filename.split('/')[2];
        return {
            query_exists: () => true,
            load_bytes: () => {
                if (!processes[pid]) throw new Error('Process exited');
                const bytes = new Uint8Array(Buffer.from(processes[pid].join('\0') + '\0'));
                return [{get_data: () => bytes}];
            },
        };
    };
    h.cleanOrphans();
    assert.deepEqual(killed, ['101', '102']);
    console.log('PASS: orphan cleanup recognizes gjs -m, preserves other programs, tolerates exited processes');
}
