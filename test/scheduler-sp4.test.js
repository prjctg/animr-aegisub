/**
 * SP4 scheduler tests: syl grouping, z-index routing, Canvas threshold, cancelLine.
 * Mocks layout.js and canvas-particles.js so no DOM is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before the module under test is imported.

vi.mock('../src/layout.js', () => ({
  createLayerEl: vi.fn((spec) => ({
    textContent: spec.text,
    style: { cssText: '' },
    animate: vi.fn(() => ({ cancel: vi.fn() })),
    remove: vi.fn(),
    children: [],
  })),
  createSylStack: vi.fn((specs) => {
    const children = specs.map(s => ({
      textContent: s.text,
      style: { cssText: '' },
      animate: vi.fn(() => ({ cancel: vi.fn() })),
      remove: vi.fn(),
    }));
    const wrapper = {
      className: 'syl-stack',
      style: { cssText: '' },
      remove: vi.fn(),
      children,
      appendChild: vi.fn(),
    };
    return { wrapper, children };
  }),
  buildStageHtml: () => '',
  computeSlotYs: (n, H) => [H * 0.5],
}));

vi.mock('../src/canvas-particles.js', () => ({
  CanvasParticleRenderer: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    destroy: vi.fn(),
  })),
}));

const { compileAndSchedule, cancelLine, cancelAll } = await import('../src/scheduler.js');
const { CanvasParticleRenderer } = await import('../src/canvas-particles.js');
const { createLayerEl, createSylStack } = await import('../src/layout.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeG(t = 9000) { return { currentTime: () => t }; }

function makeStage() {
  const appended = [];
  return {
    appendChild: vi.fn(el => appended.push(el)),
    ownerDocument: { createElement: vi.fn(() => ({
      textContent: '', style: { cssText: '' },
      animate: vi.fn(() => ({ cancel: vi.fn() })),
      remove: vi.fn(), children: [],
    })) },
    offsetWidth: 800, offsetHeight: 450,
    _appended: appended,
  };
}

function spec(posX, posY, clip = null, layer = 0, text = 'x') {
  return {
    text, layer, posX, posY, clip,
    startMs: 10000, endMs: 11000, duration: 1000,
    style: { left: '50%', top: '50%', color: 'white', transform: 'translate(-50%,-50%)' },
    keyframes: [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }],
  };
}

beforeEach(() => {
  cancelAll();
  vi.clearAllMocks();
});

// ── Syl grouping ──────────────────────────────────────────────────────────────

describe('syl grouping by posX/posY', () => {
  it('specs at different positions create separate DOM elements', () => {
    const stage = makeStage();
    compileAndSchedule('L1', [spec(100, 240), spec(300, 240)], makeG(), stage, {});
    expect(stage.appendChild).toHaveBeenCalledTimes(2);
  });

  it('two unclipped specs at same position → two DOM elements (no wrapper)', () => {
    const stage = makeStage();
    compileAndSchedule('L2', [spec(200, 240, null, 0), spec(200, 240, null, 1)], makeG(), stage, {});
    expect(createLayerEl).toHaveBeenCalledTimes(2);
    expect(createSylStack).not.toHaveBeenCalled();
    expect(CanvasParticleRenderer).not.toHaveBeenCalled();
  });

  it('specs without posX each get their own group (fallback key)', () => {
    const stage = makeStage();
    // Both have posX=null (no \pos tag)
    const s1 = { ...spec(null, null, null, 0, 'a'), posX: null, posY: null };
    const s2 = { ...spec(null, null, null, 0, 'b'), posX: null, posY: null };
    compileAndSchedule('L3', [s1, s2], makeG(), stage, {});
    // Each gets its own group → 2 elements
    expect(createLayerEl).toHaveBeenCalledTimes(2);
  });
});

// ── Clipped specs → syl-stack wrapper ─────────────────────────────────────────

describe('clipped specs → syl-stack DOM wrapper', () => {
  const clip = { x1: 100, y1: 100, x2: 400, y2: 300 };

  it('3 clipped specs at same position → createSylStack called once', () => {
    const stage = makeStage();
    const specs = [spec(250, 200, clip, 0, 'a'), spec(250, 200, clip, 1, 'b'), spec(250, 200, clip, 2, 'c')];
    compileAndSchedule('L4', specs, makeG(), stage, {});
    expect(createSylStack).toHaveBeenCalledTimes(1);
    expect(createSylStack.mock.calls[0][0]).toHaveLength(3);
  });

  it('wrapper is appended to stage', () => {
    const stage = makeStage();
    compileAndSchedule('L5', [spec(250, 200, clip, 0)], makeG(), stage, {});
    expect(stage.appendChild).toHaveBeenCalledTimes(1);
    expect(stage._appended[0].className).toBe('syl-stack');
  });

  it('clipped specs do not use Canvas even if count exceeds threshold', () => {
    const stage = makeStage();
    const specs = Array.from({ length: 60 }, (_, i) => spec(250, 200, clip, i));
    compileAndSchedule('L6', specs, makeG(), stage, {});
    expect(CanvasParticleRenderer).not.toHaveBeenCalled();
    expect(createSylStack).toHaveBeenCalled();
  });
});

// ── Unclipped N > CANVAS_THRESHOLD → Canvas ───────────────────────────────────

describe('Canvas threshold routing', () => {
  it('51 unclipped specs at same position → CanvasParticleRenderer instantiated', () => {
    const stage = makeStage();
    const specs = Array.from({ length: 51 }, (_, i) => spec(320, 240, null, i));
    compileAndSchedule('L7', specs, makeG(), stage, {});
    expect(CanvasParticleRenderer).toHaveBeenCalledTimes(1);
    expect(CanvasParticleRenderer.mock.results[0].value.start).toHaveBeenCalled();
  });

  it('Canvas path: no DOM elements created for particle group', () => {
    const stage = makeStage();
    const specs = Array.from({ length: 51 }, (_, i) => spec(320, 240, null, i));
    compileAndSchedule('L8', specs, makeG(), stage, {});
    expect(createLayerEl).not.toHaveBeenCalled();
    expect(stage.appendChild).not.toHaveBeenCalled();
  });

  it('50 unclipped specs → DOM path (at threshold, not above)', () => {
    const stage = makeStage();
    const specs = Array.from({ length: 50 }, (_, i) => spec(320, 240, null, i));
    compileAndSchedule('L9', specs, makeG(), stage, {});
    expect(CanvasParticleRenderer).not.toHaveBeenCalled();
    expect(createLayerEl).toHaveBeenCalledTimes(50);
  });

  it('3 clipped + 60 unclipped: DOM wrapper for clipped, Canvas for unclipped', () => {
    const clip = { x1: 200, y1: 150, x2: 450, y2: 330 };
    const stage = makeStage();
    const clippedSpecs   = [0, 1, 2].map(l => spec(320, 240, clip, l, `c${l}`));
    const unclippedSpecs = Array.from({ length: 60 }, (_, i) => spec(320, 240, null, i + 10, `p${i}`));
    compileAndSchedule('L10', [...clippedSpecs, ...unclippedSpecs], makeG(), stage, {});
    // One syl-stack wrapper
    expect(createSylStack).toHaveBeenCalledTimes(1);
    // One canvas renderer for particles
    expect(CanvasParticleRenderer).toHaveBeenCalledTimes(1);
    // Only the wrapper is appended to stage (canvas renderer manages its own canvas)
    expect(stage.appendChild).toHaveBeenCalledTimes(1);
  });
});

// ── cancelLine: destroys canvas renderers ─────────────────────────────────────

describe('cancelLine canvas cleanup', () => {
  it('calls destroy() on CanvasParticleRenderer', () => {
    const stage = makeStage();
    const specs = Array.from({ length: 51 }, (_, i) => spec(320, 240, null, i));
    compileAndSchedule('LC1', specs, makeG(), stage, {});
    const renderer = CanvasParticleRenderer.mock.results[0].value;
    cancelLine('LC1');
    expect(renderer.destroy).toHaveBeenCalled();
  });

  it('cancelLine is safe when no canvas renderers exist', () => {
    const stage = makeStage();
    compileAndSchedule('LC2', [spec(100, 200)], makeG(), stage, {});
    expect(() => cancelLine('LC2')).not.toThrow();
  });
});
