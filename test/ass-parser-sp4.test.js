import { describe, it, expect } from 'vitest';
import { parseAssDialogue } from '../src/ass-parser.js';

const opts = { xres: 640, yres: 480, containerW: 800, containerH: 450 };

function dial(text, extra = {}) {
  return { layer: 0, start_time: 0, end_time: 1000, text, ...extra };
}

// ── \clip() parsing ───────────────────────────────────────────────────────────

describe('\\clip(x1,y1,x2,y2) tag', () => {
  it('sets spec.clip to {x1,y1,x2,y2}', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(10,20,300,260)}hello'), opts);
    expect(spec.clip).toEqual({ x1: 10, y1: 20, x2: 300, y2: 260 });
  });

  it('spec.clip is null when no \\clip tag', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)}hello'), opts);
    expect(spec.clip).toBeNull();
  });

  it('sets style.clipPath as CSS inset() string', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(0,0,640,480)}hello'), opts);
    expect(spec.style.clipPath).toMatch(/^inset\(/);
    // top = 0%, right = 0%, bottom = 0%, left = 0%
    expect(spec.style.clipPath).toBe('inset(0.000% 0.000% 0.000% 0.000%)');
  });

  it('computes correct inset percentages for a partial clip', () => {
    // clip(320,0,640,480) → left=50%, right=0%, top=0%, bottom=0%
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(320,0,640,480)}hello'), opts);
    expect(spec.style.clipPath).toBe('inset(0.000% 0.000% 0.000% 50.000%)');
  });

  it('handles float clip coordinates', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(10.5,20.5,300.5,260.5)}hello'), opts);
    expect(spec.clip).toEqual({ x1: 10.5, y1: 20.5, x2: 300.5, y2: 260.5 });
  });

  it('handles negative x1 (stores as-is)', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(-10,0,640,480)}hello'), opts);
    expect(spec.clip).not.toBeNull();
    expect(spec.clip.x1).toBe(-10);
  });

  it('\\clip does not affect style.left or style.top', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(10,20,300,260)}hello'), opts);
    expect(spec.style.left).toBe('50.000%');
    expect(spec.style.top).toBe('50.000%');
  });
});

// ── posX / posY raw fields ────────────────────────────────────────────────────

describe('posX / posY raw fields', () => {
  it('\\pos(320,240) sets spec.posX=320, spec.posY=240', () => {
    const spec = parseAssDialogue(dial('{\\pos(320,240)}hello'), opts);
    expect(spec.posX).toBe(320);
    expect(spec.posY).toBe(240);
  });

  it('\\move(100,200,300,400) sets posX=100, posY=200 (move.x1/y1 fallback)', () => {
    const spec = parseAssDialogue(dial('{\\move(100,200,300,400)}hello'), opts);
    expect(spec.posX).toBe(100);
    expect(spec.posY).toBe(200);
  });

  it('no position tags → posX=null, posY=null', () => {
    const spec = parseAssDialogue(dial('{\\fad(100,100)}hello'), opts);
    expect(spec.posX).toBeNull();
    expect(spec.posY).toBeNull();
  });

  it('\\pos takes precedence when both \\pos and \\move are present', () => {
    const spec = parseAssDialogue(dial('{\\pos(10,20)\\move(100,200,300,400)}hello'), opts);
    // posX comes from \pos, not move
    expect(spec.posX).toBe(10);
    expect(spec.posY).toBe(20);
  });
});

// ── move top-level field ──────────────────────────────────────────────────────

describe('spec.move top-level field', () => {
  it('\\move(x1,y1,x2,y2,t1,t2) → full move object exposed on spec', () => {
    const spec = parseAssDialogue(dial('{\\move(100,200,300,400,0,500)}hello'), opts);
    expect(spec.move).toMatchObject({ x1: 100, y1: 200, x2: 300, y2: 400, t1: 0, t2: 500 });
  });

  it('\\move without timing → t1=0, t2 resolved to duration in move', () => {
    // When no t2 provided, parseTags emits t2:null; parseAssDialogue resolves null t2→duration
    const spec = parseAssDialogue(dial('{\\move(100,200,300,400)}hello'), opts);
    expect(spec.move).not.toBeNull();
    expect(spec.move.t1).toBe(0);
    expect(spec.move.t2).toBe(spec.duration); // null resolved to duration
  });

  it('\\pos only → spec.move is null', () => {
    const spec = parseAssDialogue(dial('{\\pos(320,240)}hello'), opts);
    expect(spec.move).toBeNull();
  });

  it('no position tags → spec.move is null', () => {
    const spec = parseAssDialogue(dial('{\\fad(100,100)}hello'), opts);
    expect(spec.move).toBeNull();
  });
});

// ── Combined: \clip + \pos ────────────────────────────────────────────────────

describe('\\clip + \\pos combined', () => {
  it('posX/posY from \\pos, clip from \\clip — independent', () => {
    const spec = parseAssDialogue(dial('{\\pos(320,240)\\clip(50,60,400,300)}hello'), opts);
    expect(spec.posX).toBe(320);
    expect(spec.posY).toBe(240);
    expect(spec.clip).toEqual({ x1: 50, y1: 60, x2: 400, y2: 300 });
  });

  it('\\an5 anchor, \\pos, \\clip — all three can coexist', () => {
    const spec = parseAssDialogue(dial('{\\an5\\pos(320,240)\\clip(10,20,300,260)\\fad(100,200)}hello'), opts);
    expect(spec.posX).toBe(320);
    expect(spec.clip).toEqual({ x1: 10, y1: 20, x2: 300, y2: 260 });
    expect(spec.style.transform).toBe('translate(-50%,-50%)');
    // fad still works
    expect(spec.keyframes[0].opacity).toBe(0);
  });
});

// ── Backward compatibility: existing fields still present ─────────────────────

describe('backward compatibility', () => {
  it('SP3 spec still has layer, style, keyframes', () => {
    const spec = parseAssDialogue(
      dial('{\\an5\\pos(320,240)\\fscx130\\fscy130\\t(0,200,\\fscx100\\fscy100)}hello'), opts,
    );
    expect(spec.layer).toBe(0);
    expect(spec.style.transform).toBeTruthy();
    expect(spec.keyframes.length).toBeGreaterThan(0);
  });

  it('layer from dialogue.layer field is preserved', () => {
    const spec = parseAssDialogue({ ...dial('{\\pos(320,240)}hello'), layer: 3 }, opts);
    expect(spec.layer).toBe(3);
  });
});
