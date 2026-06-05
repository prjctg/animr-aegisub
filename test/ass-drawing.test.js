import { describe, it, expect, beforeAll } from 'vitest';
import { parseDrawingCmds } from '../src/ass-drawing.js';

// ── Mock Path2D ───────────────────────────────────────────────────────────────
// jsdom does not include a Path2D implementation, so we provide a minimal one
// that records operations for inspection.

class MockPath2D {
  constructor() { this.ops = []; }
  moveTo(x, y)                           { this.ops.push({ cmd: 'M', x, y }); }
  lineTo(x, y)                           { this.ops.push({ cmd: 'L', x, y }); }
  bezierCurveTo(cx1, cy1, cx2, cy2, x, y) {
    this.ops.push({ cmd: 'B', cx1, cy1, cx2, cy2, x, y });
  }
  closePath()                            { this.ops.push({ cmd: 'c' }); }
}

beforeAll(() => {
  globalThis.Path2D = MockPath2D;
});

// ── parseDrawingCmds ──────────────────────────────────────────────────────────

describe('parseDrawingCmds: return type', () => {
  it('returns a Path2D instance', () => {
    const p = parseDrawingCmds('m 0 0 l 10 10', 1);
    expect(p).toBeInstanceOf(MockPath2D);
  });

  it('returns a Path2D for empty string', () => {
    const p = parseDrawingCmds('', 1);
    expect(p).toBeInstanceOf(MockPath2D);
    expect(p.ops).toHaveLength(0);
  });
});

// ── m (moveTo) ────────────────────────────────────────────────────────────────

describe('parseDrawingCmds: m command', () => {
  it('emits moveTo for "m x y"', () => {
    const p = parseDrawingCmds('m 10 20', 1);
    expect(p.ops).toEqual([{ cmd: 'M', x: 10, y: 20 }]);
  });

  it('emits moveTo for "m 0 0"', () => {
    const p = parseDrawingCmds('m 0 0', 1);
    expect(p.ops[0]).toMatchObject({ cmd: 'M', x: 0, y: 0 });
  });

  it('handles negative coordinates', () => {
    const p = parseDrawingCmds('m -5 -3', 1);
    expect(p.ops[0]).toMatchObject({ cmd: 'M', x: -5, y: -3 });
  });
});

// ── n (moveTo without close) ─────────────────────────────────────────────────

describe('parseDrawingCmds: n command', () => {
  it('emits moveTo for "n x y"', () => {
    const p = parseDrawingCmds('n 15 25', 1);
    expect(p.ops).toEqual([{ cmd: 'M', x: 15, y: 25 }]);
  });
});

// ── l (lineTo) ────────────────────────────────────────────────────────────────

describe('parseDrawingCmds: l command', () => {
  it('emits lineTo for a single pair', () => {
    const p = parseDrawingCmds('m 0 0 l 10 20', 1);
    expect(p.ops[1]).toMatchObject({ cmd: 'L', x: 10, y: 20 });
  });

  it('emits multiple lineTo for multiple pairs', () => {
    const p = parseDrawingCmds('m 0 0 l 10 0 10 10 0 10', 1);
    expect(p.ops).toHaveLength(4);
    expect(p.ops[1]).toMatchObject({ cmd: 'L', x: 10, y: 0 });
    expect(p.ops[2]).toMatchObject({ cmd: 'L', x: 10, y: 10 });
    expect(p.ops[3]).toMatchObject({ cmd: 'L', x: 0,  y: 10 });
  });
});

// ── b (bezierCurveTo) ─────────────────────────────────────────────────────────

describe('parseDrawingCmds: b command', () => {
  it('emits bezierCurveTo for "b cx1 cy1 cx2 cy2 x y"', () => {
    const p = parseDrawingCmds('m 0 0 b 5 0 5 10 0 10', 1);
    expect(p.ops[1]).toMatchObject({ cmd: 'B', cx1: 5, cy1: 0, cx2: 5, cy2: 10, x: 0, y: 10 });
  });

  it('emits multiple bezierCurveTo for multiple segments', () => {
    const p = parseDrawingCmds('m 0 0 b 5 0 5 10 0 10 b -4 10 -4 0 0 0', 1);
    expect(p.ops.filter(o => o.cmd === 'B')).toHaveLength(2);
  });

  it('handles the lollipop candy shape without throwing', () => {
    const cmds = 'm 0 0 b 21 0 21 25 0 25 b -19 25 -19 0 0 0';
    expect(() => parseDrawingCmds(cmds, 1)).not.toThrow();
    const p = parseDrawingCmds(cmds, 1);
    const beziers = p.ops.filter(o => o.cmd === 'B');
    expect(beziers).toHaveLength(2);
    // First bezier: b 21 0 21 25 0 25
    expect(beziers[0]).toMatchObject({ cx1: 21, cy1: 0, cx2: 21, cy2: 25, x: 0, y: 25 });
    // Second bezier: b -19 25 -19 0 0 0
    expect(beziers[1]).toMatchObject({ cx1: -19, cy1: 25, cx2: -19, cy2: 0, x: 0, y: 0 });
  });
});

// ── c (closePath) ─────────────────────────────────────────────────────────────

describe('parseDrawingCmds: c command', () => {
  it('emits closePath for "c"', () => {
    const p = parseDrawingCmds('m 0 0 l 10 0 l 10 10 c', 1);
    expect(p.ops.at(-1)).toMatchObject({ cmd: 'c' });
  });
});

// ── s command (b-spline approximation) ───────────────────────────────────────

describe('parseDrawingCmds: s command', () => {
  it('approximates b-spline with lineTo calls', () => {
    const p = parseDrawingCmds('m 0 0 s 10 5 20 0', 1);
    const lines = p.ops.filter(o => o.cmd === 'L');
    expect(lines.length).toBeGreaterThan(0);
  });
});

// ── Drawing scale ─────────────────────────────────────────────────────────────

describe('parseDrawingCmds: drawing scale factor', () => {
  it('\\p1 → scale=1, coordinates unchanged', () => {
    const p = parseDrawingCmds('m 20 40', 1);
    expect(p.ops[0]).toMatchObject({ cmd: 'M', x: 20, y: 40 });
  });

  it('\\p2 → scale=0.5, coordinates halved', () => {
    const p = parseDrawingCmds('m 20 40', 2);
    expect(p.ops[0].x).toBeCloseTo(10);
    expect(p.ops[0].y).toBeCloseTo(20);
  });

  it('\\p4 → scale=0.125, coordinates divided by 8', () => {
    const p = parseDrawingCmds('m 80 160', 4);
    expect(p.ops[0].x).toBeCloseTo(10);
    expect(p.ops[0].y).toBeCloseTo(20);
  });

  it('scale applies to bezier control points as well', () => {
    const p = parseDrawingCmds('m 0 0 b 40 0 40 80 0 80', 2);
    const bz = p.ops[1];
    expect(bz.cx1).toBeCloseTo(20);
    expect(bz.cy1).toBeCloseTo(0);
    expect(bz.cx2).toBeCloseTo(20);
    expect(bz.cy2).toBeCloseTo(40);
    expect(bz.x).toBeCloseTo(0);
    expect(bz.y).toBeCloseTo(40);
  });
});

// ── Robustness ────────────────────────────────────────────────────────────────

describe('parseDrawingCmds: robustness', () => {
  it('ignores unknown commands without throwing', () => {
    expect(() => parseDrawingCmds('m 0 0 q 5 5 10 0', 1)).not.toThrow();
  });

  it('handles uppercase command letters', () => {
    const p = parseDrawingCmds('M 10 20 L 30 40', 1);
    expect(p.ops[0]).toMatchObject({ cmd: 'M', x: 10, y: 20 });
    expect(p.ops[1]).toMatchObject({ cmd: 'L', x: 30, y: 40 });
  });

  it('handles extra whitespace between tokens', () => {
    const p = parseDrawingCmds('  m  0  0  l  10  10  ', 1);
    expect(p.ops).toHaveLength(2);
  });

  it('does not throw on incomplete bezier (missing args)', () => {
    expect(() => parseDrawingCmds('m 0 0 b 5 5 10', 1)).not.toThrow();
  });

  it('handles drawingScale=0 gracefully (treated as scale=1)', () => {
    const p = parseDrawingCmds('m 10 20', 0);
    // scale = 1 / 2^(max(1,0)-1) = 1 / 2^0 = 1
    expect(p.ops[0]).toMatchObject({ cmd: 'M', x: 10, y: 20 });
  });
});
