# Vinyl Sim

Cut audio into a grooved 16-bit PNG record, then play it on a 3D phonograph.

[Open the player demo](https://snazzygaz.github.io/vinyl-sim/player.html) · [Cutter](https://snazzygaz.github.io/vinyl-sim/cutter.html)

The GitHub Pages demo cuts and plays records right in your browser, and the player starts with a sample record already on the platter. Run locally, the same pages use the Python server (`serve.py`) instead.

## Run it locally

Python 3.10+ and FFmpeg on your PATH:

```sh
python3 -m pip install -r requirements.txt
python3 serve.py --port 8765
```

Then open:

- [Home](http://127.0.0.1:8765/)
- [Cutter](http://127.0.0.1:8765/cutter)
- [Player](http://127.0.0.1:8765/player)

On Windows you can double-click `start-windows.bat`. The server stays on this computer; the 3D player loads Three.js from a CDN.

## Cutter

Choose an audio file (or the bundled 11-second tune) and press Cut. You get:

- `name.png` — the 16-bit height-map record
- `name.groove.wav` and `name.json` — the vector groove master (keep these beside the PNG)
- `name.preview.png` — an 8-bit viewing picture (not a playable record)

## Player

Open the 16-bit PNG, and add its `.groove.wav` and `.json` when you have them. Lift and drop the tonearm to stop and start, click a groove to drop the needle there, or hold the disc and drag to scratch. Loaded records wait in sleeves; drag one onto the platter to swap.

A PNG on its own is traced from its pixels and sounds deliberately lo-fi. This is a digital stylus.

## Credit

[Garyck Arntzen](https://www.garyckarntzen.com/) · [@_mintydoge](https://x.com/_mintydoge)
