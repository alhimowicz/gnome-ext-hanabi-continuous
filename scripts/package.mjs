// SPDX-License-Identifier: GPL-3.0-or-later
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uuid = 'hanabi-continuous@alhimowicz.github.io';
const staging = mkdtempSync(path.join(tmpdir(), 'hanabi-continuous-package-'));
function run(command, args, cwd = root) {
    execFileSync(command, args, {cwd, stdio: 'inherit'});
}
try {
    const args = ['setup', '.build-package', '--prefix=/usr'];
    if (existsSync(path.join(root, '.build-package/meson-private/coredata.dat')))
        args.push('--reconfigure');
    run('meson', args);
    run('meson', ['install', '-C', '.build-package', '--destdir', staging]);
    mkdirSync(path.join(root, 'dist'), {recursive: true});
    const archive = path.join(root, 'dist', `${uuid}.shell-extension.zip`);
    rmSync(archive, {force: true});
    run('zip', ['-qr', archive, '.'], path.join(staging, 'usr/share/gnome-shell/extensions', uuid));
    process.stdout.write(`Packaged ${archive}\n`);
} finally {
    rmSync(staging, {recursive: true, force: true});
}
