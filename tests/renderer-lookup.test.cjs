const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const sourcePath = process.argv[2] ?? require('node:path').join(__dirname, '../src/gnomeShellOverride.ts');
const code = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {loader: 'ts', format: 'cjs'}).code;
function stub(methods = {}) {
    class C {}
    Object.assign(C.prototype, methods);
    return C;
}
const WindowActor = stub();
const renderer = Object.assign(new WindowActor(), {meta_window: {title: '@io.github.alhimowicz.HanabiContinuousRenderer!{}|0'}});
const regular = Object.assign(new WindowActor(), {meta_window: {title: 'Regular application'}});
const shell = {
    Global: stub({get_window_actors() { return [regular]; }}),
    WindowTracker: stub(), App: stub(), AppSystem: stub(),
};
// Simulate old hooks remaining after a lock-screen rebase.
for (let layer = 0; layer < 4; layer++) {
    const original = shell.Global.prototype.get_window_actors;
    shell.Global.prototype.get_window_actors = function () { return original.call(this); };
}
const globalObject = new shell.Global();
globalObject.compositor = {get_window_actors: () => [regular, renderer]};
class InjectionManager {
    saved = [];
    overrideMethod(prototype, name, factory) {
        this.saved.push([prototype, name, prototype[name]]);
        prototype[name] = factory(prototype[name]);
    }
    clear() {
        for (const [prototype, name, original] of this.saved.reverse())
            prototype[name] = original;
        this.saved = [];
    }
}
const modules = {
    'gi://Clutter': {}, 'gi://Meta': {WindowActor, Display: stub()},
    'gi://St': {}, 'gi://Shell': shell, 'gi://GLib': {}, 'gi://Gio': {},
    'resource:///org/gnome/shell/extensions/extension.js': {InjectionManager},
    'resource:///org/gnome/shell/ui/background.js': {BackgroundManager: stub()},
    'resource:///org/gnome/shell/ui/main.js': {},
    'resource:///org/gnome/shell/ui/workspace.js': {WorkspaceBackground: stub(), Workspace: stub()},
    'resource:///org/gnome/shell/ui/workspaceThumbnail.js': {WorkspaceThumbnail: stub()},
    './wallpaper.js': {LiveWallpaper: stub()},
    './constants.js': {APPLICATION_ID: 'io.github.alhimowicz.HanabiContinuousRenderer'},
    './logger.js': {Logger: class {debug() {}}},
};
const sandbox = {module: {exports: {}}, global: globalObject, require: name => {
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
}};
vm.runInNewContext(code, sandbox);
const instance = new sandbox.module.exports.GnomeShellOverride({connect: () => 1, disconnect() {}});
instance.reloadBackgrounds = () => {};
for (let rebase = 0; rebase < 4; rebase++) {
    instance.enable();
    const allActors = instance.getAllWindowActors();
    assert.ok(allActors.includes(renderer), 'Wallpaper must find the renderer even when old Shell hooks filter it out');
    assert.equal(allActors.length, 2);
    assert.equal(globalObject.get_window_actors().length, 1, 'App lists must continue to hide the renderer');
    instance.disable();
}
console.log('PASS: compositor lookup finds the renderer through stale filters and repeated rebases');
