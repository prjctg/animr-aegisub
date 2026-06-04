/**
 * Canvas 2D particle renderer for SP4.
 *
 * Used by the scheduler when a syl group produces > CANVAS_THRESHOLD unclipped
 * LayerSpecs. Draws all particles each rAF frame by interpolating their
 * position and opacity from the LayerSpec's raw move/fade data.
 *
 * Exported test-only helpers have an underscore prefix (_interpPos, _interpOpacity).
 */

// ── Interpolation helpers (exported for tests) ────────────────────────────────

/**
 * Linearly interpolate a 1D position between v1 and v2 over [t1Ms, t2Ms].
 * Clamped: returns v1 before t1Ms, v2 after t2Ms.
 */
export function _interpPos(v1, v2, t1Ms, t2Ms, tMs) {
  if (tMs < t1Ms) return v1;
  if (tMs >= t2Ms) return v2;
  return v1 + (v2 - v1) * (tMs - t1Ms) / (t2Ms - t1Ms);
}

/**
 * Interpolate opacity from a keyframes array [{offset, opacity}] at a given
 * normalized offset in [0, 1]. Mirrors the opacityAt() closure in ass-parser.js.
 */
export function _interpOpacity(kfs, offset) {
  for (let k = 1; k < kfs.length; k++) {
    const a = kfs[k - 1], b = kfs[k];
    if (offset >= a.offset && offset <= b.offset) {
      if (b.offset === a.offset) return b.opacity;
      return a.opacity + (b.opacity - a.opacity) * (offset - a.offset) / (b.offset - a.offset);
    }
  }
  return kfs[kfs.length - 1]?.opacity ?? 1;
}

// ── Particle record builder ───────────────────────────────────────────────────

function buildParticle(spec) {
  const x1 = spec.posX ?? 0;
  const y1 = spec.posY ?? 0;
  const x2 = spec.move ? spec.move.x2 : x1;
  const y2 = spec.move ? spec.move.y2 : y1;
  const moveT1 = spec.move ? (spec.move.t1 ?? 0) : 0;
  const moveT2 = spec.move ? (spec.move.t2 ?? spec.duration) : spec.duration;
  const opacityKfs = spec.keyframes.map(kf => ({ offset: kf.offset, opacity: kf.opacity }));
  return {
    x1, y1, x2, y2, moveT1, moveT2,
    opacityKfs,
    color: spec.style?.color ?? 'white',
    startMs: spec.startMs,
    endMs: spec.endMs,
    duration: spec.duration,
  };
}

// ── CanvasParticleRenderer ────────────────────────────────────────────────────

export class CanvasParticleRenderer {
  constructor(specs, G, stage, opts) {
    this._G = G;
    this._stage = stage;
    this._xres = opts.xres ?? 640;
    this._yres = opts.yres ?? 480;
    this._particles = specs.map(buildParticle);
    this._lineEndMs = specs.length > 0 ? Math.max(...specs.map(s => s.endMs)) : 0;
    this._rafId = null;
    this._canvas = null;
    this._ctx = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    const canvas = this._stage.ownerDocument.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    this._stage.appendChild(canvas);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._rafId = requestAnimationFrame(this._tick);
  }

  _tick() {
    const nowMs = this._G.currentTime();
    const canvas = this._canvas;
    const ctx = this._ctx;

    // Sync canvas pixel dimensions to stage layout size
    const W = this._stage.offsetWidth  || 800;
    const H = this._stage.offsetHeight || 450;
    if (canvas.width !== W || canvas.height !== H) {
      // Setting width/height clears the canvas automatically
      canvas.width  = W;
      canvas.height = H;
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    const xres = this._xres;
    const yres = this._yres;

    for (const p of this._particles) {
      const tMs = nowMs - p.startMs;
      if (tMs < 0 || tMs > p.duration) continue;

      const opacity = _interpOpacity(p.opacityKfs, tMs / p.duration);
      if (opacity <= 0) continue;

      const vidX = _interpPos(p.x1, p.x2, p.moveT1, p.moveT2, tMs);
      const vidY = _interpPos(p.y1, p.y2, p.moveT1, p.moveT2, tMs);
      const px = (vidX / xres) * W;
      const py = (vidY / yres) * H;

      ctx.globalAlpha = opacity;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (nowMs < this._lineEndMs) {
      this._rafId = requestAnimationFrame(this._tick);
    } else {
      ctx.clearRect(0, 0, W, H);
      this._rafId = null;
    }
  }

  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._canvas) {
      this._canvas.remove();
      this._canvas = null;
      this._ctx = null;
    }
  }
}
