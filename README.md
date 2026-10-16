# Hanabi Continuous

Animated video wallpapers for **GNOME 50 on Wayland**, maintained as an independent
fork of [Jeff Shee's Hanabi](https://github.com/jeffshee/gnome-ext-hanabi).

This fork fixes wallpaper rotation that stalled during paused playback, renderer
windows disappearing from the wallpaper's window lookup, and delayed extension
hooks accumulating during lock-screen rebases. Video changes preserve the chosen
playback state, and matching still images keep the panel and lock-screen fallback
in sync. Automatic pausing is disabled by default.

It installs separately from Hanabi, so upstream Hanabi updates cannot overwrite it.

| Component | Identity |
| --- | --- |
| Extension | `hanabi-continuous@alhimowicz.github.io` |
| Settings | `io.github.alhimowicz.hanabi-continuous` |
| Renderer / D-Bus service | `io.github.alhimowicz.HanabiContinuousRenderer` |

## Install

Download the extension zip from [Releases](https://github.com/alhimowicz/gnome-ext-hanabi-continuous/releases)
and install it:

```sh
gnome-extensions install --force hanabi-continuous@alhimowicz.github.io.shell-extension.zip
```

Sign out and back in so GNOME discovers the new extension, then switch over:

```sh
gnome-extensions disable hanabi-extension@jeffshee.github.io
gnome-extensions enable hanabi-continuous@alhimowicz.github.io
gnome-extensions prefs hanabi-continuous@alhimowicz.github.io
```

Keep only one wallpaper extension enabled. Existing Hanabi preferences are imported
once on first activation, without replacing preferences already set in this fork.
The original extension and its settings remain available for rollback. If you
previously enabled any automatic pause options in Hanabi, turn them off in the new
preferences for continuous animation.

The renderer loads the settings schema bundled inside the extension. Installing a
system-wide schema or applying a separate startup patch is unnecessary. The enabled
extension and settings persist across login and reboot.

## Build and validate

Install Node.js 20+, npm, Meson, Ninja, gettext, GLib tools, GJS, GTK 4, and GStreamer.
The `gtk4paintablesink` GStreamer plugin is recommended for playback; GTK's media
backend is the fallback.

```sh
git clone https://github.com/alhimowicz/gnome-ext-hanabi-continuous.git
cd gnome-ext-hanabi-continuous
npm ci
npm run typecheck
npm run lint
npm test
npm run package
dbus-run-session -- npm run test:gjs
```

The installable zip is written to `dist/`. `make install` installs into the current
user's extension directory. Sign out and back in after source updates so GNOME loads
the new code.

The regression checks cover repeated enable/disable and startup cancellation,
unfiltered renderer discovery, interval changes, paused rotation, sequential and
random selection, both playback backends, bundled schema loading, and settings
migration. GJS checks use temporary fixtures and the in-memory settings backend;
they do not change desktop settings. The small WebM fixture is generated from
GStreamer's `videotestsrc` ball pattern.

## Updating and rollback

Install a new release zip and sign out and back in. Updates to this fork retain its
settings. Tags named `v*` build and publish an installable release through GitHub
Actions, with the same validation used locally.

To return to the original Hanabi:

```sh
gnome-extensions disable hanabi-continuous@alhimowicz.github.io
gnome-extensions enable hanabi-extension@jeffshee.github.io
```

For Blur My Shell application blur, add
`io.github.alhimowicz.HanabiContinuousRenderer` to its blacklist if necessary.

## Attribution and license

Hanabi is by **Jeff Shee and contributors**. This fork retains the upstream source
history, copyright notices, translations, artwork, and **GPL-3.0-or-later** license.
See [LICENSE](LICENSE) and the [upstream project](https://github.com/jeffshee/gnome-ext-hanabi).
