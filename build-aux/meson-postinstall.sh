#!/bin/bash

set -eu
# Keep the fork's schema inside its own extension directory, including in zips.
glib-compile-schemas --strict "${DESTDIR:-}${1}"
