// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { patchMetrics } from '../src/karaskel-stub.js';
import { measureLineEls } from '../src/layout.js';

// ── patchMetrics ──────────────────────────────────────────────────────────────

describe('patchMetrics', () => {
  function makeLineTable(n = 3) {
    return {
      kara: Array.from({ length: n }, (_, i) => ({
        text_stripped: `s${i}`,
        start_time: i * 500,
        end_time: (i + 1) * 500,
        duration: 500,
        center: 100,   // equal-width placeholder
        left: 80,
        right: 120,
        width: 40,
        height: 30,
        middle: 240,   // should NOT be overwritten by patchMetrics
        i: i + 1,
      })),
      middle: 240,
    };
  }

  it('patches width, height, center, left, right from metricsMap', () => {
    const lt = makeLineTable(2);
    const map = new Map([
      [0, { width: 80, height: 60, center: 160, left: 120, right: 200, middle: 230 }],
      [1, { width: 100, height: 62, center: 350, left: 300, right: 400, middle: 230 }],
    ]);
    patchMetrics(lt, map);
    expect(lt.kara[0].width).toBe(80);
    expect(lt.kara[0].height).toBe(60);
    expect(lt.kara[0].center).toBe(160);
    expect(lt.kara[0].left).toBe(120);
    expect(lt.kara[0].right).toBe(200);
    expect(lt.kara[1].center).toBe(350);
  });

  it('patches syl.middle from metricsMap', () => {
    const lt = makeLineTable(1);
    const map = new Map([[0, { width: 80, height: 60, center: 160, left: 120, right: 200, middle: 220 }]]);
    patchMetrics(lt, map);
    expect(lt.kara[0].middle).toBe(220);
  });

  it('skips syls with no matching map entry', () => {
    const lt = makeLineTable(3);
    const original = { ...lt.kara[2] };
    const map = new Map([
      [0, { width: 80, height: 60, center: 160, left: 120, right: 200, middle: 230 }],
      // index 1 and 2 missing
    ]);
    patchMetrics(lt, map);
    expect(lt.kara[2].center).toBe(original.center);
    expect(lt.kara[2].width).toBe(original.width);
  });

  it('does not modify lineTable.middle (only kara entries)', () => {
    const lt = makeLineTable(1);
    lt.middle = 240;
    const map = new Map([[0, { width: 80, height: 60, center: 160, left: 120, right: 200, middle: 999 }]]);
    patchMetrics(lt, map);
    expect(lt.middle).toBe(240); // unchanged
    expect(lt.kara[0].middle).toBe(999); // kara middle patched
  });

  it('handles empty kara array', () => {
    const lt = { kara: [], middle: 240 };
    const map = new Map();
    expect(() => patchMetrics(lt, map)).not.toThrow();
  });

  it('preserves timing fields (start_time, end_time, duration)', () => {
    const lt = makeLineTable(1);
    const map = new Map([[0, { width: 80, height: 60, center: 160, left: 120, right: 200, middle: 230 }]]);
    patchMetrics(lt, map);
    expect(lt.kara[0].start_time).toBe(0);
    expect(lt.kara[0].end_time).toBe(500);
    expect(lt.kara[0].duration).toBe(500);
  });
});

// ── measureLineEls ────────────────────────────────────────────────────────────

describe('measureLineEls', () => {
  let rafCallback = null;
  let getBoundingClientRectSpy = null;

  beforeEach(() => {
    // Capture the rAF callback so we can fire it synchronously in tests.
    // vi.stubGlobal creates the property even if it doesn't exist in the environment.
    vi.stubGlobal('requestAnimationFrame', vi.fn(cb => {
      rafCallback = cb;
      return 1;
    }));

    // Mock getBoundingClientRect to return controlled sizes (JSDOM returns zeros)
    getBoundingClientRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 80, height: 40, top: 0, left: 0, right: 80, bottom: 40 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rafCallback = null;
  });

  function makeStage(doc = globalThis.document) {
    const stage = doc.createElement('div');
    stage.style.cssText = 'position:absolute;inset:0;overflow:hidden';
    doc.body.appendChild(stage);
    return stage;
  }

  async function measure(syls, slotY, containerW, containerH, opts, stage) {
    const promise = measureLineEls(syls, slotY, containerW, containerH, opts, stage);
    // Fire the captured rAF callback synchronously
    if (rafCallback) rafCallback(performance.now());
    return promise;
  }

  it('returns a Map keyed by syl index', async () => {
    const stage = makeStage();
    const syls = [{ d: 'lo' }, { d: 've' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    expect(map.has(0)).toBe(true);
    expect(map.has(1)).toBe(true);
    expect(map.size).toBe(2);
  });

  it('converts px width to video coords (width / containerW * xres)', async () => {
    const stage = makeStage();
    // getBoundingClientRect returns width=80 for all spans
    const syls = [{ d: 'hi' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    // width_video = 80 / 800 * 640 = 64
    expect(map.get(0).width).toBeCloseTo(64, 3);
  });

  it('converts px height to video coords (height / containerH * yres)', async () => {
    const stage = makeStage();
    const syls = [{ d: 'hi' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    // height_video = 40 / 450 * 480 ≈ 42.667
    expect(map.get(0).height).toBeCloseTo(40 / 450 * 480, 3);
  });

  it('centers the syllable row: startPx = (containerW - totalPx) / 2', async () => {
    const stage = makeStage();
    // Two spans each 80px wide → total 160px. containerW=800.
    // startPx = (800 - 160) / 2 = 320
    // syl[0]: leftPx=320, rightPx=400, centerPx=360
    // syl[1]: leftPx=400, rightPx=480, centerPx=440
    const syls = [{ d: 'lo' }, { d: 've' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    // center_video[0] = 360 / 800 * 640 = 288
    expect(map.get(0).center).toBeCloseTo(288, 3);
    // center_video[1] = 440 / 800 * 640 = 352
    expect(map.get(1).center).toBeCloseTo(352, 3);
  });

  it('computes left/right from accumulated positions', async () => {
    const stage = makeStage();
    const syls = [{ d: 'lo' }, { d: 've' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    // syl[0].right = syl[1].left (adjacent syls)
    expect(map.get(0).right).toBeCloseTo(map.get(1).left, 3);
  });

  it('converts slotY to video middle (slotY / containerH * yres)', async () => {
    const stage = makeStage();
    const syls = [{ d: 'x' }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    // middle = 225 / 450 * 480 = 240
    expect(map.get(0).middle).toBeCloseTo(240, 3);
  });

  it('removes the wrapper element after measurement', async () => {
    const stage = makeStage();
    const initialChildCount = stage.childElementCount;
    const syls = [{ d: 'test' }];
    await measure(syls, 225, 800, 450, {}, stage);
    expect(stage.childElementCount).toBe(initialChildCount);
  });

  it('handles empty syls array', async () => {
    const stage = makeStage();
    const map = await measure([], 225, 800, 450, {}, stage);
    expect(map.size).toBe(0);
  });

  it('handles syl with undefined d', async () => {
    const stage = makeStage();
    const syls = [{ d: undefined }];
    const map = await measure(syls, 225, 800, 450, { xres: 640, yres: 480 }, stage);
    expect(map.has(0)).toBe(true);
  });
});
