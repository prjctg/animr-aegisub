// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _interpPos, _interpOpacity, CanvasParticleRenderer } from '../src/canvas-particles.js';

// ── _interpPos ────────────────────────────────────────────────────────────────

describe('_interpPos', () => {
  it('returns v1 when tMs < t1Ms (before move starts)', () => {
    expect(_interpPos(100, 300, 200, 800, 100)).toBe(100);
    expect(_interpPos(100, 300, 200, 800, 0)).toBe(100);
  });

  it('returns v2 when tMs >= t2Ms (move complete)', () => {
    expect(_interpPos(100, 300, 200, 800, 800)).toBe(300);
    expect(_interpPos(100, 300, 200, 800, 1000)).toBe(300);
  });

  it('linearly interpolates at the midpoint', () => {
    expect(_interpPos(0, 100, 0, 100, 50)).toBeCloseTo(50);
  });

  it('interpolates at one quarter', () => {
    expect(_interpPos(0, 200, 0, 400, 100)).toBeCloseTo(50);
  });

  it('handles t1Ms=t2Ms (zero-duration move) → returns v2 at the boundary', () => {
    // tMs >= t2Ms (100 >= 100) → v2
    expect(_interpPos(50, 200, 100, 100, 100)).toBe(200);
  });

  it('works with negative v1', () => {
    expect(_interpPos(-100, 100, 0, 200, 100)).toBeCloseTo(0);
  });
});

// ── _interpOpacity ────────────────────────────────────────────────────────────

describe('_interpOpacity', () => {
  it('returns 1 for fully opaque keyframes throughout', () => {
    const kfs = [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }];
    expect(_interpOpacity(kfs, 0)).toBe(1);
    expect(_interpOpacity(kfs, 0.5)).toBe(1);
    expect(_interpOpacity(kfs, 1)).toBe(1);
  });

  it('fade-in: returns 0 at offset=0, 1 at fadeIn boundary', () => {
    const kfs = [
      { offset: 0,   opacity: 0 },
      { offset: 0.3, opacity: 1 },
      { offset: 1,   opacity: 1 },
    ];
    expect(_interpOpacity(kfs, 0)).toBe(0);
    expect(_interpOpacity(kfs, 0.3)).toBe(1);
    expect(_interpOpacity(kfs, 0.15)).toBeCloseTo(0.5);
  });

  it('fade-out: returns 1 before fadeOut starts, 0 at offset=1', () => {
    const kfs = [
      { offset: 0,   opacity: 1 },
      { offset: 0.7, opacity: 1 },
      { offset: 1,   opacity: 0 },
    ];
    expect(_interpOpacity(kfs, 0)).toBe(1);
    expect(_interpOpacity(kfs, 0.7)).toBe(1);
    expect(_interpOpacity(kfs, 1)).toBe(0);
    expect(_interpOpacity(kfs, 0.85)).toBeCloseTo(0.5);
  });

  it('returns last keyframe opacity when offset > 1', () => {
    const kfs = [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }];
    expect(_interpOpacity(kfs, 1.5)).toBe(0);
  });

  it('handles equal adjacent offsets (instant jump) → returns b.opacity', () => {
    const kfs = [
      { offset: 0,   opacity: 0 },
      { offset: 0.5, opacity: 0 },
      { offset: 0.5, opacity: 1 },
      { offset: 1,   opacity: 1 },
    ];
    // First pair [0, 0.5] with b.offset=a.offset=0.5 at query 0.5 → b.opacity=0
    expect(_interpOpacity(kfs, 0.5)).toBe(0);
  });
});

// ── Canvas mock setup ─────────────────────────────────────────────────────────

function makeCtxMock() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    set globalAlpha(_) {},
    set fillStyle(_) {},
  };
}

function makeStage(ctxMock) {
  const stage = document.createElement('div');
  Object.defineProperty(stage, 'offsetWidth',  { value: 800, configurable: true });
  Object.defineProperty(stage, 'offsetHeight', { value: 450, configurable: true });
  // Patch getContext on any canvas created via ownerDocument.createElement
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(tag => {
    const el = origCreateElement(tag);
    if (tag === 'canvas') {
      vi.spyOn(el, 'getContext').mockReturnValue(ctxMock);
    }
    return el;
  });
  document.body.appendChild(stage);
  return stage;
}

function makeSpec(startMs = 10000, endMs = 11000) {
  return {
    posX: 320, posY: 240,
    move: null,
    startMs, endMs,
    duration: endMs - startMs,
    style: { color: 'white' },
    keyframes: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }],
    layer: 0, text: '*',
  };
}

function makeG(t = 10000) { return { currentTime: () => t }; }

// ── CanvasParticleRenderer: lifecycle ─────────────────────────────────────────

describe('CanvasParticleRenderer lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.restoreAllMocks();
  });

  it('start() appends a <canvas> element to stage', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    expect(stage.querySelector('canvas')).not.toBeNull();
    renderer.destroy();
  });

  it('canvas has pointer-events:none', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    expect(stage.querySelector('canvas').style.pointerEvents).toBe('none');
    renderer.destroy();
  });

  it('start() schedules a rAF tick', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('destroy() removes the canvas from DOM', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    renderer.destroy();
    expect(stage.querySelector('canvas')).toBeNull();
  });

  it('destroy() cancels the pending rAF', () => {
    const rafId = 42;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => rafId));
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    renderer.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(rafId);
  });

  it('destroy() sets _rafId to null', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    renderer.destroy();
    expect(renderer._rafId).toBeNull();
  });

  it('destroy() is idempotent — second call does not throw', () => {
    const ctx = makeCtxMock();
    const stage = makeStage(ctx);
    const renderer = new CanvasParticleRenderer([makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    renderer.start();
    renderer.destroy();
    expect(() => renderer.destroy()).not.toThrow();
  });
});

// ── Particle rendering: only active particles are drawn ───────────────────────

describe('CanvasParticleRenderer particle draw filtering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('draws active particle and skips future particle at t=10100', () => {
    let tickFn = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn(cb => { tickFn = cb; return 1; }));

    const ctx = makeCtxMock();
    const stage = makeStage(ctx);

    const activeSpec = makeSpec(10000, 11000);   // active at t=10100
    const futureSpec = makeSpec(11000, 12000);   // not started at t=10100

    const G = makeG(10100);
    const renderer = new CanvasParticleRenderer([activeSpec, futureSpec], G, stage, { xres: 640, yres: 480 });
    renderer.start();

    // Manually fire one tick
    tickFn();

    // Only 1 particle should be drawn (the active one)
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it('skips particle that has fully elapsed (tMs > duration)', () => {
    let tickFn = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn(cb => { tickFn = cb; return 1; }));

    const ctx = makeCtxMock();
    const stage = makeStage(ctx);

    const elapsedSpec = makeSpec(9000, 9500);   // ended at 9500, now=10100

    const renderer = new CanvasParticleRenderer([elapsedSpec], makeG(10100), stage, { xres: 640, yres: 480 });
    renderer.start();
    tickFn();

    expect(ctx.arc).not.toHaveBeenCalled();
    renderer.destroy();
  });
});
