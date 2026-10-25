"""The palette (assets/rosa/palette.json): Sol's team colours and the shared ones, by name."""
import json
import os

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(_HERE, 'palette.json')) as fh:
    _P = json.load(fh)

COLORS = {}
for group in ('sol', 'shared'):
    for k, v in _P[group].items():
        COLORS.setdefault(k, v)


def hexval(name):
    return int(COLORS[name].lstrip('#'), 16)


def rgb(name):
    """sRGB floats 0..1 for a palette name."""
    h = hexval(name)
    return ((h >> 16 & 255) / 255.0, (h >> 8 & 255) / 255.0, (h & 255) / 255.0)


def check(name):
    if name not in COLORS:
        raise KeyError('not a palette colour: %s' % name)
    return name
