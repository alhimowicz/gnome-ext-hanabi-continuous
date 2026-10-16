#!/bin/sh
# SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
# SPDX-FileCopyrightText: 2020 Philip Chimento <philip.chimento@gmail.com>
# SPDX-FileCopyrightText: 2025 Florian Müllner <fmuellner@gnome.org>
cd "$(dirname -- "$0")/.." || exit 1
exec ./node_modules/.bin/eslint src/ "$@"
