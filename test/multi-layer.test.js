// @vitest-environment jsdom
/**
 * SP4 layout tests: createLayerEl z-index and createSylStack.
 * Uses element style properties (not cssText) since jsdom normalizes CSS formatting.
 */
import { describe, it, expect } from 'vitest';
import { createLayerEl, createSylStack } from '../src/layout.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStage() {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  return stage;
}

const opts = { xres: 640, yres: 480, font: 'sans-serif', fontSize: '52px', fontWeight: 'bold' };

function makeSpec(layer, posX, posY, clip = null, text = 'hello') {
  return {
    text, layer, posX, posY, clip,
    startMs: 1000, endMs: 2000, duration: 1000,
    style: {
      left:      `${(posX / 640 * 100).toFixed(3)}%`,
      top:       `${(posY / 480 * 100).toFixed(3)}%`,
      color:     'white',
      transform: 'translate(-50%,-50%)',
    },
    keyframes: [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }],
  };
}

// ── createLayerEl: z-index by layer ──────────────────────────────────────────

describe('createLayerEl z-index', () => {
  it('sets z-index 0 for layer=0', () => {
    const el = createLayerEl(makeSpec(0, 320, 240), opts, makeStage());
    expect(el.style.zIndex).toBe('0');
  });

  it('sets z-index 2 for layer=2', () => {
    const el = createLayerEl(makeSpec(2, 320, 240), opts, makeStage());
    expect(el.style.zIndex).toBe('2');
  });

  it('defaults to z-index 0 when spec.layer is undefined', () => {
    const spec = { ...makeSpec(0, 320, 240), layer: undefined };
    const el = createLayerEl(spec, opts, makeStage());
    expect(el.style.zIndex).toBe('0');
  });
});

// ── createSylStack: wrapper structure ────────────────────────────────────────

describe('createSylStack', () => {
  const clip = { x1: 100, y1: 100, x2: 400, y2: 300 };

  it('returns { wrapper, children }', () => {
    const result = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    expect(result).toHaveProperty('wrapper');
    expect(result).toHaveProperty('children');
    expect(Array.isArray(result.children)).toBe(true);
  });

  it('wrapper.className is "syl-stack"', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    expect(wrapper.className).toBe('syl-stack');
  });

  it('wrapper has overflow:hidden', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    expect(wrapper.style.overflow).toBe('hidden');
  });

  it('wrapper left = clip.x1/xres*100 %', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    // (100/640*100) = 15.625%
    expect(wrapper.style.left).toBe('15.625%');
  });

  it('wrapper top = clip.y1/yres*100 %', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    // (100/480*100) ≈ 20.833%
    expect(wrapper.style.top).toBe((100 / 480 * 100).toFixed(3) + '%');
  });

  it('wrapper width = (clip.x2-clip.x1)/xres*100 %', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    // (300/640*100) = 46.875%
    expect(wrapper.style.width).toBe('46.875%');
  });

  it('wrapper height = (clip.y2-clip.y1)/yres*100 %', () => {
    const { wrapper } = createSylStack([makeSpec(0, 250, 200, clip)], opts, makeStage());
    // (200/480*100) ≈ 41.667%
    expect(wrapper.style.height).toBe((200 / 480 * 100).toFixed(3) + '%');
  });

  it('child left = (posX - clip.x1)/(clip.x2-clip.x1)*100 %', () => {
    const posX = 250;
    const { children } = createSylStack([makeSpec(0, posX, 200, clip)], opts, makeStage());
    const expectedVal = (posX - clip.x1) / (clip.x2 - clip.x1) * 100;
    expect(Number.parseFloat(children[0].style.left)).toBeCloseTo(expectedVal, 2);
  });

  it('child top = (posY - clip.y1)/(clip.y2-clip.y1)*100 %', () => {
    const posY = 200;
    const { children } = createSylStack([makeSpec(0, 250, posY, clip)], opts, makeStage());
    const expectedVal = (posY - clip.y1) / (clip.y2 - clip.y1) * 100;
    expect(Number.parseFloat(children[0].style.top)).toBeCloseTo(expectedVal, 2);
  });

  it('child textContent matches spec.text', () => {
    const { children } = createSylStack([makeSpec(0, 250, 200, clip, 'syl-text')], opts, makeStage());
    expect(children[0].textContent).toBe('syl-text');
  });

  it('child count matches specs.length', () => {
    const specs = [makeSpec(0, 250, 200, clip, 'a'), makeSpec(1, 250, 200, clip, 'b'), makeSpec(2, 250, 200, clip, 'c')];
    const { children } = createSylStack(specs, opts, makeStage());
    expect(children).toHaveLength(3);
  });

  it('each child z-index matches spec.layer', () => {
    const specs = [makeSpec(0, 250, 200, clip, 'a'), makeSpec(1, 250, 200, clip, 'b')];
    const { children } = createSylStack(specs, opts, makeStage());
    expect(children[0].style.zIndex).toBe('0');
    expect(children[1].style.zIndex).toBe('1');
  });

  it('children are appended to wrapper', () => {
    const specs = [makeSpec(0, 250, 200, clip), makeSpec(1, 250, 200, clip)];
    const { wrapper, children } = createSylStack(specs, opts, makeStage());
    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.children[0]).toBe(children[0]);
  });

  it('spec posX outside clip rect → negative left% (clipped by overflow:hidden)', () => {
    // posX=50 < clip.x1=100 → negative relative %
    const { children } = createSylStack([makeSpec(0, 50, 200, clip)], opts, makeStage());
    const expected = ((50 - clip.x1) / (clip.x2 - clip.x1) * 100).toFixed(3) + '%';
    expect(children[0].style.left).toBe(expected);
  });
});
