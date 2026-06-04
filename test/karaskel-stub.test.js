import { describe, it, expect } from 'vitest';
import { buildLineTable } from '../src/karaskel-stub.js';

const mockLine = { id: 101, s: 10000, e: 14000 };
const mockSyls = [
  { id: 1, s: 10000, e: 10800, d: 'lo' },
  { id: 2, s: 10800, e: 11500, d: 've' },
  { id: 3, s: 11500, e: 12400, d: ' ' },
  { id: 4, s: 12400, e: 14000, d: 'you' },
];

describe('buildLineTable', () => {
  const table = buildLineTable(mockLine, mockSyls, 225, 800, 450, { xres: 640, yres: 480 });

  it('sets line.start_time and end_time', () => {
    expect(table.start_time).toBe(10000);
    expect(table.end_time).toBe(14000);
  });

  it('kara length matches input syls', () => {
    expect(table.kara).toHaveLength(4);
  });

  it('syl.start_time is relative to line start (not absolute)', () => {
    // mockSyls[0].s = 10000, line.s = 10000 → relative = 0
    expect(table.kara[0].start_time).toBe(0);
    // mockSyls[1].s = 10800, line.s = 10000 → relative = 800
    expect(table.kara[1].start_time).toBe(800);
  });

  it('syl.end_time is relative to line start', () => {
    expect(table.kara[0].end_time).toBe(800);
    expect(table.kara[1].end_time).toBe(1500);
  });

  it('syl.duration = end_time - start_time (absolute ms)', () => {
    expect(table.kara[0].duration).toBe(800);   // 10800 - 10000
    expect(table.kara[1].duration).toBe(700);   // 11500 - 10800
  });

  it('syl.text_stripped matches syl.d', () => {
    expect(table.kara[0].text_stripped).toBe('lo');
    expect(table.kara[1].text_stripped).toBe('ve');
    expect(table.kara[3].text_stripped).toBe('you');
  });

  it('syl.center distributes evenly across xres', () => {
    const n = 4;
    const xres = 640;
    // Equal spacing: center[i] = xres * (i + 0.5) / n
    for (let i = 0; i < n; i++) {
      const expected = xres * (i + 0.5) / n;
      expect(table.kara[i].center).toBeCloseTo(expected, 0);
    }
  });

  it('line.middle is computed from slotY and containerH', () => {
    // slotY = 225, containerH = 450 → fraction = 0.5 → middle = 0.5 * yres = 240
    expect(table.middle).toBeCloseTo(240, 0);
  });

  it('syl.i is 1-based index', () => {
    expect(table.kara[0].i).toBe(1);
    expect(table.kara[3].i).toBe(4);
  });

  it('handles empty syls array', () => {
    const empty = buildLineTable(mockLine, [], 225, 800, 450);
    expect(empty.kara).toHaveLength(0);
  });

  it('handles undefined syl.d gracefully', () => {
    const syls = [{ id: 1, s: 10000, e: 10500, d: undefined }];
    const t = buildLineTable(mockLine, syls, 225, 800, 450);
    expect(t.kara[0].text_stripped).toBe('');
  });
});
