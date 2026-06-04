import { describe, it, expect } from 'vitest';
import { parseAssDialogue, buildFadKeyframes, parseAssColor, parseAssAlpha } from '../src/ass-parser.js';

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
});
