const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const esbuild = require('esbuild');

function load(name, modules) {
    const code = esbuild.transformSync(readFileSync(path.join(__dirname, '../src', name), 'utf8'),
        {loader: 'ts', format: 'cjs'}).code;
    const context = {module: {exports: {}}, require: name => {
        assert.ok(name in modules, `Unexpected import: ${name}`);
        return modules[name];
    }};
    vm.runInNewContext(code, context);
    return context.module.exports;
}

const logger = {Logger: class {debug() {}}};

for (const version of [50, 51]) {
    test(`GNOME ${version} registers its supported shader and preserves scaled clipping`, () => {
        const uniforms = new Map();
        const uploads = [];
        const locations = new Map();
        let scale = 2;
        let width = 424;
        let paints = 0;
        let snippet;
        class OffscreenEffect {
            get_texture() { return {get_width: () => width, get_height: () => 244}; }
            get_actor() {
                return {get_resource_scale: () => scale, get_paint_volume: () => ({
                    get_origin: () => ({x: 0, y: 0}), get_width: () => 210, get_height: () => 120,
                })};
            }
            vfunc_paint_target() { paints++; }
        }
        class LegacyEffect extends OffscreenEffect {
            add_glsl_snippet(...args) { snippet = args; }
            get_uniform_location(name) {
                if (!locations.has(name)) locations.set(name, locations.size);
                return locations.get(name);
            }
            set_uniform_float(location, components, values) {
                assert.equal(typeof location, 'number');
                record([...locations].find(([, value]) => value === location)[0], components, values);
            }
        }
        class ModernEffect extends OffscreenEffect {
            set_uniform_float(name, components, values) {
                assert.equal(typeof name, 'string');
                record(name, components, values);
            }
        }
        function record(name, components, values) {
            assert.equal(components, values.length);
            uniforms.set(name, Array.from(values));
            uploads.push(name);
        }
        const {RoundedCornersEffect} = load('roundedCornersEffect.ts', {
            'gi://Clutter': {ShaderEffect: ModernEffect},
            'gi://Shell': version === 50 ? {GLSLEffect: LegacyEffect} : {},
            'gi://Cogl': {SnippetHook: {FRAGMENT: 1}, Snippet: {new: (...args) => args}},
            'gi://GLib': {timeout_add: () => 1, source_remove() {}},
            'gi://GObject': {registerClass(_metadata, klass) {
                if (Object.hasOwn(klass.prototype, 'vfunc_build_pipeline'))
                    assert.equal(version, 50, 'GNOME 51 rejects the GNOME 50 vfunc');
                if (Object.hasOwn(klass.prototype, 'vfunc_get_static_snippet'))
                    assert.equal(version, 51, 'GNOME 50 rejects the GNOME 51 vfunc');
                return klass;
            }},
            './logger.js': logger,
        });
        const effect = new RoundedCornersEffect();
        assert.ok(effect instanceof (version === 50 ? LegacyEffect : ModernEffect));
        if (version === 50) {
            effect.vfunc_build_pipeline();
            assert.equal(snippet[3], false);
        } else {
            snippet = effect.vfunc_get_static_snippet();
        }
        assert.equal(snippet[0], 1);
        assert.match(snippet[1], /uniform vec4 bounds/);
        assert.match(snippet[2], /cogl_color_out \*= rounded_rect_coverage/);

        effect.setBounds([10, 20, 210, 120]);
        effect.setClipRadius(10);
        effect.setBorderStroke(1);
        effect.setBorderColor([1, 0, 0, 1]);
        effect.vfunc_paint_target({}, {});
        assert.deepEqual(uniforms.get('bounds'), [24, 44, 424, 244]);
        assert.deepEqual(uniforms.get('pixel_step'), [1 / 424, 1 / 244]);
        assert.deepEqual(uniforms.get('clip_radius'), [20]);
        assert.deepEqual(uniforms.get('border_stroke'), [2]);
        assert.deepEqual(uniforms.get('border_color'), [1, 0, 0, 1]);
        const count = uploads.length;
        effect.vfunc_paint_target({}, {});
        assert.equal(uploads.length, count, 'Unchanged frames reuse their uniforms');
        assert.equal(paints, 2, 'Both frames reach the native paint method');
        scale = 1;
        width = 212;
        effect.vfunc_paint_target({}, {});
        assert.deepEqual(uniforms.get('bounds'), [12, 22, 212, 122]);
        assert.deepEqual(uniforms.get('pixel_step'), [1 / 212, 1 / 244]);
        effect.setClipRadius(4);
        effect.vfunc_paint_target({}, {});
        assert.deepEqual(uniforms.get('clip_radius'), [4]);
    });
}

test('all four D-Bus wrappers construct class-based proxies required by GNOME 51', () => {
    const calls = [];
    const modules = {
        'gi://Gio': {DBus: {session: 'session', system: 'system'}, DBusProxy: {
            makeProxyWrapper(xml) {
                assert.equal(typeof xml, 'string');
                return class Proxy {
                    constructor(...args) { calls.push(args); }
                };
            },
        }},
        'resource:///org/gnome/shell/misc/dbusUtils.js': {loadInterfaceXML: () => '<node/>'},
        './constants.js': {APPLICATION_ID: 'test.renderer', RENDERER_OBJECT_PATH: '/test/renderer'},
        './logger.js': logger,
    };
    const {RendererWrapper, UPowerWrapper, DBusWrapper, MprisWrapper} = load('dbus.ts', modules);
    new RendererWrapper();
    new UPowerWrapper();
    new DBusWrapper();
    new MprisWrapper('org.mpris.MediaPlayer2.test');
    assert.deepEqual(calls, [
        ['session', 'test.renderer', '/test/renderer'],
        ['system', 'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice'],
        ['session', 'org.freedesktop.DBus', '/org/freedesktop/DBus'],
        ['session', 'org.mpris.MediaPlayer2.test', '/org/mpris/MediaPlayer2'],
    ]);
    modules['resource:///org/gnome/shell/misc/dbusUtils.js'].loadInterfaceXML = () => null;
    assert.throws(() => new DBusWrapper(), /interface XML could not be loaded/);
});
