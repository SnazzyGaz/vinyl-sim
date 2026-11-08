# Vinyl Sim

Cut audio into a grooved 16-bit disc, then play it on a 3D phonograph.

Audio becomes a **vector groove master** plus a portable 16-bit PNG height map.
The Player opens those records on a cabinet phonograph: lift and drop the tonearm,
scratch the disc, keep loaded records in sleeves and drag one onto the platter to
swap. Mono, local processing — not lossless source storage, and not a promise that
a printed disc will play.

## Start

Python 3.10+, FFmpeg on PATH:

```sh
python3 -m pip install -r requirements.txt
python3 serve.py --port 8765
```

One local server, three pages:

| Page   | URL                              | What it does |
|--------|----------------------------------|--------------|
| Home   | http://127.0.0.1:8765/           | Directory card linking the two rooms. |
| Cutter | http://127.0.0.1:8765/cutter     | Cut audio into a 16-bit PNG record and save it where you choose. |
| Player | http://127.0.0.1:8765/player     | Open a PNG record and play it on the 3D turntable. |

Trailing slashes work too. Windows: `start-windows.bat` (prints the three URLs) or
`py -3 serve.py --port 8765` after installing dependencies and FFmpeg.
The server binds to loopback only; Ctrl+C stops it. **Restart an already-running
server and reload the page after replacing the code** — an old server process
does not know the `/cutter` and `/player` routes. Responses use
`Cache-Control: no-store` to avoid stale previews / JavaScript.
Fonts (Jost and Manrope, SIL OFL, licences in `static/fonts/`) are self-hosted.
Three.js 0.169.0, OrbitControls and GLTFLoader load from a pinned CDN, so the
Player's 3D turntable needs internet; audio and maps are never uploaded there.
The Cutter works fully offline.

## Cutter

1. Choose an MP3/WAV/FFmpeg-supported file, or the original 11-second tune.
   Pick a map size (4096 recommended; 2048 is lighter). Press **Cut**.
2. The existing Python encode path runs on this computer. Waits longer than two
   seconds show a progress traverse with real checkpoints (upload bytes, then
   cut → trace back → proof, polled from `GET /api/progress`).
3. The cut files are fetched into the page and listed under **Delivery** with a
   record name (defaults to the source file name):
   - `name.png` — 16-bit height-map PNG (the record)
   - `name.groove.wav` — vector groove master (keep beside the PNG)
   - `name.json` — spiral metadata that pairs the WAV with the PNG
   - `name.preview.png` — optional 8-bit viewing picture (red paper label; not a record)
   - `name.glb` / `name.stl` — only after the secondary **Build 3D mesh** export
4. **Save set to folder…** uses the browser's folder picker (File System Access
   API, Chrome/Edge) and writes the ticked files there, asking before replacing
   existing files. Each row also has **Save as…** (`showSaveFilePicker`). In
   browsers without these APIs the buttons fall back to ordinary downloads.
   Copies also remain in `output/<id>/` on the server as before.

## Player

1. **Open record** (or drop files on the turntable). Pick the 16-bit PNG, and
   optionally its `.groove.wav` + `.json` in the same selection:
   - **PNG alone:** trace its pixels, including old standard-polarity v1 files.
   - **PNG + matching vector WAV (+ JSON):** play from the vector master. The
     **Source** plate switches between vector master and PNG trace.
   The Player does not cut audio and refuses the 8-bit viewing picture.
2. **Drop needle / Lift needle** is the one needle control. Left-click a groove
   to drop the needle there. Hold the disc to stop it; drag around the centre to
   scratch; let go and it plays on. **Wheel zooms; right-drag orbits; middle-drag
   dollies; Reset view resets.** Camera gestures never move the playhead.
3. **Position** moves the record under the fixed needle; it will not drop a
   lifted needle. 33⅓ / 45 / 78 plates and the fine RPM knob change pitch and
   duration together. Knobs respond to drag, wheel and arrow keys.

(The command-line import of a vector WAV + JSON without its PNG still works with
`decode.py` and `/api/import`; the Player page asks for the PNG.)

The player explicitly identifies **vector master** versus **PNG-traced** playback.
`decoded.wav` follows that choice; `playback.wav` is its 16 kHz browser transport.
When available, the needle animation samples the prepared vector itself so its
lateral motion follows the master, not the de-emphasized listening buffer.

## Vector master format (not a hidden source MP3)

CLI output `name.png` has siblings **`name.groove.wav` + `name.json`**.
Server downloads use `heightmap.groove.wav` + `heightmap.json`.

The WAV is explicit **16-bit signed mono PCM displacement at metadata.sample_rate**
(currently 16000 Hz). It contains the result of the existing cut preparation:
mono/downmix → presence shelf → adaptive bandlimit → 0.9 peak normalization →
PCM16 quantization. The PNG is rasterized from those same quantized coordinates.

```
displacement(t) = PCM16(t) / 32768
turns(t) = lead_in_turns + t * rpm_cut / 60
r_nominal(t) = r_start_mm - pitch_mm * turns(t)
r_groove(t) = r_nominal(t) + amp_mm * displacement(t)
x(t) = r_groove(t) * cos(-2*pi*turns(t))
y(t) = r_groove(t) * sin(-2*pi*turns(t))
```

Thus the WAV is a sampled **1D vector groove definition**, not an unprocessed copy
of the original upload and not yet a CNC/CAM toolpath. The JSON contains spiral
geometry, filter metadata, and `vector_master` format/sample-count/SHA256 binding.
The same metadata is embedded in the PNG. Edited, mismatched, resampled, stereo,
non-PCM16, or wrong-rate vectors are rejected rather than silently paired.

Vector playback applies the **inverse presence shelf only**. The master was
already adaptively filtered: applying another raster-cleanup lowpass would
unnecessarily dull it. PNG-only playback still uses the 65-point radial centroid
trace and its existing adaptive cleanup/inverse shelf. `decode()` is explicitly
pixel-only; `decode_record()` prefers a valid adjacent `.groove.wav`. A present
but invalid companion fails clearly; remove it to intentionally use PNG-only.
Source uploads are deleted after cutting. The prepared vector is deliberately
retained and downloadable; this is no longer a PNG-exclusive playback claim.

**Vector removes PNG grid/centroid distortion, not the preparation bandwidth
limit.** We deliberately retain the existing adaptive preparation in this update;
it cannot restore frequencies filtered out before mastering. Arbitrary full-band
WAVs are not accepted as groove masters without matching declared metadata.

## Black vinyl and centre flicker fix

Both the unbuilt preview and built GLB view now use explicit **0x141416 black
albedo, roughness 0.42, metalness 0, no vertex-colour dependence**. The preview PNG
is itself dark (surface 6/255; groove highlights at most about 28/255). In 3D that
texture supplies only a small groove-down bump signal, **not a whitening colour
map**. Hemisphere light is 0.45 and key light 0.85, not the old 2 + 3 washout.
Loaded GLB materials are replaced with the same explicit black vinyl material.

The preview is a **RingGeometry with a label-radius hole**, not a full disc behind
a nearly-coplanar label. A separate brown label sits **0.3 mm above the surface**
with polygon offset. The built relief has one flat physical centre cap exactly at
surface height, and its view label has the same safe 0.3 mm separation. No extra
coplanar centre faces or centre spike are introduced. Mesh coordinates still use
physical heights after PNG polarity conversion; grooves go down and the mesh
remains watertight. Imported white/default GLB materials cannot override this
view's black vinyl material.

## 4096 economy, filtering and inverted PNGs

**4096 remains the default; 2048 remains the lower-bandwidth option.**

```
pixel_mm = 2 * disc_radius_mm / (image_size - 1)
cutoff(t) = min(6500 Hz, 0.44 * 2*pi*r_nominal(t)/pixel_mm * rpm_cut/60)
```

Hann STFT windows of 1024 samples, 256-sample hops (75% overlap), and a smooth
sixth-order magnitude rolloff follow this cutoff. A minimum-phase RBJ shelf adds
+6 dB with a 1.5 kHz transition, slope S=1; exact inverse swaps its numerator and
denominator. Parameters/coefficients/rate are stored as `presence-shelf-v1`.
Old maps without that field get no inverse shelf. This is **not RIAA**.

Short cuts use 2 mm pitch, keeping full 0.3 mm lateral swing / 0.8 mm groove width
while leaving unused inner radius. Long cuts retain their tighter fitted pitch
and full duration. The current sample's declared cutoff is **4.02 kHz outer →
3.20 kHz inner**; long 33⅓ cuts still become duller inward. New sampling is 16 kHz;
old 800–8000 Hz maps remain accepted. PNG cutting averages **2×2 physical subpixel
samples before quantization**, reducing—but not eliminating—grid alias artifacts.
Vector playback bypasses those raster artifacts entirely.

New PNGs retain `height_polarity: "inverted"`: high surface stores dark; lower
groove valleys store slightly lighter; outside the circular disc is 0.
Inside the disc:

```
stored_u16 = round((height_scale_mm - physical_height_mm) / height_scale_mm * 65535)
physical_height_mm = (65535 - stored_u16) / 65535 * height_scale_mm
```

With 2.55 mm scale and 2.5 mm surface the raw surface is ~2% gray. `read_map()`
restores physical heights before tracing/meshing, while keeping outside zero.
Standard/missing polarity retains the old high=high meaning; unknown polarity is
rejected. New encoding remains v2 (old v1 decoders ignored unknown polarity
unsafely); this decoder reads both. A PNG alone still contains sufficient geometry
and metadata for pixel playback, but not the vector's exact displacement samples.

**External CAM may ignore metadata:** undo visual inversion inside the disc before
using a conventional high=high manufacturing height map. The 8-bit preview, resized
images, RGB exports, or arbitrary pictures are not importable groove records.

## Limits and verification

- Eight-minute cap; 150 MB upload cap. ≤40 s: 180 mm disc, otherwise 300 mm.
  ≤120 s: 45 RPM, longer: 33⅓. Long PNG grooves can be subpixel.
- Default exported mesh: 384 radial × 1024 angular sampling (~788,000 triangles).
  Fine detail can disappear; vector/PNG playback does not use that mesh.
- Millimetre-valued coordinates (GLB viewers may assume metres); no spindle hole.
  No physical stylus/cutter compensation, stereo, fabrication test, or guarantee
  that a printed disc will play. Future vector CAM could avoid raster toolpaths,
  but CAM is **not implemented** here.

```sh
python3 encode.py samples/original.wav output/my-record.png
python3 decode.py output/my-record.png output/listen.wav             # prefer vector
python3 decode.py output/my-record.png output/pixels.wav --png-only
python3 decode.py output/my-record.groove.wav output/vector.wav      # paired JSON
python3 mesh.py output/my-record.png output/my-disc
OPENBLAS_NUM_THREADS=1 python3 verify.py
OPENBLAS_NUM_THREADS=1 python3 test-http.py
node test-player.cjs
node test-view.mjs                    # optional pinned public CDN fetch for test
```

`verify.py` refreshes sample artifacts/report, compares vector and PNG fidelity,
checks no double filter, exact vector-only PNG reconstruction, PNG-only/legacy
imports, polarity equivalence, mismatch rejection, dark preview, flat mesh centre,
and reopened watertight small GLB/STL. Huge old sample-disc exports are not rebuilt
or shipped. Optional `--long` tests a 3-minute packing regression using the
instrumental demo slowed 3× and tiled; it is not a vocal benchmark.

The vector score uses inverse-shelved prepared audio as its reference. PNG scores
include both that **same vector reference** and a raster-only reference with its
matching cleanup. Full-band-original scores are separate. SNR fits a scalar gain;
metrics search ±10 ms lag and omit edge transients. Exact results: `report.json`.
The original instrumental sample is not proof of vocal listening quality.

Node tests exercise real pinned OrbitControls / camera / raycast math, black
material overrides, ring/label separation and light levels with mocked DOM and
renderer. **No real browser/WebGL rendering or listening audition was performed.**

The repository ships source, static assets, the short instrumental sample, the
legacy 2048 PNG fixture, and `report.json`. Generated cutter output, caches, and
huge GLB/STL meshes stay local and are not committed.

## Credit

[Garyck Arntzen](https://www.garyckarntzen.com/) · [@_mintydoge](https://x.com/_mintydoge)
