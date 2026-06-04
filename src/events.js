/**
 * G event wiring for animr-aegisub.
 *
 * SP1 pipeline per LINE preview:
 *   1. Build karaskel line table (timing + equal-width centers)
 *   2. Run Lua script via Fengari
 *   3. Parse ASS output → LayerSpec[]
 *   4. compileAndSchedule() → Web Animations with delay
 *
 * SP2 addition: LINE handler is now async — real text metrics are measured via
 * DOM + rAF before the Lua script runs, so syl.center/width/height are accurate.
 * The 1500ms preview window comfortably absorbs the single rAF round-trip.
 */

import { initVM, runScript, disposeVM, injectExtents } from './fengari.js';
import { buildLineTable, patchMetrics } from './karaskel-stub.js';
import { parseAssDialogue } from './ass-parser.js';
import { computeSlotYs, measureLineEls } from './layout.js';
import { compileAndSchedule, cancelLine, cancelAll } from './scheduler.js';

/**
 * Wire all G events for the library. Called once from createKaraskel().
 *
 * @param {object} G         – Animr G API
 * @param {ShadowRoot} shadowRoot
 * @param {string} luaScript – karaskel Lua source
 * @param {object} opts      – merged options
 */
export function wireEvents(G, shadowRoot, luaScript, opts) {
  const TYPE = G.TYPE;
  const CHANNEL = opts.channel ?? 0;
  const PREV_MS = opts.previewMs ?? 1500;
  const streamCount = G.getSongData().streamCount ?? 1;

  let stage = null;
  let L = null;  // Fengari Lua state
  let W = 0, H = 0;

  // lineId → { syls, stream }
  const lineSylMap = new Map();

  // stream index → slot Y in container pixels
  let slotYs = [];

  function updateDim() {
    const r = G.clientRect();
    W = r.width || 800;
    H = r.height || 450;
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  G.on(TYPE.INIT, () => {
    stage = G.getElementById('kstage');
    updateDim();
    slotYs = computeSlotYs(streamCount, H, opts);

    try {
      L = initVM(opts);
    } catch (e) {
      (opts.onError ?? console.error)('animr-aegisub: VM init failed:', e);
      return;
    }

    lineSylMap.clear();
    for (let stream = 0; stream < streamCount; stream++) {
      const sylMap = {};
      G.forEach(TYPE.SYL, { channel: CHANNEL, stream, includeDash: true }, syl => {
        (sylMap[syl.lineId] ??= []).push({ id: syl.id, d: syl.d, s: syl.s, e: syl.e });
      });
      for (const lineId in sylMap) {
        sylMap[lineId].sort((a, b) => a.s - b.s);
        lineSylMap.set(Number(lineId), { syls: sylMap[lineId], stream });
      }
    }
  });

  // ── LINE preview: measure → patch → inject → run Lua → schedule ───────────
  for (let stream = 0; stream < streamCount; stream++) {
    const streamIdx = stream;

    G.on(TYPE.LINE, { channel: CHANNEL, stream, offset: -PREV_MS, prevSylLimit: true, prevSylRatio: 0.5 },
      line => {
        // Spawn async without blocking the G event system.
        // The 1500ms preview window is much longer than one rAF round-trip.
        handleLine(line, streamIdx).catch(e =>
          (opts.onError ?? console.error)('animr-aegisub: LINE error:', e)
        );
      });

    G.off(TYPE.LINE, { channel: CHANNEL, stream }, line => cancelLine(line.id));
  }

  async function handleLine(line, streamIdx) {
    if (!L || !stage) return;

    const entry = lineSylMap.get(line.id);
    const syls = entry?.syls ?? [];
    if (!syls.length) return;

    const slotY = slotYs[streamIdx] ?? slotYs[0];

    // 1. Build initial lineTable with equal-width approximations (SP1 baseline)
    const lineTable = buildLineTable(line, syls, slotY, W, H, opts);

    // 2. Measure real text metrics via hidden DOM elements + one rAF round-trip
    const metricsMap = await measureLineEls(syls, slotY, W, H, opts, stage);

    // 3. Patch lineTable.kara with real width/height/center/left/right/middle
    patchMetrics(lineTable, metricsMap);

    // 4. Inject measured extents into Lua VM so aegisub.text_extents() returns real values
    injectExtents(L, buildExtentsMap(lineTable));

    // 5. Run the Lua script — syl positions now reflect real font metrics
    const dialogues = runScript(L, luaScript, lineTable, opts);

    // 6. Parse ASS dialogue objects into LayerSpecs (pass container dims for \move px math)
    const layerSpecs = dialogues.map(d => {
      try {
        return parseAssDialogue(d, {
          xres: opts.xres ?? 640,
          yres: opts.yres ?? 480,
          containerW: W,
          containerH: H,
        });
      } catch (e) {
        (opts.onError ?? console.error)('animr-aegisub: ASS parse error:', e);
        return null;
      }
    }).filter(Boolean);

    // 7. Create DOM elements and schedule Web Animations with delay
    compileAndSchedule(line.id, layerSpecs, G, stage, opts);
  }

  // ── SEEK / RESIZE / UNINIT ────────────────────────────────────────────────
  G.on(TYPE.SEEK, () => cancelAll());

  G.on(TYPE.RESIZE, () => {
    updateDim();
    slotYs = computeSlotYs(streamCount, H, opts);
  });

  G.on(TYPE.UNINIT, () => {
    cancelAll();
    if (L) { disposeVM(L); L = null; }
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build a text → {w, h} map from the patched lineTable for injectExtents().
 * Uses syl.text_stripped as the lookup key, matching what Lua scripts pass
 * to aegisub.text_extents(style, text).
 */
function buildExtentsMap(lineTable) {
  const map = new Map();
  for (const syl of lineTable.kara) {
    if (syl.text_stripped) {
      map.set(syl.text_stripped, { w: syl.width, h: syl.height });
    }
  }
  return map;
}
