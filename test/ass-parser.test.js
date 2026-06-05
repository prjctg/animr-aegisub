import { describe, it, expect } from 'vitest';
import {
  parseAssDialogue, buildFadKeyframes, parseAssColor, parseAssAlpha,
  anToTransform, mergeKeyframes,
} from '../src/ass-parser.js';

// ── parseAssColor ─────────────────────────────────────────────────────────────

describe('parseAssColor', () => {
  it('reverses BGR byte order to RGB', () => {
    // &H0000FF& = blue channel only → should map to rgb(255,0,0) (red in RGB)
    expect(parseAssColor('&H0000FF&')).toBe('rgb(255,0,0)');
  });

  it('handles white &HFFFFFF&', () => {
    expect(parseAssColor('&HFFFFFF&')).toBe('rgb(255,255,255)');
  });

  it('handles black &H000000&', () => {
    expect(parseAssColor('&H000000&')).toBe('rgb(0,0,0)');
  });

  it('handles &H00FF00& → green in both BGR and RGB', () => {
    // G channel is the same in both orders
    expect(parseAssColor('&H00FF00&')).toBe('rgb(0,255,0)');
  });

  it('handles yellow &H00FFFF& (BGR) → rgb(255,255,0)', () => {
    // BGR: B=0x00, G=0xFF, R=0xFF → RGB: R=255, G=255, B=0 = yellow
    expect(parseAssColor('&H00FFFF&')).toBe('rgb(255,255,0)');
  });
});

// ── parseAssAlpha ─────────────────────────────────────────────────────────────

describe('parseAssAlpha', () => {
  it('&H00& (fully opaque) → opacity 1', () => {
    expect(parseAssAlpha('&H00&')).toBeCloseTo(1.0);
  });

  it('&HFF& (fully transparent) → opacity 0', () => {
    expect(parseAssAlpha('&HFF&')).toBeCloseTo(0.0);
  });

  it('&H80& (half transparent) → opacity ≈ 0.498', () => {
    expect(parseAssAlpha('&H80&')).toBeCloseTo((255 - 0x80) / 255);
  });
});

// ── buildFadKeyframes ─────────────────────────────────────────────────────────

describe('buildFadKeyframes', () => {
  it('returns 2 keyframes when no fade', () => {
    const kf = buildFadKeyframes(1000, 0, 0);
    expect(kf).toHaveLength(2);
    expect(kf[0]).toMatchObject({ opacity: 1, offset: 0 });
    expect(kf[1]).toMatchObject({ opacity: 1, offset: 1 });
  });

  it('fade-in only → 3 keyframes (ends at full opacity)', () => {
    const kf = buildFadKeyframes(1000, 300, 0);
    expect(kf).toHaveLength(3);
    expect(kf[0]).toMatchObject({ opacity: 0, offset: 0 });
    expect(kf[1].opacity).toBeCloseTo(1);
    expect(kf[1].offset).toBeCloseTo(0.3);
    expect(kf[2]).toMatchObject({ opacity: 1, offset: 1 }); // stays visible
  });

  it('fade-out only → 3 keyframes (starts at full opacity)', () => {
    const kf = buildFadKeyframes(1000, 0, 300);
    expect(kf[0]).toMatchObject({ opacity: 1, offset: 0 }); // instantly visible
    expect(kf[1].offset).toBeCloseTo(0.7);
    expect(kf[2]).toMatchObject({ opacity: 0, offset: 1 });
  });

  it('fade-in + fade-out → 4 keyframes', () => {
    const kf = buildFadKeyframes(1000, 300, 300);
    expect(kf).toHaveLength(4);
    expect(kf[0]).toMatchObject({ opacity: 0, offset: 0 });
    expect(kf[1].offset).toBeCloseTo(0.3);
    expect(kf[2].offset).toBeCloseTo(0.7);
    expect(kf[3]).toMatchObject({ opacity: 0, offset: 1 });
  });

  it('fade durations clamped to total duration', () => {
    // fadeIn + fadeOut > duration: fadeOut gets clamped
    const kf = buildFadKeyframes(500, 400, 400);
    // fi = min(400, 500) = 400; fo = min(400, 500-400) = 100
    expect(kf.every(f => f.offset >= 0 && f.offset <= 1)).toBe(true);
  });
});

// ── parseAssDialogue ──────────────────────────────────────────────────────────

describe('parseAssDialogue', () => {
  const opts = { xres: 640, yres: 480, lineStartMs: 0 };

  it('extracts startMs/endMs from dialogue', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 5000, end_time: 6200, text: 'hello', style: 'Default',
    }, opts);
    expect(spec.startMs).toBe(5000);
    expect(spec.endMs).toBe(6200);
    expect(spec.duration).toBe(1200);
  });

  it('lineStartMs is added to start_time/end_time', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 1000, end_time: 2000, text: 'test', style: 'Default',
    }, { ...opts, lineStartMs: 10000 });
    expect(spec.startMs).toBe(11000);
    expect(spec.endMs).toBe(12000);
  });

  it('parses \\pos(320,240) for 640×480 → left:50%, top:50%', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\pos(320,240)}hello', style: 'Default',
    }, opts);
    expect(spec.style.left).toBe('50.000%');
    expect(spec.style.top).toBe('50.000%');
  });

  it('parses \\pos at top-left → left:0%, top:0%', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\pos(0,0)}hello', style: 'Default',
    }, opts);
    expect(spec.style.left).toBe('0.000%');
    expect(spec.style.top).toBe('0.000%');
  });

  it('strips tag block from display text', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\pos(320,240)\\fad(300,300)}syllable', style: 'Default',
    }, opts);
    expect(spec.text).toBe('syllable');
  });

  it('parses \\fad(300,300) → 4-keyframe opacity animation', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1200,
      text: '{\\fad(300,300)}hi', style: 'Default',
    }, opts);
    expect(spec.keyframes).toHaveLength(4);
    expect(spec.keyframes[0].opacity).toBe(0);
    expect(spec.keyframes[3].opacity).toBe(0);
  });

  it('returns layer from dialogue', () => {
    const spec = parseAssDialogue({
      layer: 2, start_time: 0, end_time: 500, text: 'x', style: 'Default',
    }, opts);
    expect(spec.layer).toBe(2);
  });

  it('handles text with no tags', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 500, text: 'plain text', style: 'Default',
    }, opts);
    expect(spec.text).toBe('plain text');
    expect(spec.style.left).toBe('50%');  // default
  });

  it('all keyframes include both opacity and transform properties', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\fad(100,200)}word', style: 'Default',
    }, opts);
    for (const kf of spec.keyframes) {
      expect(kf).toHaveProperty('opacity');
      expect(kf).toHaveProperty('transform');
      expect(kf).toHaveProperty('offset');
    }
  });
});

// ── anToTransform ─────────────────────────────────────────────────────────────

describe('anToTransform', () => {
  it('\\an5 → center (default)', () => {
    expect(anToTransform(5)).toBe('translate(-50%,-50%)');
  });

  it('\\an1 → bottom-left', () => {
    expect(anToTransform(1)).toBe('translate(0%,-100%)');
  });

  it('\\an2 → bottom-center', () => {
    expect(anToTransform(2)).toBe('translate(-50%,-100%)');
  });

  it('\\an3 → bottom-right', () => {
    expect(anToTransform(3)).toBe('translate(-100%,-100%)');
  });

  it('\\an4 → middle-left', () => {
    expect(anToTransform(4)).toBe('translate(0%,-50%)');
  });

  it('\\an6 → middle-right', () => {
    expect(anToTransform(6)).toBe('translate(-100%,-50%)');
  });

  it('\\an7 → top-left', () => {
    expect(anToTransform(7)).toBe('translate(0%,0%)');
  });

  it('\\an8 → top-center', () => {
    expect(anToTransform(8)).toBe('translate(-50%,0%)');
  });

  it('\\an9 → top-right', () => {
    expect(anToTransform(9)).toBe('translate(-100%,0%)');
  });

  it('unknown value → defaults to \\an5', () => {
    expect(anToTransform(0)).toBe('translate(-50%,-50%)');
    expect(anToTransform(99)).toBe('translate(-50%,-50%)');
  });
});

// ── parseAssDialogue with \an ─────────────────────────────────────────────────

describe('parseAssDialogue with \\an', () => {
  const opts = { xres: 640, yres: 480, lineStartMs: 0, containerW: 800, containerH: 450 };

  it('\\an5 sets center anchor transform', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an5\\pos(320,240)}hi', style: 'Default',
    }, opts);
    expect(spec.style.transform).toBe('translate(-50%,-50%)');
  });

  it('\\an8 sets top-center anchor transform', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an8\\pos(320,50)}hi', style: 'Default',
    }, opts);
    expect(spec.style.transform).toBe('translate(-50%,0%)');
  });

  it('\\an1 sets bottom-left anchor transform', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an1\\pos(0,480)}hi', style: 'Default',
    }, opts);
    expect(spec.style.transform).toBe('translate(0%,-100%)');
  });

  it('anchor transform appears in every keyframe', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an7\\pos(0,0)}hi', style: 'Default',
    }, opts);
    for (const kf of spec.keyframes) {
      expect(kf.transform).toContain('translate(0%,0%)');
    }
  });

  it('no \\an tag → defaults to \\an5 (center)', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\pos(320,240)}hi', style: 'Default',
    }, opts);
    expect(spec.style.transform).toBe('translate(-50%,-50%)');
  });
});

// ── parseAssDialogue with \move ───────────────────────────────────────────────

describe('parseAssDialogue with \\move', () => {
  const opts = { xres: 640, yres: 480, lineStartMs: 0, containerW: 800, containerH: 450 };

  it('\\move sets left/top from x1,y1', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an5\\move(320,240,320,220)}hi', style: 'Default',
    }, opts);
    expect(spec.style.left).toBe('50.000%');
    expect(spec.style.top).toBe('50.000%');
  });

  it('\\move supersedes \\pos for position', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      // \pos has different coords; \move wins
      text: '{\\an5\\pos(100,100)\\move(320,240,320,200)}hi', style: 'Default',
    }, opts);
    expect(spec.style.left).toBe('50.000%');
    expect(spec.style.top).toBe('50.000%');
  });

  it('transform at offset 0 is anchor only (no translation yet)', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an5\\move(320,240,320,220,0,1000)}hi', style: 'Default',
    }, opts);
    // At offset=0, t1=0ms → we are at t1, transform should start movement
    // movement starts at offset=t1/duration=0 — so transform at offset 0 = anchor + translate(0,0)
    expect(spec.keyframes[0].transform).toContain('translate(0px,0px)');
  });

  it('transform at offset 1 includes final translation', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      // move from y=240 to y=220 (dy_video=-20, dy_px = -20/480*450 ≈ -18.75)
      text: '{\\an5\\move(320,240,320,220,0,1000)}hi', style: 'Default',
    }, opts);
    const lastKf = spec.keyframes.at(-1);
    expect(lastKf.transform).toContain('px');
    // y movement: (220-240)/480*450 = -20/480*450 ≈ -18.75px
    expect(lastKf.transform).toContain('-18.75px');
  });

  it('\\move without t1/t2 spans the full duration', () => {
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an5\\move(320,240,320,220)}hi', style: 'Default',
    }, opts);
    // With no t2, t2=null is resolved to full duration (1000ms)
    // So movement spans offsets [0, 1] — last keyframe should have full dy
    const lastKf = spec.keyframes.at(-1);
    expect(lastKf.transform).toContain('-18.75px');
  });

  it('\\move with delayed start (t1>0) holds position before t1', () => {
    // move: t1=500ms, t2=1000ms; duration=1000ms
    // At offset=0.3 (300ms < t1=500ms), transform = anchor + translate(0,0)
    const spec = parseAssDialogue({
      layer: 0, start_time: 0, end_time: 1000,
      text: '{\\an5\\move(320,240,320,220,500,1000)}hi', style: 'Default',
    }, opts);
    const kfAt0 = spec.keyframes.find(k => k.offset === 0);
    expect(kfAt0.transform).toContain('translate(0px,0px)');
  });
});

// ── mergeKeyframes ────────────────────────────────────────────────────────────

describe('mergeKeyframes', () => {
  const anchor = 'translate(-50%,-50%)';
  const opts = { containerW: 800, containerH: 450, xres: 640, yres: 480 };

  it('no move → all keyframes have anchor transform only', () => {
    const opKfs = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 1 }];
    const kfs = mergeKeyframes(opKfs, null, anchor, 1000, opts);
    for (const kf of kfs) {
      expect(kf.transform).toBe(anchor);
    }
  });

  it('no move → opacity is interpolated from opacityKfs', () => {
    const opKfs = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }];
    const kfs = mergeKeyframes(opKfs, null, anchor, 1000, opts);
    expect(kfs[0].opacity).toBe(0);
    expect(kfs.at(-1).opacity).toBe(1);
  });

  it('move → offsets include t1/duration and t2/duration', () => {
    const opKfs = [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 1 }];
    const move = { x1: 320, y1: 240, x2: 320, y2: 220, t1: 200, t2: 800 };
    const kfs = mergeKeyframes(opKfs, move, anchor, 1000, opts);
    const offsets = kfs.map(k => k.offset);
    expect(offsets).toContain(0.2); // t1/duration
    expect(offsets).toContain(0.8); // t2/duration
  });

  it('move with zero delta → all transforms are just anchorStr', () => {
    const opKfs = [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 1 }];
    const move = { x1: 320, y1: 240, x2: 320, y2: 240, t1: 0, t2: 1000 }; // no movement
    const kfs = mergeKeyframes(opKfs, move, anchor, 1000, opts);
    for (const kf of kfs) {
      expect(kf.transform).toBe(anchor);
    }
  });

  it('fad + move → keyframe at fade-out start has correct opacity and transform', () => {
    // fad(0, 300) with 1000ms duration: fade-out starts at offset 0.7
    const opKfs = buildFadKeyframes(1000, 0, 300, 1);
    // move: 0 → 1000ms, dy_video = -20
    const move = { x1: 320, y1: 240, x2: 320, y2: 220, t1: 0, t2: 1000 };
    const kfs = mergeKeyframes(opKfs, move, anchor, 1000, opts);

    // Find keyframe at offset 0.7 (fade-out boundary)
    const kf07 = kfs.find(k => Math.abs(k.offset - 0.7) < 0.001);
    expect(kf07).toBeDefined();
    expect(kf07.opacity).toBeCloseTo(1, 3);
    // At offset 0.7, movement is 70% complete: dy = -20/480*450 * 0.7 ≈ -13.125px
    expect(kf07.transform).toContain('px');
  });

  it('all output keyframes have offset, opacity, transform properties', () => {
    const opKfs = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 1 }];
    const move = { x1: 0, y1: 0, x2: 100, y2: 50, t1: 0, t2: 1000 };
    const kfs = mergeKeyframes(opKfs, move, anchor, 1000, opts);
    for (const kf of kfs) {
      expect(typeof kf.offset).toBe('number');
      expect(typeof kf.opacity).toBe('number');
      expect(typeof kf.transform).toBe('string');
    }
  });

  it('output offsets are sorted ascending and unique', () => {
    const opKfs = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 1 }];
    const move = { x1: 0, y1: 0, x2: 0, y2: 100, t1: 200, t2: 800 };
    const kfs = mergeKeyframes(opKfs, move, anchor, 1000, opts);
    for (let i = 1; i < kfs.length; i++) {
      expect(kfs[i].offset).toBeGreaterThan(kfs[i - 1].offset);
    }
  });
});

// ── SP6 tags ──────────────────────────────────────────────────────────────────

const SP6_OPTS = { xres: 640, yres: 480, containerW: 800, containerH: 450 };

describe('SP6: \\p N — drawing mode', () => {
  it('\\p1 sets drawingScale=1 and moves text to drawingCmds', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\an5\\pos(320,240)\\p1}m 0 0 l 10 10' },
      SP6_OPTS,
    );
    expect(spec.drawingScale).toBe(1);
    expect(spec.drawingCmds).toBe('m 0 0 l 10 10');
    expect(spec.text).toBe('');
  });

  it('\\p0 is treated as drawing off (scale=0, text rendered normally)', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\p0}hello' },
      SP6_OPTS,
    );
    expect(spec.drawingScale).toBe(0);
    expect(spec.drawingCmds).toBeNull();
    expect(spec.text).toBe('hello');
  });

  it('\\p4 sets drawingScale=4', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 500, layer: 0, text: '{\\p4}m 0 0 c' },
      SP6_OPTS,
    );
    expect(spec.drawingScale).toBe(4);
  });

  it('default spec has drawingScale=0 and null drawingCmds', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 500, layer: 0, text: 'hello' },
      SP6_OPTS,
    );
    expect(spec.drawingScale).toBe(0);
    expect(spec.drawingCmds).toBeNull();
  });
});

describe('SP6: \\iclip(x1,y1,x2,y2)', () => {
  it('parses iclip coordinates into LayerSpec.iclip', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\iclip(100,50,400,300)}hello' },
      SP6_OPTS,
    );
    expect(spec.iclip).toEqual({ x1: 100, y1: 50, x2: 400, y2: 300 });
  });

  it('iclip is null when not present', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 500, layer: 0, text: 'hello' },
      SP6_OPTS,
    );
    expect(spec.iclip).toBeNull();
  });

  it('\\iclip and \\clip can coexist in the same spec', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0,
        text: '{\\clip(0,0,320,240)\\iclip(100,50,200,150)}hello' },
      SP6_OPTS,
    );
    expect(spec.clip).toEqual({ x1: 0, y1: 0, x2: 320, y2: 240 });
    expect(spec.iclip).toEqual({ x1: 100, y1: 50, x2: 200, y2: 150 });
  });
});

describe('SP6: \\1c–\\4c color channels', () => {
  it('\\1c sets style.color (same as \\c)', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\1c&H69FFF6&}hi' },
      SP6_OPTS,
    );
    // BGR: 69FFF6 → B=0x69, G=0xFF, R=0xF6 → rgb(246,255,105)
    expect(spec.style.color).toBe('rgb(246,255,105)');
  });

  it('\\2c sets style.color2', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\2c&HFF0000&}hi' },
      SP6_OPTS,
    );
    expect(spec.style.color2).toBe('rgb(0,0,255)');
  });

  it('\\3c sets style.borderColor', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\3c&H0000FF&}hi' },
      SP6_OPTS,
    );
    expect(spec.style.borderColor).toBe('rgb(255,0,0)');
  });

  it('\\4c sets style.shadowColor', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\4c&H000000&}hi' },
      SP6_OPTS,
    );
    expect(spec.style.shadowColor).toBe('rgb(0,0,0)');
  });

  it('\\3c + \\bord sets both WebkitTextStrokeWidth and WebkitTextStrokeColor', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\bord2\\3c&H0000FF&}hi' },
      SP6_OPTS,
    );
    expect(spec.style.WebkitTextStrokeWidth).toBe('2.00px');
    expect(spec.style.WebkitTextStrokeColor).toBe('rgb(255,0,0)');
  });
});

describe('SP6: \\shad N — shadow offset', () => {
  it('\\shad 3 sets style.textShadow with default black color', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\shad3}hi' },
      SP6_OPTS,
    );
    expect(spec.style.textShadow).toMatch(/^3\.00px 3\.00px 0 /);
    expect(spec.style.textShadow).toContain('rgba(0,0,0,0.7)');
  });

  it('\\shad 0 does not set textShadow', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\shad0}hi' },
      SP6_OPTS,
    );
    expect(spec.style.textShadow).toBeUndefined();
  });

  it('\\shad + \\4c uses the \\4c color for shadow', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\shad2\\4c&H000080&}hi' },
      SP6_OPTS,
    );
    // BGR 000080 → B=0, G=0, R=128 → rgb(128,0,0) = dark red
    expect(spec.style.textShadow).toContain('rgb(128,0,0)');
  });
});

describe('SP6: \\be N — edge blur', () => {
  it('\\be 2 sets style.filter with blur at 0.5× the value', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\be2}hi' },
      SP6_OPTS,
    );
    expect(spec.style.filter).toBe('blur(1.00px)');
  });

  it('\\be 1 → blur(0.50px)', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\be1}hi' },
      SP6_OPTS,
    );
    expect(spec.style.filter).toBe('blur(0.50px)');
  });

  it('\\blur + \\be compose into a single filter value (values add)', () => {
    const spec = parseAssDialogue(
      { start_time: 0, end_time: 1000, layer: 0, text: '{\\blur3\\be2}hi' },
      SP6_OPTS,
    );
    // totalBlur = 3 + 2*0.5 = 4.0
    expect(spec.style.filter).toBe('blur(4.00px)');
  });
});

describe('SP6: combined tags — lollipop particle', () => {
  it('parses the full lollipop particle tag block without errors', () => {
    const spec = parseAssDialogue({
      start_time: 0,
      end_time: 700,
      layer: 0,
      text: '{\\c&H69FFF6&\\an5\\pos(285,248)\\blur0\\bord0\\fscx40\\fscy40\\t(\\blur5)\\fad(0,300)\\p1\\be1}m 0 0 b 21 0 21 25 0 25 b -19 25 -19 0 0 0',
    }, SP6_OPTS);
    expect(spec.drawingScale).toBe(1);
    expect(spec.drawingCmds).toBe('m 0 0 b 21 0 21 25 0 25 b -19 25 -19 0 0 0');
    expect(spec.style.color).toBe('rgb(246,255,105)');
    // \be1 + \blur0 → totalBlur = 0 + 1*0.5 = 0.5
    expect(spec.style.filter).toBe('blur(0.50px)');
    expect(spec.posX).toBe(285);
    expect(spec.posY).toBe(248);
  });
});
