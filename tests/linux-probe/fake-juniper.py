#!/usr/bin/env python3
"""Stand-in launches for scripts/test-linux-launch-probe.sh.

Each mode imitates one way a Linux launch can look alive without being usable,
so the probe is proven to reject it. Nothing here ships with Juniper.
"""

import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

READY = "[juniper-startup] frontend ready"
mode = sys.argv[1]


def emit(line):
    print(line, file=sys.stderr, flush=True)


def draw_rendered(_widget, cr):
    # Deterministic structure with many distinct colours, standing in for a
    # rendered interface.
    for index in range(48):
        cr.set_source_rgb((index * 37 % 255) / 255, (index * 91 % 255) / 255, (index * 53 % 255) / 255)
        cr.rectangle((index % 8) * 160, (index // 8) * 136, 150, 126)
        cr.fill()
    return False


def draw_blank(_widget, cr):
    cr.set_source_rgb(10 / 255, 10 / 255, 10 / 255)
    cr.paint()
    return False


window = Gtk.Window(title="Juniper")
window.set_default_size(1280, 820)
area = Gtk.DrawingArea()
window.add(area)
window.connect("destroy", Gtk.main_quit)

if mode == "rendered":
    area.connect("draw", draw_rendered)
    GLib.timeout_add(1500, lambda: emit(READY) or False)
elif mode == "window-never-ready":
    area.connect("draw", draw_rendered)
elif mode == "blank-ready":
    area.connect("draw", draw_blank)
    GLib.timeout_add(1500, lambda: emit(READY) or False)
elif mode == "fatal-after-ready":
    area.connect("draw", draw_rendered)
    GLib.timeout_add(1500, lambda: emit(READY) or False)
    GLib.timeout_add(3000, lambda: emit("[juniper-startup] frontend fatal: ReferenceError: x is not defined") or False)
else:
    raise SystemExit(f"unknown mode {mode}")

window.show_all()
Gtk.main()
