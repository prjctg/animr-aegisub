import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DOM mock (scheduler.js uses el.animate + el.remove + stage.appendChild) ──

function makeMockEl(text = 'x') {
  const anims = [];
  const el = {
    textContent: text,
    style: { cssText: '' },
    animate: vi.fn((keyframes, opts) => {
      const anim = { cancel: vi.fn(), keyframes, opts };
      anims.push(anim);
      return anim;
    }),
    remove: vi.fn(),
    _anims: anims,
  };
  return el;
}

function makeMockStage() {
  const children = [];
  return {
    appendChild: vi.fn(el => children.push(el)),
    ownerDocument: {
      createElement: vi.fn(tag => makeMockEl()),
    },
    _children: children,
  };
}

function makeG(currentTimeMs = 10000) {
  return { currentTime: () => currentTimeMs };
}

// ── Import after mocking ──────────────────────────────────────────────────────

// We test the scheduling logic by importing and calling directly.
// layout.createLayerEl is mocked via vi.mock so scheduler doesn't need DOM.

vi.mock('../src/layout.js', () => ({
  createLayerEl: vi.fn((spec, opts, stage) => {
    return makeMockEl(spec.text);
  }),
  buildStageHtml: () => '',
  computeSlotYs: (n, H, opts) => [H * 0.5],
}));

const { compileAndSchedule, cancelLine, cancelAll } = await import('../src/scheduler.js');

describe('compileAndSchedule', () => {
  beforeEach(() => {
    cancelAll();  // clear state between tests
    vi.clearAllMocks();
  });

  const makeSpec = (startMs, duration, text = 'hi') => ({
    text,
    startMs,
    endMs: startMs + duration,
    duration,
    layer: 0,
    style: { left: '50%', top: '50%', color: 'white', opacity: 1 },
    keyframes: [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }],
  });

  it('creates an element per spec and appends to stage', () => {
    const stage = makeMockStage();
    const G = makeG(9000);
    compileAndSchedule('line1', [makeSpec(10000, 1000)], G, stage, {});
    expect(stage.appendChild).toHaveBeenCalledTimes(1);
  });

  it('calls el.animate with positive delay when spec is in the future', () => {
    const stage = makeMockStage();
    const G = makeG(9000);  // now = 9000ms
    compileAndSchedule('line2', [makeSpec(10000, 1000)], G, stage, {});
    const el = stage._children[0];
    expect(el.animate).toHaveBeenCalledTimes(1);
    const callArgs = el.animate.mock.calls[0];
    expect(callArgs[1].delay).toBe(1000);  // 10000 - 9000
  });

  it('clamps delay to 0 when spec starts slightly before now', () => {
    const stage = makeMockStage();
    const G = makeG(10200);  // now = 10200, spec starts at 10000
    compileAndSchedule('line3', [makeSpec(10000, 1000)], G, stage, {});
    const el = stage._children[0];
    const callArgs = el.animate.mock.calls[0];
    expect(callArgs[1].delay).toBe(0);
  });

  it('skips specs that have already fully elapsed (delay < -duration)', () => {
    const stage = makeMockStage();
    const G = makeG(12500);  // now = 12500, spec: start=10000, dur=1000 → fully past
    compileAndSchedule('line4', [makeSpec(10000, 1000)], G, stage, {});
    // Element created but animate not called
    const el = stage._children[0];
    expect(el.animate).not.toHaveBeenCalled();
  });

  it('uses spec.duration as animation duration', () => {
    const stage = makeMockStage();
    const G = makeG(9000);
    compileAndSchedule('line5', [makeSpec(10000, 800)], G, stage, {});
    const el = stage._children[0];
    expect(el.animate.mock.calls[0][1].duration).toBe(800);
  });

  it('sets fill:forwards on all animations', () => {
    const stage = makeMockStage();
    compileAndSchedule('line6', [makeSpec(10000, 1000)], makeG(9000), stage, {});
    const el = stage._children[0];
    expect(el.animate.mock.calls[0][1].fill).toBe('forwards');
  });

  it('handles multiple specs per line', () => {
    const stage = makeMockStage();
    const G = makeG(9000);
    compileAndSchedule('line7', [
      makeSpec(10000, 1000, 'syl1'),
      makeSpec(11000, 800, 'syl2'),
      makeSpec(12000, 600, 'syl3'),
    ], G, stage, {});
    expect(stage.appendChild).toHaveBeenCalledTimes(3);
  });
});

describe('cancelLine', () => {
  beforeEach(() => {
    cancelAll();
    vi.clearAllMocks();
  });

  it('calls .cancel() on all animations for the line', () => {
    const stage = makeMockStage();
    compileAndSchedule('lineX', [
      { text: 'a', startMs: 10000, endMs: 11000, duration: 1000, layer: 0,
        style: { left: '50%', top: '50%', color: 'white', opacity: 1 },
        keyframes: [] },
    ], makeG(9000), stage, {});
    const el = stage._children[0];
    cancelLine('lineX');
    for (const anim of el._anims) {
      expect(anim.cancel).toHaveBeenCalled();
    }
  });

  it('calls .remove() on all elements', () => {
    const stage = makeMockStage();
    compileAndSchedule('lineY', [
      { text: 'b', startMs: 10000, endMs: 11000, duration: 1000, layer: 0,
        style: { left: '50%', top: '50%', color: 'white', opacity: 1 },
        keyframes: [] },
    ], makeG(9000), stage, {});
    const el = stage._children[0];
    cancelLine('lineY');
    expect(el.remove).toHaveBeenCalled();
  });

  it('is idempotent — second call for same line is a no-op', () => {
    const stage = makeMockStage();
    compileAndSchedule('lineZ', [
      { text: 'c', startMs: 10000, endMs: 11000, duration: 1000, layer: 0,
        style: { left: '50%', top: '50%', color: 'white', opacity: 1 },
        keyframes: [] },
    ], makeG(9000), stage, {});
    cancelLine('lineZ');
    expect(() => cancelLine('lineZ')).not.toThrow();
  });
});

describe('cancelAll', () => {
  it('clears all pending lines', () => {
    const G = makeG(9000);
    const makeSpec2 = (text) => ({
      text, startMs: 10000, endMs: 11000, duration: 1000, layer: 0,
      style: { left: '50%', top: '50%', color: 'white', opacity: 1 },
      keyframes: [],
    });
    compileAndSchedule('L1', [makeSpec2('a')], G, makeMockStage(), {});
    compileAndSchedule('L2', [makeSpec2('b')], G, makeMockStage(), {});
    cancelAll();
    // After cancelAll, cancelLine for those IDs should be no-ops (already cleared)
    expect(() => { cancelLine('L1'); cancelLine('L2'); }).not.toThrow();
  });
});
