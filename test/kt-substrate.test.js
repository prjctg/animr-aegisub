import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  isKTScript, parseKTBlocks, expandKTLine,
  substituteVars, evaluateExprBlocks,
} from '../src/kt-substrate.js';
import { buildSylVarMap } from '../src/karaskel-stub.js';
import { initVM, disposeVM, execLua, evalExpression } from '../src/fengari.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSyl(overrides = {}) {
  return {
    text_stripped: 'lo', start_time: 0, end_time: 800, duration: 800,
    center: 160, left: 0, right: 320, middle: 240,
    width: 80, height: 60, i: 1,
    ...overrides,
  };
}

function makeLineTable(sylOverrides = []) {
  const defaultSyls = [
    makeSyl({ text_stripped: 'lo', center: 160, i: 1 }),
    makeSyl({ text_stripped: 've', start_time: 800, end_time: 1500, duration: 700, center: 480, right: 640, i: 2 }),
  ];
  const kara = sylOverrides.length ? sylOverrides : defaultSyls;
  return {
    id: 1,
    start_time: 10000, end_time: 14000,
    middle: 240, left: 0, right: 640,
    top: 200, bottom: 280,
    lineWidth: 640, lineHeight: 60,
    kara,
  };
}

// ── isKTScript ────────────────────────────────────────────────────────────────

describe('isKTScript', () => {
  it('detects code once marker', () => {
    expect(isKTScript('code once\n  x = 1\nend')).toBe(true);
  });

  it('detects template syl marker', () => {
    expect(isKTScript('template syl\n  subs.append({})\nend')).toBe(true);
  });

  it('returns false for plain karaskel Lua', () => {
    expect(isKTScript('for si, syl in ipairs(line.kara) do\n  subs.append({})\nend')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isKTScript('')).toBe(false);
  });
});

// ── parseKTBlocks ─────────────────────────────────────────────────────────────

describe('parseKTBlocks', () => {
  it('parses a code once block', () => {
    const src = 'code once\n  colors = {1, 2, 3}\nend';
    const { codeOnce, templates } = parseKTBlocks(src);
    expect(codeOnce).toHaveLength(1);
    expect(codeOnce[0]).toContain('colors');
    expect(templates).toHaveLength(0);
  });

  it('parses a plain template syl block', () => {
    const src = 'template syl\n  subs.append({})\nend';
    const { templates } = parseKTBlocks(src);
    expect(templates).toHaveLength(1);
    expect(templates[0].loop).toBe(1);
    expect(templates[0].noblank).toBe(false);
    expect(templates[0].notext).toBe(false);
    expect(templates[0].body).toContain('subs.append');
  });

  it('parses noblank loop N modifiers', () => {
    const src = 'template syl noblank loop 7\n  x()\nend';
    const { templates } = parseKTBlocks(src);
    expect(templates[0].loop).toBe(7);
    expect(templates[0].noblank).toBe(true);
    expect(templates[0].notext).toBe(false);
  });

  it('parses notext modifier', () => {
    const src = 'template syl notext\n  x()\nend';
    const { templates } = parseKTBlocks(src);
    expect(templates[0].notext).toBe(true);
  });

  it('parses multiple blocks correctly', () => {
    const src = [
      'code once',
      '  a = 1',
      'end',
      'template syl',
      '  b()',
      'end',
      'template syl loop 3',
      '  c()',
      'end',
    ].join('\n');
    const { codeOnce, templates } = parseKTBlocks(src);
    expect(codeOnce).toHaveLength(1);
    expect(templates).toHaveLength(2);
    expect(templates[1].loop).toBe(3);
  });

  it('ignores top-level comment lines', () => {
    const src = '-- This is a KT script\ntemplate syl\n  x()\nend';
    const { templates } = parseKTBlocks(src);
    expect(templates).toHaveLength(1);
  });
});

// ── buildSylVarMap ────────────────────────────────────────────────────────────

describe('buildSylVarMap', () => {
  const syl = makeSyl({ center: 320, left: 240, right: 400, middle: 240, width: 160, height: 60, duration: 700, start_time: 500, end_time: 1200, i: 2 });
  const line = { start_time: 10000, end_time: 14000, left: 0, right: 640, lineWidth: 640, lineHeight: 60 };

  it('produces a Map with at least 18 entries', () => {
    expect(buildSylVarMap(syl, line).size).toBeGreaterThanOrEqual(18);
  });

  it('$scenter = syl.center rounded', () => {
    expect(buildSylVarMap(syl, line).get('$scenter')).toBe('320');
  });

  it('$smiddle = syl.middle', () => {
    expect(buildSylVarMap(syl, line).get('$smiddle')).toBe('240');
  });

  it('$sleft and $sright', () => {
    const m = buildSylVarMap(syl, line);
    expect(m.get('$sleft')).toBe('240');
    expect(m.get('$sright')).toBe('400');
  });

  it('$swidth and $sheight', () => {
    const m = buildSylVarMap(syl, line);
    expect(m.get('$swidth')).toBe('160');
    expect(m.get('$sheight')).toBe('60');
  });

  it('$sdur, $sstart, $send', () => {
    const m = buildSylVarMap(syl, line);
    expect(m.get('$sdur')).toBe('700');
    expect(m.get('$sstart')).toBe('500');
    expect(m.get('$send')).toBe('1200');
  });

  it('$si = syl index', () => {
    expect(buildSylVarMap(syl, line).get('$si')).toBe('2');
  });

  it('$lcenter = midpoint of line.left and line.right', () => {
    expect(buildSylVarMap(syl, line).get('$lcenter')).toBe('320');
  });

  it('$lstart, $lend, $ldur', () => {
    const m = buildSylVarMap(syl, line);
    expect(m.get('$lstart')).toBe('10000');
    expect(m.get('$lend')).toBe('14000');
    expect(m.get('$ldur')).toBe('4000');
  });

  it('$stop = middle - height/2', () => {
    // 240 - 30 = 210
    expect(buildSylVarMap(syl, line).get('$stop')).toBe('210');
  });

  it('$sbottom = middle + height/2', () => {
    // 240 + 30 = 270
    expect(buildSylVarMap(syl, line).get('$sbottom')).toBe('270');
  });
});

// ── substituteVars ────────────────────────────────────────────────────────────

describe('substituteVars', () => {
  it('substitutes $scenter and $smiddle', () => {
    const map = new Map([['$scenter', '320'], ['$smiddle', '240']]);
    expect(substituteVars('\\pos($scenter,$smiddle)', map)).toBe('\\pos(320,240)');
  });

  it('longest-first prevents $s matching prefix of $scenter', () => {
    const map = new Map([['$s', 'X'], ['$scenter', '320']]);
    expect(substituteVars('$scenter', map)).toBe('320');
  });

  it('substitutes a custom $color variable', () => {
    const map = new Map([['$color', '&HFF0000&']]);
    expect(substituteVars('\\c$color\\an5', map)).toBe('\\c&HFF0000&\\an5');
  });

  it('does not substitute $varfoo when only $var is in map', () => {
    const map = new Map([['$x', 'Z']]);
    expect(substituteVars('$xyz', map)).toBe('$xyz');
  });
});

// ── Fengari-dependent tests ───────────────────────────────────────────────────

describe('kt-substrate (Fengari VM)', () => {
  let L;

  beforeAll(() => {
    L = initVM({ xres: 640, yres: 480 });
  });

  afterAll(() => {
    disposeVM(L);
  });

  // ── evalExpression ──────────────────────────────────────────────────────────

  it('evalExpression evaluates arithmetic', () => {
    expect(evalExpression(L, '1 + 1')).toBe('2');
  });

  it('evalExpression accesses VM globals', () => {
    execLua(L, 'kt_test_global = 42');
    expect(evalExpression(L, 'kt_test_global')).toBe('42');
  });

  // ── evaluateExprBlocks ──────────────────────────────────────────────────────

  it('evaluateExprBlocks substitutes !expr! in a string', () => {
    expect(evaluateExprBlocks(L, 'v = !2 + 3!')).toBe('v = 5');
  });

  it('evaluateExprBlocks handles multiple !expr! blocks', () => {
    execLua(L, 'kt_a = 10; kt_b = 20');
    expect(evaluateExprBlocks(L, '!kt_a!,!kt_b!')).toBe('10,20');
  });

  // ── expandKTLine: loop expansion ───────────────────────────────────────────

  it('loop 3 produces 3 results per syl (2 syls = 6 total)', () => {
    const blocks = parseKTBlocks([
      'template syl loop 3',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="x"})',
      'end',
    ].join('\n'));
    const results = expandKTLine(L, blocks, makeLineTable(), {});
    expect(results).toHaveLength(6);
  });

  it('j counter is 1-based and increments per iteration', () => {
    const blocks = parseKTBlocks([
      'template syl loop 3',
      '  subs.append({layer=0, start_time=0, end_time=1000, text=tostring(j)})',
      'end',
    ].join('\n'));
    // First syl's 3 results should have text "1", "2", "3"
    const results = expandKTLine(L, blocks, makeLineTable(), {});
    expect(results[0].text).toBe('1');
    expect(results[1].text).toBe('2');
    expect(results[2].text).toBe('3');
  });

  // ── expandKTLine: noblank filter ───────────────────────────────────────────

  it('noblank skips empty syllables', () => {
    const blocks = parseKTBlocks([
      'template syl noblank',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="x"})',
      'end',
    ].join('\n'));
    const lineTable = makeLineTable([
      makeSyl({ text_stripped: 'lo', i: 1 }),
      makeSyl({ text_stripped: '', i: 2 }),  // empty — should be skipped
    ]);
    const results = expandKTLine(L, blocks, lineTable, {});
    expect(results).toHaveLength(1);
  });

  // ── expandKTLine: $variable substitution ──────────────────────────────────

  it('$scenter and $smiddle are substituted into template body', () => {
    const blocks = parseKTBlocks([
      'template syl noblank',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="pos=$scenter,$smiddle"})',
      'end',
    ].join('\n'));
    const lineTable = makeLineTable([makeSyl({ center: 320, middle: 240, i: 1 })]);
    const results = expandKTLine(L, blocks, lineTable, {});
    expect(results[0].text).toBe('pos=320,240');
  });

  // ── expandKTLine: !expr! evaluation ───────────────────────────────────────

  it('!expr! blocks are evaluated and substituted', () => {
    const blocks = parseKTBlocks([
      'template syl noblank',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="v=!1+2!"})',
      'end',
    ].join('\n'));
    const results = expandKTLine(L, blocks, makeLineTable([makeSyl()]), {});
    expect(results[0].text).toBe('v=3');
  });

  it('$var = !expr! chained: later expr can reference earlier $var', () => {
    const blocks = parseKTBlocks([
      'template syl noblank',
      '  $a = !10!',
      '  $b = !$a * 3!',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="b=$b"})',
      'end',
    ].join('\n'));
    const results = expandKTLine(L, blocks, makeLineTable([makeSyl()]), {});
    expect(results[0].text).toBe('b=30');
  });

  it('$var = !expr! local assignment works', () => {
    const blocks = parseKTBlocks([
      'template syl noblank',
      '  $myval = !10 * 3!',
      '  subs.append({layer=0, start_time=0, end_time=1000, text="val=$myval"})',
      'end',
    ].join('\n'));
    const results = expandKTLine(L, blocks, makeLineTable([makeSyl()]), {});
    expect(results[0].text).toBe('val=30');
  });

  // ── retime() modes ─────────────────────────────────────────────────────────

  // For these tests: line.start_time=10000, syl[0].start_time=0 (rel), duration=800, end_time=800

  function runRetime(L, mode, s, e) {
    const blocks = parseKTBlocks([
      'template syl noblank',
      `  local t0, t1 = retime("${mode}", ${s}, ${e})`,
      '  subs.append({layer=0, start_time=t0, end_time=t1, text="x"})',
      'end',
    ].join('\n'));
    const results = expandKTLine(L, blocks, makeLineTable([makeSyl()]), {});
    return { start: results[0].start_time, end: results[0].end_time };
  }

  it('retime("syl", -300, 500): start=ls+ss+s, end=ls+ss+dur+e', () => {
    // ls=10000, ss=0, dur=800 → start=9700, end=11300
    const { start, end } = runRetime(L, 'syl', -300, 500);
    expect(start).toBe(9700);
    expect(end).toBe(11300);
  });

  it('retime("presyl", -200, 0): start=ls+ss-200, end=ls+ss', () => {
    // ls=10000, ss=0 → start=9800, end=10000
    const { start, end } = runRetime(L, 'presyl', -200, 0);
    expect(start).toBe(9800);
    expect(end).toBe(10000);
  });

  it('retime("postsyl", 0, 500): start=ls+se, end=ls+se+500', () => {
    // ls=10000, se=800 → start=10800, end=11300
    const { start, end } = runRetime(L, 'postsyl', 0, 500);
    expect(start).toBe(10800);
    expect(end).toBe(11300);
  });

  it('retime("start2syl", -300, 0): start=ls-300, end=ls+ss', () => {
    // ls=10000, ss=0 → start=9700, end=10000
    const { start, end } = runRetime(L, 'start2syl', -300, 0);
    expect(start).toBe(9700);
    expect(end).toBe(10000);
  });

  it('retime("abs", 5000, 8000): returns absolute values', () => {
    const { start, end } = runRetime(L, 'abs', 5000, 8000);
    expect(start).toBe(5000);
    expect(end).toBe(8000);
  });

  // ── code once: globals persist into templates ──────────────────────────────

  it('code once globals are accessible in template bodies', () => {
    // Use a fresh VM to avoid cross-test contamination
    const L2 = initVM({ xres: 640, yres: 480 });
    try {
      const blocks = parseKTBlocks([
        'code once',
        '  kt_colors = {"red", "green", "blue"}',
        'end',
        'template syl noblank',
        '  subs.append({layer=0, start_time=0, end_time=1000, text=kt_colors[1]})',
        'end',
      ].join('\n'));

      for (const code of blocks.codeOnce) execLua(L2, code);
      const results = expandKTLine(L2, blocks, makeLineTable([makeSyl()]), {});
      expect(results[0].text).toBe('red');
    } finally {
      disposeVM(L2);
    }
  });

  it('code once + !expr! color indexing', () => {
    const L3 = initVM({ xres: 640, yres: 480 });
    try {
      const blocks = parseKTBlocks([
        'code once',
        '  kt_pal = {"&HFF0000&", "&H00FF00&", "&H0000FF&"}',
        'end',
        'template syl noblank loop 3',
        '  subs.append({layer=0, start_time=0, end_time=1000, text=!kt_pal[j]!})',
        'end',
      ].join('\n'));

      for (const code of blocks.codeOnce) execLua(L3, code);
      const results = expandKTLine(L3, blocks, makeLineTable([makeSyl()]), {});
      expect(results).toHaveLength(3);
      expect(results[0].text).toBe('&HFF0000&');
      expect(results[1].text).toBe('&H00FF00&');
      expect(results[2].text).toBe('&H0000FF&');
    } finally {
      disposeVM(L3);
    }
  });
});
