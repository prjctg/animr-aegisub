import { describe, it, expect } from 'vitest';
import { parseAssDialogue } from '../src/ass-parser.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Make a minimal dialogue fixture. */
function dlg(text, { start = 0, end = 1000, layer = 0 } = {}) {
  return { layer, start_time: start, end_time: end, text };
}

/** Default opts: 1:1 video→container mapping to keep numbers clean. */
const OPTS = { xres: 800, yres: 450, containerW: 800, containerH: 450 };

/** Parse dialogue and return the LayerSpec. */
function parse(text, { duration = 1000, ...rest } = {}) {
  return parseAssDialogue(dlg(text, { start: 0, end: duration }), { ...OPTS, ...rest });
}

// ── Group A: static new tags ──────────────────────────────────────────────────

describe('static fscx', () => {
  it(String.raw`\fscx150 → every keyframe transform contains scaleX(1.5)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\fscx150}Hello`);
    expect(spec.keyframes.length).toBeGreaterThan(0);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('scaleX(1.5)');
    }
  });
});

describe('static fscy', () => {
  it(String.raw`\fscy80 → every keyframe transform contains scaleY(0.8)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\fscy80}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('scaleY(0.8)');
    }
  });
});

describe('static frz', () => {
  it(String.raw`\frz45 → every keyframe transform contains rotate(45deg)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\frz45}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('rotate(45deg)');
    }
  });
});

describe('static frx', () => {
  it(String.raw`\frx30 → every keyframe transform contains rotateX(30deg)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\frx30}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('rotateX(30deg)');
    }
  });
});

describe('static fry', () => {
  it(String.raw`\fry-15 → every keyframe transform contains rotateY(-15deg)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\fry-15}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('rotateY(-15deg)');
    }
  });
});

describe('static blur', () => {
  it(String.raw`\blur3 → every keyframe has filter blur(3.00px) and style.filter is set`, () => {
    const spec = parse(String.raw`{\pos(400,225)\blur3}Hello`);
    expect(spec.style.filter).toBe('blur(3.00px)');
    for (const kf of spec.keyframes) {
      expect(kf.filter).toBe('blur(3.00px)');
    }
  });
});

describe('static bord', () => {
  it(String.raw`\bord2 → every keyframe has WebkitTextStrokeWidth 2.00px`, () => {
    const spec = parse(String.raw`{\pos(400,225)\bord2}Hello`);
    expect(spec.style.WebkitTextStrokeWidth).toBe('2.00px');
    for (const kf of spec.keyframes) {
      expect(kf.WebkitTextStrokeWidth).toBe('2.00px');
    }
  });
});

describe(String.raw`static \fscx + \fscy combined`, () => {
  it(String.raw`\fscx120\fscy120 → both appear in every keyframe transform`, () => {
    const spec = parse(String.raw`{\pos(400,225)\fscx120\fscy120}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('scaleX(1.2)');
      expect(kf.transform).toContain('scaleY(1.2)');
    }
  });
});

describe('no SP3 tags', () => {
  it('keyframes have exactly {offset, opacity, transform} — no filter or stroke', () => {
    const spec = parse(String.raw`{\pos(400,225)\fad(100,100)}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf).not.toHaveProperty('filter');
      expect(kf).not.toHaveProperty('WebkitTextStrokeWidth');
      expect(kf).toHaveProperty('offset');
      expect(kf).toHaveProperty('opacity');
      expect(kf).toHaveProperty('transform');
    }
  });
});

// ── Group B: \t() tween interpolation ────────────────────────────────────────

describe(String.raw`\t() single-segment fscx tween`, () => {
  it('keyframes only at tween boundaries: offset=0 → scaleX(1), offset=1 → scaleX(2)', () => {
    // A single \t(0,1000,\fscx200) produces keyframes only at t1 and t2.
    // The browser interpolates between them — no explicit mid-point keyframe needed.
    const spec = parse(String.raw`{\pos(400,225)\t(0,1000,\fscx200)}Hello`, { duration: 1000 });

    expect(spec.keyframes).toHaveLength(2);
    const kf0 = spec.keyframes.find(kf => kf.offset === 0);
    const kf1 = spec.keyframes.find(kf => kf.offset === 1);
    expect(kf0).toBeTruthy();
    expect(kf1).toBeTruthy();

    // offset=0 (tMs=0): tMs <= t1=0 → returns initialVal=100 → scaleX(1)
    expect(kf0.transform).toContain('scaleX(1)');
    // offset=1 (tMs=1000): tMs >= t2=1000 → returns value=200 → scaleX(2)
    expect(kf1.transform).toContain('scaleX(2)');
  });

  it('keyframe at offset=0 holds initialVal when tween starts at t1=200', () => {
    const spec = parse(String.raw`{\pos(400,225)\t(200,800,\fscx200)}Hello`, { duration: 1000 });
    const kf0 = spec.keyframes.find(kf => kf.offset === 0);
    expect(kf0).toBeTruthy();
    // At t=0, tMs < t1=200 → value stays at default 100 → scaleX(1)
    expect(kf0.transform).toContain('scaleX(1)');
  });
});

describe(String.raw`\t() two-segment fscx tween`, () => {
  it('boundary at offset=0.5 holds end-of-first-segment value scaleX(1.5)', () => {
    // \t(0,500,\fscx150)\t(500,1000,\fscx80) — t2 of first = t1 of second = 500ms
    // → explicit boundary keyframe at offset=0.5
    const spec = parse(String.raw`{\pos(400,225)\t(0,500,\fscx150)\t(500,1000,\fscx80)}Hello`, { duration: 1000 });

    // At t=500ms: first tween completes (prev=150); second tween: tMs=500 <= t1=500 → 150
    const kf5 = spec.keyframes.find(kf => Math.abs(kf.offset - 0.5) < 0.001);
    expect(kf5).toBeTruthy();
    expect(kf5.transform).toContain('scaleX(1.5)');

    // At t=1000ms: second tween completes → 80/100 = 0.8
    const kf1 = spec.keyframes.find(kf => kf.offset === 1);
    expect(kf1.transform).toContain('scaleX(0.8)');
  });
});

describe(String.raw`\t() multi-property tween`, () => {
  it(String.raw`\t(0,500,\fscx150\fscy200) → both axes change in same tween block`, () => {
    const spec = parse(String.raw`{\pos(400,225)\t(0,500,\fscx150\fscy200)}Hello`, { duration: 1000 });
    // At t=500ms (t2 boundary): fscx=150→scaleX(1.5), fscy=200→scaleY(2)
    const kf5 = spec.keyframes.find(kf => Math.abs(kf.offset - 0.5) < 0.001);
    expect(kf5).toBeTruthy();
    expect(kf5.transform).toContain('scaleX(1.5)');
    expect(kf5.transform).toContain('scaleY(2)');
  });
});

// ── Group C: keyframe property consistency ────────────────────────────────────

describe('blur keyframe consistency', () => {
  it(String.raw`animated \t(0,500,\blur5) → ALL keyframes have filter property`, () => {
    const spec = parse(String.raw`{\pos(400,225)\t(0,500,\blur5)}Hello`, { duration: 1000 });
    expect(spec.keyframes.length).toBeGreaterThan(0);
    for (const kf of spec.keyframes) {
      expect(kf).toHaveProperty('filter');
    }
    // offset=0: blur starts at initialVal=0 → blur(0.00px)
    const kf0 = spec.keyframes.find(kf => kf.offset === 0);
    expect(kf0.filter).toBe('blur(0.00px)');
    // offset=0.5 (t2 boundary): blur=5 → blur(5.00px)
    const kf5 = spec.keyframes.find(kf => Math.abs(kf.offset - 0.5) < 0.001);
    expect(kf5.filter).toBe('blur(5.00px)');
  });

  it('no blur tags → no keyframe has filter property', () => {
    const spec = parse(String.raw`{\pos(400,225)\fscx120}Hello`);
    for (const kf of spec.keyframes) {
      expect(kf).not.toHaveProperty('filter');
    }
  });

  it(String.raw`static \blur3 (no tween) → every keyframe has constant filter blur(3.00px)`, () => {
    const spec = parse(String.raw`{\pos(400,225)\blur3}Hello`, { duration: 1000 });
    expect(spec.keyframes).toHaveLength(2);
    for (const kf of spec.keyframes) {
      expect(kf.filter).toBe('blur(3.00px)');
    }
  });
});

// ── Group D: composite transform (scale + rotation + move + fad) ──────────────

describe(String.raw`composite: fscx + \t(frz) + \fad`, () => {
  it('fad boundaries and tween boundary are all present; final keyframe has both scaleX and rotate', () => {
    // \fscx120 (static), \t(0,1000,\frz90), \fad(100,100), duration=1000
    // fad produces offsets: 0, 0.1, 0.9, 1  (frz tween adds only 0 and 1, already present)
    const spec = parse(
      String.raw`{\an5\pos(320,240)\fscx120\t(0,1000,\frz90)\fad(100,100)}Hi`,
      { duration: 1000 }
    );

    const offsets = spec.keyframes.map(kf => kf.offset);
    expect(offsets).toContain(0);
    expect(offsets).toContain(1);
    expect(offsets.some(o => Math.abs(o - 0.1) < 0.001)).toBe(true);
    expect(offsets.some(o => Math.abs(o - 0.9) < 0.001)).toBe(true);

    // Static \fscx120 → scaleX(1.2) in every keyframe
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('scaleX(1.2)');
    }

    // At offset=1 (end of frz tween): rotate(90deg)
    const kf1 = spec.keyframes.find(kf => kf.offset === 1);
    expect(kf1.transform).toContain('rotate(90deg)');

    // At offset=0: frz not yet reached target → rotate(0deg)
    const kf0 = spec.keyframes.find(kf => kf.offset === 0);
    expect(kf0.transform).toContain('rotate(0deg)');
  });
});

describe(String.raw`composite: \move + \t(fscx)`, () => {
  it('transform at move-end boundary (offset=0.6) contains both translate and scaleX', () => {
    // \move(400,225,400,205,0,600) + \t(0,1000,\fscx130), duration=1000
    // move boundary at 0.6, tween boundaries at 0 and 1 → offsets [0, 0.6, 1]
    const spec = parse(
      String.raw`{\an5\move(400,225,400,205,0,600)\t(0,1000,\fscx130)}Hi`,
      { duration: 1000 }
    );

    const offsets = spec.keyframes.map(kf => kf.offset);
    expect(offsets.some(o => Math.abs(o - 0.6) < 0.001)).toBe(true);

    // At offset=0.6 (t=600ms): move is complete, fscx = 100+(130-100)*0.6 = 118 → scaleX(1.18)
    const kf6 = spec.keyframes.find(kf => Math.abs(kf.offset - 0.6) < 0.001);
    expect(kf6).toBeTruthy();
    expect(kf6.transform).toContain('translate(');
    expect(kf6.transform).toContain('scaleX(1.18)');
  });
});
