/**
 * G event wiring for animr-aegisub.
 *
 * Pipeline per LINE preview:
 *   1. Build karaskel line table (SP1: timing + equal-width centers)
 *   2. Run Lua script via Fengari
 *   3. Parse ASS output → LayerSpec[]
 *   4. compileAndSchedule() → Web Animations with delay
 */

import { initVM, runScript, disposeVM } from './fengari.js';
import { buildLineTable } from './karaskel-stub.js';
import { parseAssDialogue } from './ass-parser.js';
import { computeSlotYs } from './layout.js';
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

  // lineId → sorted SYL array
  const lineSylMap = new Map();

  // stream → slot Y (pixels)
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

    // Initialize Fengari VM (synchronous — pure-JS Lua interpreter)
    try {
      L = initVM(opts);
    } catch (e) {
      (opts.onError ?? console.error)('animr-aegisub: VM init failed:', e);
      return;
    }

    // Build lineId → syls map for all channels/streams
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

  // ── LINE preview: run Lua + schedule animations ───────────────────────────
  for (let stream = 0; stream < streamCount; stream++) {
    const streamIdx = stream;

    G.on(TYPE.LINE, { channel: CHANNEL, stream, offset: -PREV_MS, prevSylLimit: true, prevSylRatio: 0.5 },
      line => {
        if (!L || !stage) return;

        const entry = lineSylMap.get(line.id);
        const syls = entry?.syls ?? [];
        if (!syls.length) return;

        const slotY = slotYs[streamIdx] ?? slotYs[0];

        let lineTable;
        try {
          lineTable = buildLineTable(line, syls, slotY, W, H, opts);
        } catch (e) {
          (opts.onError ?? console.error)('animr-aegisub: buildLineTable error:', e);
          return;
        }

        let dialogues;
        try {
          dialogues = runScript(L, luaScript, lineTable, opts);
        } catch (e) {
          (opts.onError ?? console.error)('animr-aegisub: Lua error:', e);
          return;
        }

        const layerSpecs = dialogues
          .map(d => {
            try {
              return parseAssDialogue(d, {
                xres: opts.xres ?? 640,
                yres: opts.yres ?? 480,
                lineStartMs: line.s,
              });
            } catch (e) {
              (opts.onError ?? console.error)('animr-aegisub: ASS parse error:', e);
              return null;
            }
          })
          .filter(Boolean);

        compileAndSchedule(line.id, layerSpecs, G, stage, opts);
      });

    // Hide line at its end time (G.off fires at event end + on seek)
    G.off(TYPE.LINE, { channel: CHANNEL, stream }, line => cancelLine(line.id));
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
