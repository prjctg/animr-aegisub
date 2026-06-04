/**
 * JIT scheduler: schedules all Web Animations for a line at preview time.
 *
 * All animations are scheduled via el.animate({ delay }) at LINE preview
 * time (~1500ms before the line starts). The browser compositor fires each
 * animation at the correct moment — zero JS overhead at syl-fire time.
 *
 * SP4: groups specs by syl position; routes large unclipped groups to Canvas;
 *      creates syl-stack wrapper divs for clipped groups; sets z-index by layer.
 */

import { createLayerEl, createSylStack } from './layout.js';
import { CanvasParticleRenderer } from './canvas-particles.js';

// lineId → { els: HTMLElement[], anims: Animation[], canvasRenderers: CanvasParticleRenderer[] }
const pendingLines = new Map();

// Syl groups with more unclipped specs than this are routed to Canvas 2D.
const CANVAS_THRESHOLD = 50;

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Group LayerSpecs by their (posX, posY) origin — specs at the same video-coord
 * position belong to the same syllable. Specs without a position get unique keys
 * so they are never incorrectly merged.
 *
 * Each group is sorted by layer ascending (lower layer = drawn behind).
 */
function groupBySyl(layerSpecs) {
  const groups = new Map();
  for (const spec of layerSpecs) {
    const key = spec.posX == null
      ? `nopos:${spec.startMs}:${spec.layer}`
      : `${spec.posX.toFixed(1)},${spec.posY.toFixed(1)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spec);
  }
  for (const g of groups.values()) g.sort((a, b) => a.layer - b.layer);
  return groups;
}

/**
 * Schedule a single Web Animation on an element. Skips specs that have
 * already completely elapsed relative to now.
 */
function scheduleAnim(el, spec, now, animsArr) {
  const delay = spec.startMs - now;
  if (delay >= -spec.duration) {
    const anim = el.animate(spec.keyframes, {
      delay:    Math.max(0, delay),
      duration: spec.duration,
      fill:     'forwards',
    });
    animsArr.push(anim);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Schedule all LayerSpecs for a line. Groups specs by syl position, creates
 * DOM elements or Canvas renderers as appropriate, and fires el.animate()
 * with the correct delay relative to now.
 *
 * @param {number|string} lineId
 * @param {Array}   layerSpecs – from ass-parser.js
 * @param {object}  G          – Animr G API
 * @param {Element} stage      – #kstage container
 * @param {object}  opts       – layout options (font, fontSize, xres, yres, etc.)
 */
export function compileAndSchedule(lineId, layerSpecs, G, stage, opts) {
  const now = G.currentTime();
  const record = { els: [], anims: [], canvasRenderers: [] };

  const validSpecs = layerSpecs.filter(s => s && s.text !== undefined);
  const groups = groupBySyl(validSpecs);

  for (const [, group] of groups) {
    const clipped   = group.filter(s => s.clip != null);
    const unclipped = group.filter(s => s.clip == null);

    // Unclipped specs: Canvas if the group is too large, otherwise DOM
    if (unclipped.length > CANVAS_THRESHOLD) {
      const renderer = new CanvasParticleRenderer(unclipped, G, stage, opts);
      renderer.start();
      record.canvasRenderers.push(renderer);
    } else {
      for (const spec of unclipped) {
        const el = createLayerEl(spec, opts, stage);
        stage.appendChild(el);
        record.els.push(el);
        scheduleAnim(el, spec, now, record.anims);
      }
    }

    // Clipped specs: always DOM — syl-stack wrapper with overflow:hidden
    if (clipped.length > 0) {
      const { wrapper, children } = createSylStack(clipped, opts, stage);
      stage.appendChild(wrapper);
      record.els.push(wrapper); // removing wrapper removes children from DOM
      children.forEach((el, i) => scheduleAnim(el, clipped[i], now, record.anims));
    }
  }

  pendingLines.set(lineId, record);
}

/**
 * Cancel and remove all elements for a single line, including canvas renderers.
 */
export function cancelLine(lineId) {
  const record = pendingLines.get(lineId);
  if (!record) return;
  for (const anim of record.anims) anim.cancel();
  for (const el of record.els) el.remove();
  record.canvasRenderers?.forEach(r => r.destroy());
  pendingLines.delete(lineId);
}

/**
 * Cancel and remove all pending lines (called on SEEK / UNINIT).
 */
export function cancelAll() {
  pendingLines.forEach((_, id) => cancelLine(id));
}
