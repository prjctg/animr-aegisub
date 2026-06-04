/**
 * JIT scheduler: schedules all Web Animations for a line at preview time.
 *
 * All animations are scheduled via el.animate({ delay }) at LINE preview
 * time (~1500ms before the line starts). The browser compositor fires each
 * animation at the correct moment — zero JS overhead at syl-fire time.
 */

import { createLayerEl } from './layout.js';

// lineId → { els: HTMLElement[], anims: Animation[] }
const pendingLines = new Map();

/**
 * Schedule all LayerSpecs for a line. Creates DOM elements, appends them to
 * stage, and fires el.animate() with the correct delay relative to now.
 *
 * @param {number|string} lineId
 * @param {Array}  layerSpecs – from ass-parser.js
 * @param {object} G          – Animr G API
 * @param {Element} stage     – #kstage container
 * @param {object} opts       – layout options (font, fontSize, etc.)
 */
export function compileAndSchedule(lineId, layerSpecs, G, stage, opts) {
  const now = G.currentTime();
  const record = { els: [], anims: [] };

  for (const spec of layerSpecs) {
    if (!spec || !spec.text) continue;

    const el = createLayerEl(spec, opts, stage);
    stage.appendChild(el);
    record.els.push(el);

    const delay = spec.startMs - now;
    // Skip animations that have already completely elapsed
    if (delay < -spec.duration) continue;

    const anim = el.animate(spec.keyframes, {
      delay: Math.max(0, delay),
      duration: spec.duration,
      fill: 'forwards',
    });
    record.anims.push(anim);
  }

  pendingLines.set(lineId, record);
}

/**
 * Cancel and remove all elements for a single line.
 */
export function cancelLine(lineId) {
  const record = pendingLines.get(lineId);
  if (!record) return;
  for (const anim of record.anims) anim.cancel();
  for (const el of record.els) el.remove();
  pendingLines.delete(lineId);
}

/**
 * Cancel and remove all pending lines (called on SEEK / UNINIT).
 */
export function cancelAll() {
  for (const id of [...pendingLines.keys()]) cancelLine(id);
}
