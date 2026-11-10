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

Open the 16-bit PNG, and add its `.groove.wav` and `.json` when you have them. Lift and drop the tonearm to stop and start, click a groove to drop the needle there, or hold the disc and drag to scratch. Loaded records wait in sleeves in the crate. Hover one to raise it, click to slide its record half out, and click the record again to play it: it slides out of the sleeve onto the platter (dragging it onto the platter works too). Esc or a click elsewhere puts it back. The record you were playing goes back into its own sleeve, wherever that sleeve lies.

A PNG on its own is traced from its pixels and sounds deliberately lo-fi. This is a digital stylus.

One toy rides on the front-left corner of the cabinet lid and dances to the record: the spring-mounted hula girl by default, or Garyck Arntzen's *Shiba in Clogs*. A small brass pip low on the right of the cabinet front swaps between them (it pops the new toy in and remembers the choice in `localStorage` as `vinyl-toy`). The shiba's butt reacts to what the record is actually playing under the needle: kicks jolt it up, snare and clap cracks whip it sideways, held bass notes lean it slowly toward where the bass line's pitch moves, busy passages make the spring snappier, and quiet passages let him settle. His legs and clogs stay put; the wobble hinges in the undercarriage just behind his legs. Click him for a wobble. URL parameters tune it: `shibaAmp` (overall size, 1.35), `shibaLR` (side-to-side, 1), `shibaUD` (up-down, 0.85), `shibaMode` (`react`, the default, or the older beat-driven `fig8`, `alt` and `beat`), `shibaFig` (sway strength, 1), `shibaClamp` (largest deflection, 0.55, max 1) and `shibaChaos` (0 to 1). His fur and meshes are baked ahead of time into `static/shiba.bin` by `node tools/bake-shiba.mjs`, so the page does no mesh building at start-up.

The camera stays where you put it: swapping records, inspecting one and putting it back never reset the view (Reset view glides back to the default seat). **Picture** sets the rendering quality — Auto picks High (ambient occlusion, depth of field, bloom), Balanced or Low for your GPU and steps down if frames get slow. The scene only redraws when something moves, so an idle player uses almost no GPU.

## How a record works

A vinyl record stores sound as shape. In a mastering studio, a cutting lathe turns a soft lacquer disc while a cutting stylus moves slowly from the rim towards the centre, carving one continuous spiral groove. The amplified audio drives the stylus, so as it cuts it also swings from side to side, and the groove's wiggles follow the waveform: loud sounds make wide swings and high notes make tight ones. In a mono record this sideways (lateral) movement is the whole signal. Stereo records tilt the two channels 45° each way, one on each wall of the groove (the "45/45" system). Both walls moving together is a sideways swing, which is why a mono player still plays stereo records, and the difference between the channels shows up as the stylus moving up and down.

The disc turns at a fixed speed: 33⅓ RPM for LPs, 45 for singles and 78 for old shellac. Because the speed is fixed, the groove passes under the stylus faster near the rim than near the centre. On a 12-inch LP that is roughly half a metre a second at the start and about 0.2 m/s at the end. Near the label, the same waveform has to fit into a shorter length of groove, so its wiggles get squeezed tighter and are harder for a round stylus tip to follow. That is why the inner grooves lose treble detail and distort first, and why mastering engineers often put quieter songs at the end of a side.

To play the record, a diamond stylus rides in the groove and is pushed back and forth by its walls. The cartridge turns that movement into a small electrical signal, usually with a magnet and coils, and the amplifier makes it loud enough to hear. Records are also cut with the RIAA curve: bass is turned down (so its big swings don't crowd the grooves together) and treble is turned up (so it sits above surface noise), and the phono preamp applies the exact opposite curve on playback.

### How Vinyl Sim mirrors it

The Cutter plays the part of the lathe. Your audio becomes one spiral groove drawn into a 16-bit greyscale PNG, where each pixel's brightness is the height of the disc surface at that point. As on a mono record, the groove swings sideways with the waveform. Short pieces are cut at 45 RPM and longer ones at 33⅓, and a reversible treble lift (a simple presence shelf, not the full RIAA curve) is undone on playback. The picture has a fixed number of pixels, so the inner turns have fewer pixels to hold each wiggle, just as real inner grooves have less length. The Cutter models this with a cutoff that falls as the groove nears the label, so the end of a record sounds a little duller than the start.

The Player is the stylus. It follows the spiral back through the PNG, reads how far the groove has moved sideways at each point and turns that movement back into sound. Set Source to Vector to hear the groove master saved alongside the PNG instead, and switch between the two to compare. With the needle lifted, Inspect picks the record off the platter in 3D, made from the real height map, so you can turn it and look closely at the groove you just heard.

## Tests

`python3 verify.py` (pipeline), `python3 test-http.py` (server), and `node test-vinyl-core.cjs`, `node test-player.cjs`, `node test-player-pages.cjs`, `node test-inspect-height.cjs`, `node test-tags.cjs` (tags and cover art; needs FFmpeg), `node test-view.mjs` (browser code, mocked DOM).

## Credit

[Garyck Arntzen](https://www.garyckarntzen.com/) · [@_mintydoge](https://x.com/_mintydoge)
