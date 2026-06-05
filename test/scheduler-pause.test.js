// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compileAndSchedule, cancelAll, pauseAll } from '../src/scheduler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStage() {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  return stage;
}

function makeSpec(startMs = 10000, endMs = 11000) {
  return {
    posX: 320, posY: 240,
    move: null, clip: null, iclip: null,
    drawingScale: 0, drawingCmds: null,
    startMs, endMs,
    duration: endMs - startMs,
    layer: 0,
    text: 'hi',
    style: {
      left: '50%', top: '50%',
      transform: 'translate(-50%,-50%)',
      color: 'white', opacity: 1,
    },
    keyframes: [{ offset: 0, opacity: 0, transform: 'translate(-50%,-50%)' },
                { offset: 1, opacity: 1, transform: 'translate(-50%,-50%)' }],
  };
}

function makeG(t = 9000) {
  return { currentTime: () => t };
}

// Mock animation returned by el.animate()
function makeMockAnim(initialState = 'running') {
  return {
    playState: initialState,
    pause: vi.fn(),
    cancel: vi.fn(),
  };
}

// ── pauseAll ──────────────────────────────────────────────────────────────────

describe('pauseAll', () => {
  beforeEach(() => {
    // Patch HTMLElement.prototype.animate globally for this suite
    HTMLElement.prototype.animate = vi.fn(() => makeMockAnim('running'));
  });

  afterEach(() => {
    cancelAll();
    vi.restoreAllMocks();
    delete HTMLElement.prototype.animate;
  });

  it('calls pause() on running animations', () => {
    const stage = makeStage();
    const mockAnim = makeMockAnim('running');
    HTMLElement.prototype.animate = vi.fn(() => mockAnim);

    compileAndSchedule('line1', [makeSpec()], makeG(), stage, { xres: 640, yres: 480 });

    pauseAll();

    expect(mockAnim.pause).toHaveBeenCalledTimes(1);
  });

  it('does not call pause() on finished animations', () => {
    const stage = makeStage();
    const mockAnim = makeMockAnim('finished');
    HTMLElement.prototype.animate = vi.fn(() => mockAnim);

    compileAndSchedule('line2', [makeSpec()], makeG(), stage, { xres: 640, yres: 480 });

    pauseAll();

    expect(mockAnim.pause).not.toHaveBeenCalled();
  });

  it('pauses animations across multiple lines', () => {
    const stage = makeStage();
    const anim1 = makeMockAnim('running');
    const anim2 = makeMockAnim('running');
    let call = 0;
    HTMLElement.prototype.animate = vi.fn(() => call++ === 0 ? anim1 : anim2);

    compileAndSchedule('lineA', [makeSpec(10000)], makeG(), stage, { xres: 640, yres: 480 });
    compileAndSchedule('lineB', [makeSpec(11000)], makeG(), stage, { xres: 640, yres: 480 });

    pauseAll();

    expect(anim1.pause).toHaveBeenCalledTimes(1);
    expect(anim2.pause).toHaveBeenCalledTimes(1);
  });

  it('is safe to call with no pending lines', () => {
    cancelAll(); // ensure clean state
    expect(() => pauseAll()).not.toThrow();
  });
});

// ── cancelAll after pause (PLAY strategy) ────────────────────────────────────

describe('cancelAll after pauseAll (PLAY strategy)', () => {
  beforeEach(() => {
    HTMLElement.prototype.animate = vi.fn(() => makeMockAnim('running'));
  });

  afterEach(() => {
    cancelAll();
    vi.restoreAllMocks();
    delete HTMLElement.prototype.animate;
  });

  it('cancelAll removes DOM elements after a pause', () => {
    const stage = makeStage();
    compileAndSchedule('lineX', [makeSpec()], makeG(), stage, { xres: 640, yres: 480 });
    expect(stage.children.length).toBeGreaterThan(0);

    pauseAll();
    cancelAll();

    expect(stage.children.length).toBe(0);
  });

  it('cancelAll clears internal state so pauseAll on empty map is safe', () => {
    const stage = makeStage();
    compileAndSchedule('lineY', [makeSpec()], makeG(), stage, { xres: 640, yres: 480 });

    cancelAll();
    expect(() => pauseAll()).not.toThrow();
  });
});

// ── Drawing spec routing ──────────────────────────────────────────────────────

describe('compileAndSchedule: drawing spec routing', () => {
  beforeEach(() => {
    // Canvas getContext mock
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      translate: vi.fn(),
      fill: vi.fn(),
      set fillStyle(_) {},
      set filter(_) {},
    }));
    HTMLElement.prototype.animate = vi.fn(() => makeMockAnim('running'));
  });

  afterEach(() => {
    cancelAll();
    vi.restoreAllMocks();
    delete HTMLElement.prototype.animate;
    delete HTMLCanvasElement.prototype.getContext;
  });

  it('creates a <canvas> element for a drawing spec (drawingScale > 0)', () => {
    // Provide a minimal Path2D mock
    globalThis.Path2D = class {
      moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {}
    };

    const stage = makeStage();
    const drawingSpec = {
      ...makeSpec(),
      drawingScale: 1,
      drawingCmds: 'm 0 0 l 10 10',
      text: '',
    };

    compileAndSchedule('lineD', [drawingSpec], makeG(), stage, { xres: 640, yres: 480 });

    const canvas = stage.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('creates a <div> element for a text spec (drawingScale=0)', () => {
    const stage = makeStage();
    compileAndSchedule('lineT', [makeSpec()], makeG(), stage, { xres: 640, yres: 480 });

    const div = stage.querySelector('div');
    expect(div).not.toBeNull();
    expect(stage.querySelector('canvas')).toBeNull();
  });
});
