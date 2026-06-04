/**
 * ASS tag parser — SP2.
 *
 * Converts a dialogue object (from subs.append()) into a LayerSpec:
 * {
 *   text:       string,
 *   startMs:    number,
 *   endMs:      number,
 *   duration:   number,
 *   layer:      number,
 *   style:      { left, top, color, opacity, transform },
 *   keyframes:  [{ opacity, transform, offset }],
 * }
 *
 * SP1 tags: \pos(x,y)  \fad(in,out)  \alpha &HXX&  \c &HBBGGRR&
 * SP2 tags: \an N  \move(x1,y1,x2,y2[,t1,t2])
 */

const TAG_RE = /\{([^}]*)\}/g;

// \an N → CSS translate string for the element's anchor offset.
// Positions are: 7=TL 8=TC 9=TR / 4=ML 5=MC 6=MR / 1=BL 2=BC 3=BR
const AN_TRANSFORMS = {
  1: 'translate(0%,-100%)',
  2: 'translate(-50%,-100%)',
  3: 'translate(-100%,-100%)',
  4: 'translate(0%,-50%)',
  5: 'translate(-50%,-50%)',
  6: 'translate(-100%,-50%)',
  7: 'translate(0%,0%)',
  8: 'translate(-50%,0%)',
  9: 'translate(-100%,0%)',
};

/**
 * Convert an ASS alignment number (1–9) to its CSS translate string.
 * Defaults to \an5 (center) for unknown values.
 * @param {number} n
 * @returns {string}
 */
export function anToTransform(n) {
  return AN_TRANSFORMS[n] ?? AN_TRANSFORMS[5];
}

/**
 * Parse a single dialogue object returned by Fengari.
 *
 * @param {object} dialogue  – { layer, start_time, end_time, text, style }
 * @param {object} [opts]    – { xres, yres, lineStartMs, containerW, containerH }
 * @returns {object|null}    LayerSpec, or null if text is empty after stripping
 */
export function parseAssDialogue(dialogue, opts = {}) {
  const xres = opts.xres ?? 640;
  const yres = opts.yres ?? 480;
  const containerW = opts.containerW ?? 800;
  const containerH = opts.containerH ?? 450;
  const lineStartMs = opts.lineStartMs ?? 0;

  const startMs = (dialogue.start_time ?? 0) + lineStartMs;
  const endMs = (dialogue.end_time ?? 0) + lineStartMs;
  const duration = Math.max(1, endMs - startMs);

  const tagBlock = extractTagBlock(dialogue.text ?? '');
  const displayText = stripTags(dialogue.text ?? '');

  const style = {
    left: '50%',
    top: '50%',
    color: 'white',
    opacity: 1,
    transform: AN_TRANSFORMS[5], // \an5 default
  };

  let fadeIn = 0;
  let fadeOut = 0;
  let posX = null;
  let posY = null;
  let move = null;
  let anN = 5;

  for (const tag of parseTags(tagBlock)) {
    if (tag.name === 'pos') {
      posX = tag.x;
      posY = tag.y;
    } else if (tag.name === 'move') {
      move = tag;
    } else if (tag.name === 'an') {
      anN = tag.n;
      style.transform = anToTransform(tag.n);
    } else if (tag.name === 'fad') {
      fadeIn = tag.fadeIn;
      fadeOut = tag.fadeOut;
    } else if (tag.name === 'alpha') {
      style.opacity = tag.value;
    } else if (tag.name === 'color') {
      style.color = tag.value;
    }
  }

  // \move supersedes \pos for position; use move.x1,y1 as the start position
  if (move) {
    style.left = ((move.x1 / xres) * 100).toFixed(3) + '%';
    style.top  = ((move.y1 / yres) * 100).toFixed(3) + '%';
    // Resolve null t2 to full duration
    if (move.t2 === null) move = { ...move, t2: duration };
  } else if (posX !== null) {
    style.left = ((posX / xres) * 100).toFixed(3) + '%';
    style.top  = ((posY / yres) * 100).toFixed(3) + '%';
  }

  const opacityKfs = buildFadKeyframes(duration, fadeIn, fadeOut, style.opacity);
  const keyframes = mergeKeyframes(opacityKfs, move, style.transform, duration, {
    containerW, containerH, xres, yres,
  });

  return {
    text: displayText,
    startMs,
    endMs,
    duration,
    layer: dialogue.layer ?? 0,
    style,
    keyframes,
  };
}

// ── Tag extraction helpers ────────────────────────────────────────────────────

function extractTagBlock(text) {
  const m = text.match(/^\{([^}]*)\}/);
  return m ? m[1] : '';
}

function stripTags(text) {
  return text.replace(TAG_RE, '').trim();
}

function parseTags(block) {
  const tags = [];
  let i = 0;

  while (i < block.length) {
    if (block[i] !== '\\') { i++; continue; }
    i++; // skip backslash

    // \an N  (single digit 1–9)
    if (block.startsWith('an', i) && /^[1-9]$/.test(block[i + 2])) {
      const n = parseInt(block[i + 2], 10);
      tags.push({ name: 'an', n });
      i += 3;
      continue;
    }

    // \move(x1,y1,x2,y2)  or  \move(x1,y1,x2,y2,t1,t2)
    if (block.startsWith('move(', i)) {
      const end = block.indexOf(')', i + 5);
      if (end !== -1) {
        const args = block.slice(i + 5, end).split(',').map(Number);
        if (args.length >= 4 && args.every(a => !isNaN(a))) {
          tags.push({
            name: 'move',
            x1: args[0], y1: args[1],
            x2: args[2], y2: args[3],
            t1: args[4] ?? 0,
            t2: args.length >= 6 ? args[5] : null, // null = full duration
          });
        }
        i = end + 1;
        continue;
      }
    }

    // \pos(x,y)
    if (block.startsWith('pos(', i)) {
      const end = block.indexOf(')', i + 4);
      if (end !== -1) {
        const args = block.slice(i + 4, end).split(',').map(Number);
        if (args.length >= 2 && !isNaN(args[0]) && !isNaN(args[1])) {
          tags.push({ name: 'pos', x: args[0], y: args[1] });
        }
        i = end + 1;
        continue;
      }
    }

    // \fad(in,out)
    if (block.startsWith('fad(', i)) {
      const end = block.indexOf(')', i + 4);
      if (end !== -1) {
        const args = block.slice(i + 4, end).split(',').map(Number);
        if (args.length >= 2 && !isNaN(args[0]) && !isNaN(args[1])) {
          tags.push({ name: 'fad', fadeIn: args[0], fadeOut: args[1] });
        }
        i = end + 1;
        continue;
      }
    }

    // \alpha &HXX&
    if (block.startsWith('alpha&H', i) || block.startsWith('alpha &H', i)) {
      const hexStart = block.indexOf('&H', i) + 2;
      const hexEnd = block.indexOf('&', hexStart);
      if (hexEnd !== -1) {
        const hex = block.slice(hexStart, hexEnd);
        const val = parseInt(hex, 16);
        if (!isNaN(val)) {
          tags.push({ name: 'alpha', value: (255 - val) / 255 });
        }
        i = hexEnd + 1;
        continue;
      }
    }

    // \c &HBBGGRR&  (ASS color is BGR order)
    if (block[i] === 'c' && (block[i + 1] === ' ' || block[i + 1] === '&')) {
      const hexStart = block.indexOf('&H', i);
      if (hexStart !== -1 && hexStart < i + 4) {
        const hexEnd = block.indexOf('&', hexStart + 2);
        if (hexEnd !== -1) {
          const hex = block.slice(hexStart + 2, hexEnd).padStart(6, '0');
          const bb = parseInt(hex.slice(0, 2), 16);
          const gg = parseInt(hex.slice(2, 4), 16);
          const rr = parseInt(hex.slice(4, 6), 16);
          tags.push({ name: 'color', value: `rgb(${rr},${gg},${bb})` });
          i = hexEnd + 1;
          continue;
        }
      }
    }

    // Advance past current tag word
    const next = block.indexOf('\\', i);
    i = next === -1 ? block.length : next;
  }

  return tags;
}

// ── Keyframe builders ─────────────────────────────────────────────────────────

/**
 * Build Web Animations keyframes for \fad(fadeIn, fadeOut).
 * Returns opacity-only keyframes; mergeKeyframes() adds transform.
 *
 *   \fad(0,0)     → [{op:base,off:0}, {op:base,off:1}]
 *   \fad(300,0)   → [{op:0,off:0}, {op:base,off:0.3}, {op:base,off:1}]
 *   \fad(0,300)   → [{op:base,off:0}, {op:base,off:0.7}, {op:0,off:1}]
 *   \fad(300,300) → [{op:0,off:0}, {op:base,off:0.3}, {op:base,off:0.7}, {op:0,off:1}]
 */
export function buildFadKeyframes(duration, fadeIn, fadeOut, baseOpacity = 1) {
  const fi = Math.min(fadeIn, duration);
  const fo = Math.min(fadeOut, Math.max(0, duration - fi));

  if (!fi && !fo) {
    return [
      { opacity: baseOpacity, offset: 0 },
      { opacity: baseOpacity, offset: 1 },
    ];
  }

  const frames = [];
  frames.push({ opacity: fi > 0 ? 0 : baseOpacity, offset: 0 });

  if (fi > 0) {
    frames.push({ opacity: baseOpacity, offset: fi / duration });
  }

  const foStartOff = fo > 0 ? 1 - fo / duration : 1;
  const fiEndOff   = fi > 0 ? fi / duration : 0;
  if (fo > 0 && foStartOff > fiEndOff) {
    frames.push({ opacity: baseOpacity, offset: foStartOff });
  }

  frames.push({ opacity: fo > 0 ? 0 : baseOpacity, offset: 1 });

  return frames;
}

/**
 * Merge opacity keyframes (\fad) with transform keyframes (\move + \an) into
 * a unified [{opacity, transform, offset}] array for el.animate().
 *
 * Opacity is linearly interpolated between its own keyframes.
 * Transform is computed from the \move timeline: static before t1, linear
 * motion between t1 and t2, static after t2 (in container-pixel space).
 *
 * @param {Array}  opacityKfs – from buildFadKeyframes()
 * @param {object|null} move  – { x1,y1,x2,y2,t1,t2 } or null
 * @param {string} anchorStr  – CSS translate string from \an N
 * @param {number} duration   – animation duration in ms
 * @param {object} opts       – { containerW, containerH, xres, yres }
 * @returns {Array<{opacity: number, transform: string, offset: number}>}
 */
export function mergeKeyframes(opacityKfs, move, anchorStr, duration, opts = {}) {
  const { containerW = 800, containerH = 450, xres = 640, yres = 480 } = opts;

  const t1 = move ? move.t1 : 0;
  const t2 = move ? move.t2 : duration;
  const dx = move ? (move.x2 - move.x1) / xres * containerW : 0;
  const dy = move ? (move.y2 - move.y1) / yres * containerH : 0;
  const hasMove = move && (dx !== 0 || dy !== 0);

  function transformAt(off) {
    if (!hasMove) return anchorStr;
    const t1off = t1 / duration;
    const t2off = t2 / duration;
    if (off <= t1off) return `${anchorStr} translate(0px,0px)`;
    if (off >= t2off) return `${anchorStr} translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px)`;
    const frac = (off - t1off) / (t2off - t1off);
    return `${anchorStr} translate(${(dx * frac).toFixed(2)}px,${(dy * frac).toFixed(2)}px)`;
  }

  function opacityAt(off) {
    for (let k = 1; k < opacityKfs.length; k++) {
      const a = opacityKfs[k - 1], b = opacityKfs[k];
      if (off >= a.offset && off <= b.offset) {
        if (b.offset === a.offset) return b.opacity;
        return a.opacity + (b.opacity - a.opacity) * (off - a.offset) / (b.offset - a.offset);
      }
    }
    return opacityKfs.at(-1)?.opacity ?? 1;
  }

  // Collect offsets from both timelines
  const offsets = [...new Set([
    0,
    ...opacityKfs.map(k => k.offset),
    ...(hasMove ? [t1 / duration, t2 / duration] : []),
    1,
  ])].sort((a, b) => a - b);

  return offsets.map(off => ({
    offset: off,
    opacity: opacityAt(off),
    transform: transformAt(off),
  }));
}

// ── Exported parsing helpers ──────────────────────────────────────────────────

/**
 * Parse a raw ASS color string &HBBGGRR& → 'rgb(RR,GG,BB)'.
 */
export function parseAssColor(hex) {
  const h = hex.replace(/^&H/, '').replace(/&$/, '').padStart(6, '0');
  const bb = parseInt(h.slice(0, 2), 16);
  const gg = parseInt(h.slice(2, 4), 16);
  const rr = parseInt(h.slice(4, 6), 16);
  return `rgb(${rr},${gg},${bb})`;
}

/**
 * Parse a raw ASS alpha string &HXX& → opacity [0,1].
 */
export function parseAssAlpha(hex) {
  const h = hex.replace(/^&H/, '').replace(/&$/, '');
  const val = parseInt(h, 16);
  return (255 - val) / 255;
}
