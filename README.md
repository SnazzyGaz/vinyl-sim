# Vinyl Sim

Cut audio into a grooved 16-bit PNG record, then play it on a 3D phonograph.

[Open The Room](https://snazzygaz.github.io/vinyl-sim/room.html) · [Player demo](https://snazzygaz.github.io/vinyl-sim/player.html) · [Cutter](https://snazzygaz.github.io/vinyl-sim/cutter.html)

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
- [The Room](http://127.0.0.1:8765/room)

On Windows you can double-click `start-windows.bat`. Everything runs offline: the server stays on this computer and Three.js r169 is bundled in `static/vendor/three` (MIT licence included).

Finished jobs in `output/` are cleared after 7 days (`--keep-days 0` keeps everything); a failed cut or import leaves nothing behind.

## The Room

`room.html` (The Room on the home page) is the whole app in one scene: cut, play, keep and save records without leaving the parlor. Drop a song anywhere, or click the stack of blanks on the bench, and it is cut on the lathe (a picture dropped with it becomes the cover). Finished records, and any record you open, are filed in the crate and stay there between visits, kept in this browser. Carry a sleeve over the cabinet and let go when the rim glows to play it; put sleeves down anywhere on the floor, or on the post tray to save the record. Press `?` in the room for the keys. It works the same on GitHub Pages and with `serve.py` (open `/room`).

## Cutter

Choose an audio file (or the bundled 11-second tune) and press Cut. Records hold up to 4:30; a longer song is cut to its first 4:30 — past that the groove gets so tight the raster trace turns to buzz. You get:

- `name.png` — the 16-bit height-map record
- `name.groove.wav` and `name.json` — the vector groove master (keep these beside the PNG)
- `name.preview.png` — an 8-bit viewing picture (not a playable record)

The song's title, artist and cover art are read from the file's tags (MP3, FLAC, M4A; anything else through FFmpeg when the local server is running). Pick a picture together with the audio (say `cover.jpg` from the album folder) to use that as the cover instead. They travel inside the record PNG, so the Player prints the cover on the label and the sleeve wherever the record is opened.

## Player

Open the 16-bit PNG, and add its `.groove.wav` and `.json` when you have them. Lift and drop the tonearm to stop and start, click a groove to drop the needle there, or hold the disc and drag to scratch. Loaded records wait in sleeves. Pick one up and carry it anywhere: let go on the floor and it stays there, lying flat; carry it over the cabinet and it is offered to the platter — the record slides half out and the rim glows — and letting go there plays it. The record you were playing goes back into its own sleeve, wherever that sleeve lies.

A PNG on its own is traced from its pixels and sounds deliberately lo-fi. This is a digital stylus.

The camera stays where you put it: swapping records, inspecting one and putting it back never reset the view (Reset view glides back to the default seat). **Picture** sets the rendering quality — Auto picks High (ambient occlusion, depth of field, bloom), Balanced or Low for your GPU and steps down if frames get slow. The scene only redraws when something moves, so an idle player uses almost no GPU.

## Tests

`python3 verify.py` (pipeline), `python3 test-http.py` (server), and `node test-vinyl-core.cjs`, `node test-player.cjs`, `node test-player-pages.cjs`, `node test-inspect-height.cjs`, `node test-tags.cjs` (tags and cover art; needs FFmpeg), `node test-view.mjs` (browser code, mocked DOM).

## Credit

[Garyck Arntzen](https://www.garyckarntzen.com/) · [@_mintydoge](https://x.com/_mintydoge)
