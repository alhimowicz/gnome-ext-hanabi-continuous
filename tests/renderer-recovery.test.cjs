const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const esbuild = require('esbuild');

function load(name, modules, extra = {}) {
    const code = esbuild.transformSync(readFileSync(path.join(__dirname, '../src', name), 'utf8'),
        {loader: 'ts', format: 'cjs'}).code;
    const context = {module: {exports: {}}, ...extra, require: specifier => {
        assert.ok(specifier in modules, `Unexpected import: ${specifier}`);
        return modules[specifier];
    }};
    vm.runInNewContext(code, context);
    return context.module.exports;
}

function timers() {
    const pending = new Map();
    let nextId = 1;
    const add = (_priority, delay, callback) => {
        const id = nextId++;
        pending.set(id, {delay, callback});
        return id;
    };
    return {pending, glib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        timeout_add: add, timeout_add_seconds: add, getenv: () => 'gles-api',
        source_remove: id => pending.delete(id)},
    tick() {
        for (const [id, {callback}] of [...pending]) {
            if (!callback())
                pending.delete(id);
        }
    }};
}
class Cancellable {
    cancelled = false;
    cancel() { this.cancelled = true; }
}
const logger = {Logger: class {warn() {} debug() {} trace() {} log() {}}};

function watchdog() {
    const clock = timers();
    const requests = [];
    let process = {subprocess: {}};
    let restarts = 0;
    const connection = {
        call(...args) { requests.push({args, callback: args.at(-1)}); },
        call_finish(result) { if (result.error) throw new Error('Timed out'); return result; },
    };
    const {RendererWatchdog} = load('rendererWatchdog.ts', {
        'gi://GLib': {...clock.glib, Variant: class {constructor(type, value) {this.type = type; this.value = value;}}},
        'gi://Gio': {Cancellable, DBus: {session: connection}, DBusCallFlags: {NONE: 0}},
        './constants.js': {APPLICATION_ID: 'test.renderer', RENDERER_OBJECT_PATH: '/test/renderer'},
        './logger.js': logger,
    });
    const instance = new RendererWatchdog(() => process, () => restarts++);
    return {instance, clock, requests, replaceProcess() { process = {subprocess: {}}; },
        get restarts() { return restarts; },
        finish(index, error = false) { requests[index].callback(connection, {error}); },
    };
}

test('watchdog detects an unresponsive GTK main loop with a bounded property request', () => {
    const h = watchdog();
    h.instance.start();
    h.clock.tick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].args[2], 'org.freedesktop.DBus.Properties');
    assert.equal(h.requests[0].args[3], 'Get');
    assert.equal(h.requests[0].args[7], 5000);
    h.clock.tick();
    assert.equal(h.requests.length, 1, 'Do not overlap health requests');
    h.finish(0, true);
    assert.equal(h.restarts, 1, 'Restart the unresponsive renderer');
    h.instance.stop();
    assert.equal(h.clock.pending.size, 0);
});

test('late watchdog results cannot restart a replacement or a disabled extension', () => {
    const h = watchdog();
    h.instance.start();
    h.clock.tick();
    h.replaceProcess();
    h.finish(0, true);
    assert.equal(h.restarts, 0);
    h.clock.tick();
    const request = h.requests[1].args[8];
    h.instance.stop();
    assert.equal(request.cancelled, true);
    h.finish(1, true);
    assert.equal(h.restarts, 0);
});

test('paused but responsive playback is healthy and start does not stack timers', () => {
    const h = watchdog();
    h.instance.start();
    h.instance.start();
    assert.equal(h.clock.pending.size, 1);
    h.clock.tick();
    h.finish(0);
    assert.equal(h.restarts, 0);
    h.clock.tick();
    assert.equal(h.requests.length, 2);
    h.instance.stop();
});

function subprocess() {
    const clock = timers();
    const environment = new Map();
    const waits = [];
    const signals = [];
    let forced = 0;
    const process = {wait_async(cancellable, callback) {waits.push({cancellable, callback});},
        wait_finish() {}, get_stdout_pipe() {return {};}, send_signal(value) {signals.push(value);},
        force_exit() {forced++;}, get_identifier: () => '123'};
    const {WaylandSubprocess} = load('waylandSubprocess.ts', {
        'gi://GLib': clock.glib,
        'gi://Gio': {Cancellable, SubprocessFlags: {NONE: 0, STDOUT_PIPE: 1, STDERR_MERGE: 2},
            SubprocessLauncher: class {
                setenv(name, value) {environment.set(name, value);} close() {} set_cwd() {}
            },
            DataInputStream: {new: () => ({read_line_async() {}})},
        },
        'gi://Meta': {WaylandClient: {new_subprocess: () => ({get_subprocess: () => process})}},
        './logger.js': logger,
    }, {global: {context: {}}});
    const instance = new WaylandSubprocess();
    instance.spawn(['gjs', 'renderer.js']);
    return {instance, clock, signals, waits, environment, get forced() {return forced;},
        exit() { waits[0].callback(process, {}); },
    };
}

test('wallpaper process avoids Vulkan and DMA-BUF while preserving inherited GDK flags', () => {
    const h = subprocess();
    assert.equal(h.environment.get('GSK_RENDERER'), 'gl');
    const flags = h.environment.get('GDK_DISABLE').split(':');
    assert.ok(flags.includes('gles-api') && flags.includes('vulkan') && flags.includes('dmabuf'));
    h.exit();
});

test('hung renderer is forcibly terminated after the grace period', () => {
    const h = subprocess();
    assert.equal(h.waits[0].cancellable, null, 'Exit monitoring must survive output cancellation');
    h.instance.terminate();
    h.instance.terminate();
    assert.deepEqual(h.signals, [15]);
    assert.equal([...h.clock.pending.values()][0].delay, 2000);
    h.clock.tick();
    assert.equal(h.forced, 1);
    h.exit();
    assert.equal(h.instance.running, false);
});

test('graceful renderer exit cancels forced termination', () => {
    const h = subprocess();
    h.instance.terminate();
    h.exit();
    h.clock.tick();
    assert.equal(h.forced, 0);
    assert.equal(h.clock.pending.size, 0);
});
