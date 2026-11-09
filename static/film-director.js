/* Film director v2 for ?film=1 — Crow already on platter, both cues @ 0, one continuous cam, shorter tilted inspect. */
(async () => {
  const _p = new URLSearchParams(location.search);
  if (!_p.has('film') || _p.get('demo') === 'extract') return;

  const DUR = 90; // seconds of film
  const FOREST_CUE = 0; // both songs from the top
  const LORN_CUE = 0;
  // Beat timeline (continuous camera; no cuts)
  // 0–6   establish (Crow seated)
  // 6–7.5 needle down Crow @ 0
  // 7.5–26 listen + orbit
  // 26–30 DJ scratch
  // 30–38 resume + ease out
  // 38–39.2 lift
  // 39.2–44 swap to Lorn
  // 44–55 inspect (shorter, less close, tilt for glint)
  // 55–58 seat + needle Acid Rain @ 0
  // 58–90 listen + pull-back
  const SCRATCH_T0 = 26;
  const SCRATCH_T1 = 30;
  const INSPECT_T0 = 44.5;
  const INSPECT_T1 = 54.5;
  const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
  const lerp = (a, b, k) => a + (b - a) * k;
  const V = (a, b, k) => a.map((x, i) => lerp(x, b[i], k));

  let s = 12345;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  const wait = (pred, ms = 180000) =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      const tick = () => {
        try {
          if (pred()) return resolve();
        } catch (e) {
          return reject(e);
        }
        if (performance.now() - t0 > ms) return reject(new Error('timeout waiting'));
        requestAnimationFrame(tick);
      };
      tick();
    });

  await wait(() => window.vinyl && window.vinylView && document.querySelector('canvas')?.dataset?.ready !== undefined).catch(() => {});
  await wait(() => window.vinyl && window.vinylView?.filmStep);

  const vv = () => window.vinylView;
  const v = () => window.vinyl;
  vv().filmHideHud();
  v().film.setMute(true);
  v().film.setDrive(true);
  try { vv().setQuality?.('high'); } catch {}

  let forestId = null, lornId = null;
  let forestMeta = null, lornMeta = null;
  let prepared = false;
  let lastAction = -1;
  let scratchPhase = null;
  let inspectSpin = null;
  let inspectTilt = 0; // extra radians tilting the face away for glint

  async function prepare() {
    if (prepared) return;
    const pre = await (await fetch('records/preloaded.json')).json();
    async function loadPre(key, play) {
      const info = pre[key];
      const data = await (await fetch(info.base + 'record.json')).json();
      data.base = info.base;
      await v().loadCut(data, info.label, { play });
      return data;
    }
    // Forest mounts onto the platter (drop-in runs during warmup). Lorn shelves.
    const d1 = await loadPre('forest', true);
    const d2 = await loadPre('lorn', false);
    forestId = pre.forest.id;
    lornId = pre.lorn.id;
    const sleeves = v().sleeves?.() || [];
    for (const s of sleeves) {
      if (/forest|crow/i.test(s.label)) forestId = s.id;
      if (/lorn|acid/i.test(s.label)) lornId = s.id;
    }
    // If Forest somehow didn't mount (play:true path), force-swap it on.
    if (v().currentId !== forestId && forestId) {
      const from = vv().presentFrom?.();
      if (from) vv().setPendingSwap(from, 0);
      v().swapTo(forestId);
    }
    forestMeta = d1.metadata;
    lornMeta = d2.metadata;
    // Warm until drop-in finishes and a few settled frames — Crow is sitting before t=0.
    for (let i = 0; i < 120; i++) {
      vv().filmStep(1 / 30, i === 119);
      if (i > 40 && !vv().dropIn) {
        // a few extra settled frames
        for (let j = 0; j < 15; j++) vv().filmStep(1 / 30, j === 14);
        break;
      }
    }
    // Snap disc flat on spindle in case drop-in left a residual
    if (vv().disc) {
      vv().disc.position.set(0, 0, 0);
      vv().disc.rotation.x = 0;
      vv().disc.rotation.y = 0;
    }
    prepared = true;
  }

  function camAt(t) {
    const R = vv().R || 150;
    const D = Math.PI / 180;
    // Key poses — each segment eases from the previous pose so there is no teleport.
    // Inspect poses are pulled back vs v1 (less close) and FOV a touch wider.
    const wide = { pos: [R * 1.25, -R * 7.4, R * 2.85], target: [R * 0.35, R * 0.05, R * 0.35], fov: 40 };
    const settle = { pos: [R * 0.95, -R * 5.8, R * 2.25], target: [0.05 * R, 0.02 * R, 0.2 * R], fov: 36 };
    const play = { pos: [R * 0.7, -R * 4.8, R * 1.95], target: [0, 0.02 * R, 0.08 * R], fov: 33 };
    const close = { pos: [R * 0.38, -R * 3.25, R * 1.6], target: [0, 0, 0.04 * R], fov: 30 };
    const scratch = { pos: [R * 0.28, -R * 2.6, R * 1.45], target: [0, 0, 0.03 * R], fov: 28 };
    const mid = { pos: [R * 1.0, -R * 5.4, R * 2.3], target: [0.08 * R, 0, 0.22 * R], fov: 36 };
    const swap = { pos: [R * 1.5, -R * 6.55, R * 3.05], target: [-R * 0.2, R * 0.45, R * 0.5], fov: 40 }; // wide: crate + machine during extract
    // Less close than v1 held/label/grooves (v1 had label fov 26 / grooves very tight)
    // Grazing inspect: close-ish, label centred, crate left / horn behind; tip does the foreshortening.
    // Inspect hold matched to Gaz ref: whole disc as a wide ellipse (~25° above plane),
    // ~85% frame width, label readable, crate UL / horn UC / window behind UL.
    const discHold = [-R * 0.18, -R * 2.2, R * 1.4];
    // Half of one middle-button/wheel zoom notch closer (view.js ZOOM_NOTCH=log(1.11)).
    const Z = 1 / Math.sqrt(1.11);
    const held = {
      pos: [discHold[0] + R * 0.45 * Z, discHold[1] - R * 3.6 * Z, discHold[2] + R * 1.6 * Z],
      target: discHold.slice(),
      fov: 34,
    };
    const heldPeak = {
      pos: [discHold[0] + R * 0.28 * Z, discHold[1] - R * 3.45 * Z, discHold[2] + R * 1.55 * Z],
      target: discHold.slice(),
      fov: 32,
    };
    const label = heldPeak;
    const grooves = heldPeak;
    const end = { pos: [R * 1.35, -R * 7.15, R * 3.05], target: [0.2 * R, 0.05 * R, 0.45 * R], fov: 40 }; // stay inside the front wall (y≈-1200)

    const yaw = (pose, ang) => {
      const [px, py, pz] = pose.pos, [tx, ty, tz] = pose.target;
      const dx = px - tx, dy = py - ty, c = Math.cos(ang), s = Math.sin(ang);
      return { pos: [tx + dx * c - dy * s, ty + dx * s + dy * c, pz], target: pose.target.slice(), fov: pose.fov };
    };
    const mix = (a, b, u) => {
      const k = ease(u);
      return { pos: V(a.pos, b.pos, k), target: V(a.target, b.target, k), fov: lerp(a.fov, b.fov, k) };
    };

    // Continuous piecewise path — every branch starts where the previous ended.
    if (t < 6) return mix(wide, settle, t / 6);
    if (t < 7.5) return mix(settle, play, (t - 6) / 1.5);
        if (t < 26) {
      // Continuous: starts at play, ends at close; yaw peaks mid-segment and returns to 0
      const u = (t - 7.5) / 18.5;
      const base = mix(play, close, u);
      return yaw(base, Math.sin(Math.PI * u) * 18 * D);
    }
    if (t < 30) return mix(close, scratch, Math.min(1, (t - 26) / 1.0));
    if (t < 38) return mix(scratch, mid, (t - 30) / 8);
    if (t < 44) return mix(mid, swap, (t - 38) / 6);
    if (t < 55) {
      // Inspect: soft approach into grazing hold, then ease a touch closer — no punch, no face-on cutaway.
      const u = (t - 44) / 11;
      if (u < 0.5) return mix(swap, held, u / 0.5);
      return mix(held, heldPeak, (u - 0.5) / 0.5);
    }
    if (t < 59) return mix(grooves, play, (t - 55) / 4);
    const u = (t - 59) / (DUR - 59);
    const base = mix(play, end, u);
    // yaw starts at 0 so t=59 matches grooves→play end pose
    const spun = yaw(base, Math.sin(Math.PI * 0.5 * u) * -12 * D);
    return { pos: spun.pos, target: base.target, fov: base.fov };
  }

  function scratchRate(localT) {
    // localT in [0,4] — same soft stroke shape as v1, fitted into 4 s
    const strokes = [
      [0.25, 0.85, -2.8],
      [0.85, 1.45, 2.4],
      [1.45, 2.15, -3.2],
      [2.15, 2.85, 2.6],
      [2.85, 3.45, -2.2],
    ];
    for (const [a, b, r] of strokes) {
      if (localT >= a && localT < b) {
        const u = (localT - a) / (b - a);
        return r * Math.sin(Math.PI * u);
      }
    }
    return 0;
  }

  function applyInspectTilt(dt, t) {
    // Gaz ref: whole disc as a wide ellipse (~25° above plane → tip ~65° from face-on),
    // slight LL→UR roll, far rim biased toward the window key for edge-to-edge gold sparkle.
    // Tip about camera-right (reliable foreshortening) with a light-ward lean.
    const disc = vv().disc;
    if (!disc || !vv().inspect?.active || vv().inspect.phase !== 'held') return;
    const THREE = vv().THREE;
    if (!THREE) return;
    const u = Math.max(0, Math.min(1, (t - (INSPECT_T0 + 0.9)) / 5.5));
    const tipTarget = ease(u) * (65 * Math.PI / 180);
    const rollTarget = ease(u) * (16 * Math.PI / 180);
    inspectTilt = lerp(inspectTilt, tipTarget, Math.min(1, dt * 1.3));
    if (!inspectSpin) inspectSpin = { yaw: 0, roll: 0 };
    inspectSpin.roll = lerp(inspectSpin.roll || 0, rollTarget, Math.min(1, dt * 1.3));
    inspectSpin.yaw += (t < INSPECT_T0 + 5 ? 0.16 : 0.07) * dt;

    const cam = vv().camera;
    const heldRaw = vv().inspect.held || disc.position;
    const held = heldRaw.isVector3 ? heldRaw.clone() : new THREE.Vector3(heldRaw.x, heldRaw.y, heldRaw.z);
    const towardCam = new THREE.Vector3().subVectors(cam.position, held).normalize();
    const camRight = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld).normalize();
    const toLight = new THREE.Vector3(-330, 640, 560).sub(held).normalize();
    // Blend camera-right with light tip axis so foreshortening is stable and sparkle leans window-ward
    let lightAxis = new THREE.Vector3().crossVectors(towardCam.clone().multiplyScalar(-1), toLight);
    if (lightAxis.lengthSq() < 1e-8) lightAxis.copy(camRight); else lightAxis.normalize();
    const tipAxis = camRight.clone().multiplyScalar(0.65).add(lightAxis.multiplyScalar(0.35)).normalize();

    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), towardCam);
    const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), inspectSpin.yaw);
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(tipAxis, -inspectTilt);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(towardCam, inspectSpin.roll);
    disc.quaternion.copy(rollQ).multiply(tiltQ).multiply(face).multiply(spinQ);
  }

  function applyActions(t, dt) {
    // Needle down Forest @ cue 0
    if (t >= 6.8 && lastAction < 2) {
      lastAction = 2;
      v().film.setTime(FOREST_CUE);
      v().drop(FOREST_CUE);
    }
    // Scratch window
    if (t >= SCRATCH_T0 && t < SCRATCH_T1) {
      const local = t - SCRATCH_T0;
      const rate = scratchRate(local);
      if (!scratchPhase) scratchPhase = { song: v().film.pos };
      if (local < dt * 1.5) scratchPhase.song = v().film.pos;
      if (scratchPhase.acc == null) scratchPhase.acc = scratchPhase.song;
      scratchPhase.acc += rate * dt;
      v().film.scratchTo(scratchPhase.acc, rate);
    } else if (t >= SCRATCH_T1 && lastAction < 3) {
      lastAction = 3;
      v().film.endScratch();
      v().drop(v().film.pos);
      scratchPhase = null;
    }
    // Lift before swap
    if (t >= 38.2 && lastAction < 4) {
      lastAction = 4;
      v().lift();
    }
    // Swap to Lorn
    if (t >= 39.5 && lastAction < 5) {
      lastAction = 5;
      // Crate-staying extract (approved tech demo): sleeve stays home, disc slides out then arcs on.
      if (!vv().armSwapFromSleeve?.(lornId)) {
        const from = vv().jacketWorld?.(lornId);
        if (from) vv().setPendingSwap(from, Math.PI / 2 - 0.15);
      }
      v().swapTo(lornId);
    }
    // Begin inspect once Lorn is settled
    if (t >= INSPECT_T0 && lastAction < 6) {
      lastAction = 6;
      vv().beginInspection();
      inspectSpin = { yaw: 0 };
      inspectTilt = 0;
    }
    // Spin + tilt during inspect (handled in applyInspectTilt)
    if (t >= INSPECT_T0 + 0.5 && t < INSPECT_T1 && vv().inspect?.active) {
      applyInspectTilt(dt, t);
    }
    // Return from inspect
    if (t >= INSPECT_T1 && lastAction < 7) {
      lastAction = 7;
      inspectTilt = 0;
      inspectSpin = null;
      vv().returnRecord();
    }
    // Needle on Lorn @ cue 0
    if (t >= 58.0 && lastAction < 8) {
      lastAction = 8;
      v().film.setTime(LORN_CUE);
      v().drop(LORN_CUE);
    }
  }

  function step(t, dt = 1 / 30, cam, draw = true) {
    t = Math.max(0, Math.min(DUR, t));
    applyActions(t, dt);
    if (v().record && v().down && !v().state.grabbed) v().film.advance(dt);
    const c = cam || camAt(t);
    vv().filmSetCamera(c.pos, c.target, c.fov);
    vv().filmStep(dt, draw);
    return { t, record: v().record?.label, song: v().time(), down: v().down, grabbed: v().state.grabbed };
  }

  window.__film = {
    duration: DUR,
    forestCue: FOREST_CUE,
    lornCue: LORN_CUE,
    scratchT0: SCRATCH_T0,
    scratchT1: SCRATCH_T1,
    inspectT0: INSPECT_T0,
    inspectT1: INSPECT_T1,
    prepare,
    step,
    camAt,
    scratchRate,
    get forestId() { return forestId; },
    get lornId() { return lornId; },
    get ready() { return prepared; },
  };

  try {
    await prepare();
    console.log('[film-v2] prepared', forestId, lornId);
  } catch (e) {
    console.error('[film-v2] prepare failed', e);
    window.__film.prepareError = String(e && e.message || e);
  }
})();
