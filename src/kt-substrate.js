/**
 * Karaoke Templater (KT) substrate for animr-aegisub.
 *
 * Processes scripts that use KT syntax:
 *   code once ... end
 *   template syl [noblank] [notext] [loop N] ... end
 *
 * Features:
 *   - code once: Lua init code executed once at G.TYPE.INIT
 *   - $variable substitution: karaskel-compatible variable set
 *   - !expression! evaluation: Lua expressions evaluated via Fengari
 *   - loop N + j counter: template expanded N times with j=1..N
 *
 * Non-KT (plain karaskel) scripts are unaffected — isKTScript() returns false
 * and wireEvents() falls back to the existing runScript() path.
 */

import { execLua, evalExpression, collectResultsRaw, setupLineContext } from './fengari.js';
import { buildSylVarMap } from './karaskel-stub.js';

/** Detect whether a script uses KT syntax. */
export function isKTScript(src) {
  return /^\s*code\s+once\s*$/m.test(src) || /^\s*template\s+syl\b/m.test(src);
}

/**
 * Parse a KT script into its structural blocks.
 *
 * @param {string} src
 * @returns {{ codeOnce: string[], templates: Array<{loop: number, noblank: boolean, notext: boolean, body: string}> }}
 */
export function parseKTBlocks(src) {
  const lines = src.split('\n');
  const codeOnce = [];
  const templates = [];

  let state = 'TOP';   // 'TOP' | 'CODE_ONCE' | 'TEMPLATE'
  let buffer = [];
  let currentTpl = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();

    if (state === 'TOP') {
      if (/^\s*code\s+once\s*$/i.test(trimmed)) {
        state = 'CODE_ONCE';
        buffer = [];
        continue;
      }
      const tplMatch = trimmed.match(
        /^\s*template\s+syl(\s+noblank)?(\s+notext)?(\s+loop\s+(\d+))?\s*$/i
      );
      if (tplMatch) {
        state = 'TEMPLATE';
        buffer = [];
        currentTpl = {
          noblank: Boolean(tplMatch[1]),
          notext:  Boolean(tplMatch[2]),
          loop:    tplMatch[4] ? parseInt(tplMatch[4], 10) : 1,
        };
        continue;
      }
      // top-level comments / blank lines — ignore

    } else if (state === 'CODE_ONCE') {
      if (/^\s*end\s*$/.test(trimmed)) {
        codeOnce.push(buffer.join('\n'));
        state = 'TOP';
        buffer = [];
      } else {
        buffer.push(rawLine);
      }

    } else if (state === 'TEMPLATE') {
      if (/^\s*end\s*$/.test(trimmed)) {
        templates.push({ ...currentTpl, body: buffer.join('\n') });
        state = 'TOP';
        buffer = [];
        currentTpl = null;
      } else {
        buffer.push(rawLine);
      }
    }
  }

  return { codeOnce, templates };
}

/**
 * Expand all KT templates for every syllable in lineTable.
 * Returns the same dialogue-object array shape as runScript().
 *
 * @param {object} L          – Fengari Lua state (warm; code-once already executed)
 * @param {object} blocks     – from parseKTBlocks()
 * @param {object} lineTable  – from buildLineTable() + patchMetrics()
 * @param {object} [opts]     – unused currently, reserved for future opts pass-through
 * @returns {Array<{layer, start_time, end_time, text, style}>}
 */
export function expandKTLine(L, blocks, lineTable, opts = {}) {
  const results = [];
  const { templates } = blocks;

  // Set up line / subs / _appended / randomseed in the Lua VM once per line.
  // This mirrors what runScript() does via buildPreCode() before executing the
  // user script, giving templates access to `line`, `line.kara`, and `subs`.
  setupLineContext(L, lineTable, opts);

  for (const syl of lineTable.kara) {
    // Make the current syllable available as the global `syl` in Lua so
    // templates can reference syl.center, syl.middle, syl.text_stripped, etc.
    execLua(L, 'syl = line.kara[' + syl.i + ']');

    for (const tpl of templates) {
      if (tpl.noblank && !syl.text_stripped) continue;

      const N = tpl.loop;
      const baseVarMap = buildSylVarMap(syl, lineTable);

      for (let j = 1; j <= N; j++) {
        // Inject loop counter into Lua VM
        execLua(L, 'j = ' + j);

        // Build per-iteration var map: base $vars + $j
        const varMap = new Map(baseVarMap);
        varMap.set('$j', String(j));

        // Process $var = !expr! local assignments, mutating varMap
        let code = processLocalAssignments(L, tpl.body, varMap);

        // Substitute all $vars (including newly assigned ones)
        code = substituteVars(code, varMap);

        // Evaluate remaining !expr! blocks
        code = evaluateExprBlocks(L, code);

        // Reset _appended, run expanded template body, collect results
        execLua(L, '_appended = {}');
        execLua(L, code);
        const items = collectResultsRaw(L, {});

        // If notext, strip syllable text from each item's text content
        if (tpl.notext) {
          for (const item of items) {
            item.text = stripSylText(item.text, syl.text_stripped);
          }
        }

        results.push(...items);
      }
    }
  }

  return results;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Find lines of the form `  $var = !expr!` in code.
 * Evaluate each expr via Fengari, store result in varMap, remove those lines.
 *
 * @param {object} L
 * @param {string} code
 * @param {Map<string, string>} varMap – mutated in place
 * @returns {string} code with assignment lines removed
 */
function processLocalAssignments(L, code, varMap) {
  return code.replace(/^[^\S\n]*\$(\w+)\s*=\s*!([^!]+)!\s*$/gm, (_, name, expr) => {
    const substituted = substituteVars(expr.trim(), varMap);
    const value = evalExpression(L, substituted);
    varMap.set('$' + name, value);
    return '';
  });
}

/**
 * Replace all $variable occurrences in code.
 * Keys are sorted longest-first to prevent $scenter matching $s prefix.
 *
 * @param {string} code
 * @param {Map<string, string>} varMap
 * @returns {string}
 */
export function substituteVars(code, varMap) {
  const entries = [...varMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [key, val] of entries) {
    // Escape $ for regex; replace all occurrences
    const escaped = key.replace('$', '\\$');
    code = code.replace(new RegExp(escaped + '(?!\\w)', 'g'), val);
  }
  return code;
}

/**
 * Evaluate all !expression! blocks in code via Fengari, substituting in-place.
 *
 * @param {object} L
 * @param {string} code
 * @returns {string}
 */
export function evaluateExprBlocks(L, code) {
  return code.replace(/!([^!\n]+)!/g, (_, expr) => evalExpression(L, expr.trim()));
}

/** Strip literal syl text from the end of an ASS dialogue text string. */
function stripSylText(text, sylText) {
  if (!sylText) return text;
  // ASS text is the content after the last closing brace
  return text.replace(new RegExp(sylText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '');
}
