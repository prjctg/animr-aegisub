/**
 * ASS tag parser — SP3.
 *
 * Converts a dialogue object (from subs.append()) into a LayerSpec:
 * {
 *   text:       string,
 *   startMs:    number,
 *   endMs:      number,
 *   duration:   number,
 *   layer:      number,
 *   style:      { left, top, color, opacity, transform, filter?, WebkitTextStrokeWidth? },
 *   keyframes:  [{ opacity, transform, offset, filter?, WebkitTextStrokeWidth? }],
 * }
 *
 * SP1 tags: \pos(x,y)  \fad(in,out)  \alpha &HXX&  \c &HBBGGRR&
 * SP2 tags: \an N  \move(x1,y1,x2,y2[,t1,t2])
 * SP3 tags: \fscx N  \fscy N  \frz N  \frx N  \fry N  \blur N  \bord N
 *           \t(t1,t2,\tags...)  — piecewise keyframe tweens
 * SP4 tags: \clip(x1,y1,x2,y2)  — rectangular clip mask
 * SP6 tags: \p N  \iclip(x1,y1,x2,y2)  \1c–\4c  \shad N  \be N
 *
 * SP4 LayerSpec additions: posX, posY (video coords), move (raw), clip (raw rect)
 * SP6 LayerSpec additions: drawingScale, drawingCmds, iclip, style.color2,
 *   style.borderColor, style.shadowColor, style.textShadow
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
  // Tags are parsed first; displayText vs drawingCmds is determined after.
  // (drawingScale is resolved below after the tag loop)
  const rawText = stripTags(dialogue.text ?? '');

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
  let clip = null;
  let anN = 5;

  // SP3 static tag values
  let staticFscx = 100;
  let staticFscy = 100;
  let staticFrz  = 0;
  let staticFrx  = 0;
  let staticFry  = 0;
  let staticBlur = 0;
  let staticBord = 0;
  const tweenTags = [];

  // SP6 tag values
  let drawingScale = 0;
  let iclip        = null;
  let color2       = null;
  let borderColor  = null;
  let shadowColor  = null;
  let shadowDist   = 0;
  let edgeBlur     = 0;

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
    } else if (tag.name === 'fscx') {
      staticFscx = tag.value;
    } else if (tag.name === 'fscy') {
      staticFscy = tag.value;
    } else if (tag.name === 'frz') {
      staticFrz = tag.value;
    } else if (tag.name === 'frx') {
      staticFrx = tag.value;
    } else if (tag.name === 'fry') {
      staticFry = tag.value;
    } else if (tag.name === 'blur') {
      staticBlur = tag.value;
    } else if (tag.name === 'bord') {
      staticBord = tag.value;
    } else if (tag.name === 'clip') {
      clip = { x1: tag.x1, y1: tag.y1, x2: tag.x2, y2: tag.y2 };
    } else if (tag.name === 't') {
      tweenTags.push(tag);
    // SP6 tags ────────────────────────────────────────────────────────────────
    } else if (tag.name === 'p') {
      drawingScale = tag.scale;
    } else if (tag.name === 'iclip') {
      iclip = { x1: tag.x1, y1: tag.y1, x2: tag.x2, y2: tag.y2 };
    } else if (tag.name === 'c1') {
      style.color = tag.value;
    } else if (tag.name === 'c2') {
      color2 = tag.value;
    } else if (tag.name === 'c3') {
      borderColor = tag.value;
    } else if (tag.name === 'c4') {
      shadowColor = tag.value;
    } else if (tag.name === 'shad') {
      shadowDist = tag.value;
    } else if (tag.name === 'be') {
      edgeBlur = tag.value;
    }
  }

  // SP6: split raw text into display text vs drawing commands
  const displayText = drawingScale > 0 ? '' : rawText;
  const drawingCmds = drawingScale > 0 ? rawText : null;

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

  const tweenCtx = {
    tweenTags,
    staticFscx, staticFscy,
    staticFrz, staticFrx, staticFry,
    staticBlur, staticBord,
  };

  const keyframes = mergeKeyframes(opacityKfs, move, style.transform, duration, {
    containerW, containerH, xres, yres,
  }, tweenCtx);

  // Propagate initial filter/stroke to style for createLayerEl
  const hasFilter = staticBlur !== 0 || tweenTags.some(t => t.tags.some(tg => tg.name === 'blur'));
  const hasBord   = staticBord !== 0 || tweenTags.some(t => t.tags.some(tg => tg.name === 'bord'));
  // SP6: \be adds softer edge blur — compose with \blur (values add in same filter pass)
  const totalBlur = staticBlur + edgeBlur * 0.5;
  if (hasFilter || edgeBlur > 0) style.filter = `blur(${totalBlur.toFixed(2)}px)`;
  if (hasBord) style.WebkitTextStrokeWidth = `${staticBord.toFixed(2)}px`;

  // SP6: multi-color channel styles
  if (color2)      style.color2      = color2;
  if (borderColor) style.borderColor = borderColor;
  if (shadowColor) style.shadowColor = shadowColor;

  // SP6: \3c sets outline color (used with \bord)
  if (borderColor && hasBord) style.WebkitTextStrokeColor = borderColor;

  // SP6: \shad N + optional \4c shadow color
  if (shadowDist > 0) {
    const sColor = shadowColor ?? 'rgba(0,0,0,0.7)';
    const sd = shadowDist.toFixed(2);
    style.textShadow = `${sd}px ${sd}px 0 ${sColor}`;
  }

  // SP4: clip-path CSS string (informational; syl-stack wrapper uses overflow:hidden)
  if (clip) {
    const t = (clip.y1 / yres * 100).toFixed(3);
    const r = ((1 - clip.x2 / xres) * 100).toFixed(3);
    const b = ((1 - clip.y2 / yres) * 100).toFixed(3);
    const l = (clip.x1 / xres * 100).toFixed(3);
    style.clipPath = `inset(${t}% ${r}% ${b}% ${l}%)`;
  }

  // SP4: ensure posX/posY always reflect the reference origin
  if (move && posX === null) { posX = move.x1; posY = move.y1; }

  return {
    text: displayText,
    startMs,
    endMs,
    duration,
    layer: dialogue.layer ?? 0,
    posX,         // video-coord X of element origin (null if no \pos or \move)
    posY,         // video-coord Y of element origin
    move,         // raw move object {x1,y1,x2,y2,t1,t2} or null
    clip,         // raw clip rect {x1,y1,x2,y2} or null
    iclip,        // SP6: inverse clip rect {x1,y1,x2,y2} or null
    drawingScale, // SP6: 0=text, 1/2/4=drawing mode (from \pN)
    drawingCmds,  // SP6: drawing command string or null
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

    // SP3 tags ──────────────────────────────────────────────────────────────

    // \t(t1,t2,\tags)  or  \t(\tags)  — piecewise tween block
    // Must check before \frx/\fry/\frz (all start with 'fr')
    if (block.startsWith('t(', i)) {
      const end = findClosingParen(block, i + 1);
      if (end !== -1) {
        const inner = block.slice(i + 2, end);
        const tTag = parseTweenBlock(inner);
        if (tTag) tags.push(tTag);
        i = end + 1;
        continue;
      }
    }

    // \fscx N  (check before \fscy)
    if (block.startsWith('fscx', i)) {
      const val = readNumber(block, i + 4);
      if (val !== null) {
        tags.push({ name: 'fscx', value: val.value });
        i += 4 + val.len;
        continue;
      }
    }

    // \fscy N
    if (block.startsWith('fscy', i)) {
      const val = readNumber(block, i + 4);
      if (val !== null) {
        tags.push({ name: 'fscy', value: val.value });
        i += 4 + val.len;
        continue;
      }
    }

    // \frz N  (check before \frx/\fry)
    if (block.startsWith('frz', i)) {
      const val = readNumber(block, i + 3);
      if (val !== null) {
        tags.push({ name: 'frz', value: val.value });
        i += 3 + val.len;
        continue;
      }
    }

    // \frx N
    if (block.startsWith('frx', i)) {
      const val = readNumber(block, i + 3);
      if (val !== null) {
        tags.push({ name: 'frx', value: val.value });
        i += 3 + val.len;
        continue;
      }
    }

    // \fry N
    if (block.startsWith('fry', i)) {
      const val = readNumber(block, i + 3);
      if (val !== null) {
        tags.push({ name: 'fry', value: val.value });
        i += 3 + val.len;
        continue;
      }
    }

    // \blur N
    if (block.startsWith('blur', i)) {
      const val = readNumber(block, i + 4);
      if (val !== null) {
        tags.push({ name: 'blur', value: val.value });
        i += 4 + val.len;
        continue;
      }
    }

    // \bord N
    if (block.startsWith('bord', i)) {
      const val = readNumber(block, i + 4);
      if (val !== null) {
        tags.push({ name: 'bord', value: val.value });
        i += 4 + val.len;
        continue;
      }
    }

    // SP4: \clip(x1,y1,x2,y2) — rectangular clip mask (video coords)
    if (block.startsWith('clip(', i)) {
      const end = block.indexOf(')', i + 5);
      if (end !== -1) {
        const args = block.slice(i + 5, end).split(',').map(Number);
        if (args.length >= 4 && args.every(a => !isNaN(a))) {
          tags.push({ name: 'clip', x1: args[0], y1: args[1], x2: args[2], y2: args[3] });
        }
        i = end + 1;
        continue;
      }
    }

    // SP6 tags ──────────────────────────────────────────────────────────────

    // \iclip(x1,y1,x2,y2) — inverse clip mask
    if (block.startsWith('iclip(', i)) {
      const end = block.indexOf(')', i + 6);
      if (end !== -1) {
        const args = block.slice(i + 6, end).split(',').map(Number);
        if (args.length >= 4 && args.every(a => !isNaN(a))) {
          tags.push({ name: 'iclip', x1: args[0], y1: args[1], x2: args[2], y2: args[3] });
        }
        i = end + 1;
        continue;
      }
    }

    // \p N — drawing scale (0=off, 1=px, 2=0.5px, 4=0.125px, …)
    // Must be checked after \pos( to avoid false prefix match on 'p'
    if (block[i] === 'p' && block[i + 1] !== 'o' && /\d/.test(block[i + 1] ?? '')) {
      const val = readNumber(block, i + 1);
      if (val !== null) {
        tags.push({ name: 'p', scale: val.value });
        i += 1 + val.len;
        continue;
      }
    }

    // \1c \2c \3c \4c &HBBGGRR& — four color channels
    if (/^[1-4]$/.test(block[i] ?? '') && block[i + 1] === 'c') {
      const channel = parseInt(block[i], 10);
      const hexStart = block.indexOf('&H', i + 2);
      if (hexStart !== -1 && hexStart <= i + 5) {
        const hexEnd = block.indexOf('&', hexStart + 2);
        if (hexEnd !== -1) {
          const hex = block.slice(hexStart + 2, hexEnd).padStart(6, '0');
          const bb = parseInt(hex.slice(0, 2), 16);
          const gg = parseInt(hex.slice(2, 4), 16);
          const rr = parseInt(hex.slice(4, 6), 16);
          tags.push({ name: `c${channel}`, value: `rgb(${rr},${gg},${bb})` });
          i = hexEnd + 1;
          continue;
        }
      }
    }

    // \shad N — shadow offset (uniform in both X and Y)
    if (block.startsWith('shad', i)) {
      const val = readNumber(block, i + 4);
      if (val !== null) {
        tags.push({ name: 'shad', value: val.value });
        i += 4 + val.len;
        continue;
      }
    }

    // \be N — softer edge blur (checked after \bord and \blur)
    if (block.startsWith('be', i) && !/^[a-z]/i.test(block[i + 2] ?? '')) {
      const val = readNumber(block, i + 2);
      if (val !== null) {
        tags.push({ name: 'be', value: val.value });
        i += 2 + val.len;
        continue;
      }
    }

    // Advance past current tag word
    const next = block.indexOf('\\', i);
    i = next === -1 ? block.length : next;
  }

  return tags;
}

// ── SP3 parsing helpers ───────────────────────────────────────────────────────

/**
 * Read a (possibly signed, possibly floating) number starting at pos in block,
 * optionally preceded by a space. Returns { value, len } or null.
 */
function readNumber(block, pos) {
  // Skip optional single space
  let p = pos;
  if (block[p] === ' ') p++;
  const m = block.slice(p).match(/^(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { value: parseFloat(m[1]), len: (p - pos) + m[1].length };
}

/**
 * Find the closing ')' for a '(' at position parenPos in block.
 * ASS \t() does not nest, so no recursive depth tracking needed.
 */
function findClosingParen(block, parenPos) {
  return block.indexOf(')', parenPos);
}

/**
 * Parse the content inside \t(...) and return a tween tag object.
 * Supports:
 *   \t(t1,t2,\tags)       — explicit timing
 *   \t(\tags)             — no timing (t1=null, t2=null → resolved to 0/duration later)
 */
function parseTweenBlock(inner) {
  // Trim leading whitespace
  const trimmed = inner.trimStart();

  let t1 = null, t2 = null, tagsStr = trimmed;

  // Detect timing form: starts with a digit or '-'
  if (/^-?\d/.test(trimmed)) {
    // Expect "t1,t2,\rest" — find two comma-separated numbers
    const parts = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*([\s\S]*)$/);
    if (parts) {
      t1 = parseFloat(parts[1]);
      t2 = parseFloat(parts[2]);
      tagsStr = parts[3];
    } else {
      return null;
    }
  }

  // Recursively parse inner tags (no \t nesting allowed in ASS)
  const innerTags = parseTags(tagsStr).filter(t => t.name !== 't');
  if (innerTags.length === 0) return null;

  return { name: 't', t1, t2, tags: innerTags };
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
 * Merge opacity keyframes (\fad) with transform keyframes (\move + \an + SP3 tweens)
 * into a unified keyframe array for el.animate().
 *
 * SP2 path (tweenCtx===null): returns [{opacity, transform, offset}] — unchanged.
 * SP3 path (tweenCtx provided): adds filter/WebkitTextStrokeWidth when active.
 *
 * @param {Array}        opacityKfs  – from buildFadKeyframes()
 * @param {object|null}  move        – { x1,y1,x2,y2,t1,t2 } or null
 * @param {string}       anchorStr   – CSS translate string from \an N
 * @param {number}       duration    – animation duration in ms
 * @param {object}       opts        – { containerW, containerH, xres, yres }
 * @param {object|null}  tweenCtx    – SP3 tween context, or null for SP2 behavior
 * @returns {Array}
 */
export function mergeKeyframes(opacityKfs, move, anchorStr, duration, opts = {}, tweenCtx = null) {
  const { containerW = 800, containerH = 450, xres = 640, yres = 480 } = opts;

  const t1move = move ? move.t1 : 0;
  const t2move = move ? move.t2 : duration;
  const dx = move ? (move.x2 - move.x1) / xres * containerW : 0;
  const dy = move ? (move.y2 - move.y1) / yres * containerH : 0;
  const hasMove = move && (dx !== 0 || dy !== 0);

  function moveTranslateAt(off) {
    if (!hasMove) return '';
    const t1off = t1move / duration;
    const t2off = t2move / duration;
    if (off <= t1off) return 'translate(0px,0px)';
    if (off >= t2off) return `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px)`;
    const frac = (off - t1off) / (t2off - t1off);
    return `translate(${(dx * frac).toFixed(2)}px,${(dy * frac).toFixed(2)}px)`;
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

  // ── SP2 path (tweenCtx null) ──────────────────────────────────────────────
  if (!tweenCtx) {
    function transformAt(off) {
      const mv = moveTranslateAt(off);
      return mv ? `${anchorStr} ${mv}` : anchorStr;
    }

    const offsets = [...new Set([
      0,
      ...opacityKfs.map(k => k.offset),
      ...(hasMove ? [t1move / duration, t2move / duration] : []),
      1,
    ])].sort((a, b) => a - b);

    return offsets.map(off => ({
      offset: off,
      opacity: opacityAt(off),
      transform: transformAt(off),
    }));
  }

  // ── SP3 path ─────────────────────────────────────────────────────────────

  const {
    tweenTags,
    staticFscx = 100, staticFscy = 100,
    staticFrz = 0, staticFrx = 0, staticFry = 0,
    staticBlur = 0, staticBord = 0,
  } = tweenCtx;

  const fscxTL = buildTweenTimeline(tweenTags, 'fscx', staticFscx, duration);
  const fscyTL = buildTweenTimeline(tweenTags, 'fscy', staticFscy, duration);
  const frzTL  = buildTweenTimeline(tweenTags, 'frz',  staticFrz,  duration);
  const frxTL  = buildTweenTimeline(tweenTags, 'frx',  staticFrx,  duration);
  const fryTL  = buildTweenTimeline(tweenTags, 'fry',  staticFry,  duration);
  const blurTL = buildTweenTimeline(tweenTags, 'blur', staticBlur, duration);
  const bordTL = buildTweenTimeline(tweenTags, 'bord', staticBord, duration);

  const hasScale  = fscxTL.hasMotion || fscyTL.hasMotion || staticFscx !== 100 || staticFscy !== 100;
  const hasRotate = frzTL.hasMotion  || frxTL.hasMotion  || fryTL.hasMotion
                  || staticFrz !== 0 || staticFrx !== 0  || staticFry !== 0;
  const hasFilter = blurTL.hasMotion || staticBlur !== 0;
  const hasBord   = bordTL.hasMotion || staticBord !== 0;

  // Collect all time boundaries from all tween timelines
  const tweenOffsets = [];
  for (const tl of [fscxTL, fscyTL, frzTL, frxTL, fryTL, blurTL, bordTL]) {
    for (const tw of tl.tweens) {
      tweenOffsets.push(tw.t1 / duration, tw.t2 / duration);
    }
  }

  const offsets = [...new Set([
    0,
    ...opacityKfs.map(k => k.offset),
    ...(hasMove ? [t1move / duration, t2move / duration] : []),
    ...tweenOffsets,
    1,
  ])].sort((a, b) => a - b);

  return offsets.map(off => {
    const tMs = off * duration;

    const sx = interpProp(fscxTL.tweens, staticFscx, tMs) / 100;
    const sy = interpProp(fscyTL.tweens, staticFscy, tMs) / 100;
    const rz = interpProp(frzTL.tweens,  staticFrz,  tMs);
    const rx = interpProp(frxTL.tweens,  staticFrx,  tMs);
    const ry = interpProp(fryTL.tweens,  staticFry,  tMs);
    const blurV = interpProp(blurTL.tweens, staticBlur, tMs);
    const bordV = interpProp(bordTL.tweens, staticBord, tMs);

    const mv = moveTranslateAt(off);
    const transform = buildTransformString(
      anchorStr, mv, sx, sy, rz, rx, ry, hasScale, hasRotate,
    );

    const kf = { offset: off, opacity: opacityAt(off), transform };
    if (hasFilter) kf.filter = `blur(${blurV.toFixed(2)}px)`;
    if (hasBord)   kf.WebkitTextStrokeWidth = `${bordV.toFixed(2)}px`;
    return kf;
  });
}

// ── SP3 private helpers ───────────────────────────────────────────────────────

/**
 * Interpolate a single property value at time tMs using a sorted tween list.
 * @param {Array<{t1,t2,value}>} tweens – sorted by t1
 * @param {number} initialVal           – static tag value or spec default
 * @param {number} tMs                  – time in ms from line start
 * @returns {number}
 */
function interpProp(tweens, initialVal, tMs) {
  let prev = initialVal;
  for (const tw of tweens) {
    if (tMs <= tw.t1) return prev;
    if (tMs >= tw.t2) { prev = tw.value; continue; }
    return prev + (tw.value - prev) * (tMs - tw.t1) / (tw.t2 - tw.t1);
  }
  return prev;
}

/**
 * Build a sorted tween timeline for one property from raw \t() tag objects.
 * Resolves null t1→0, null t2→duration.
 *
 * @param {Array}  tweenTags   – all { name:'t', t1, t2, tags } from parseTags
 * @param {string} propName    – e.g. 'fscx'
 * @param {number} staticInit  – initial value (from static tag or default)
 * @param {number} duration    – total animation duration ms
 * @returns {{ tweens: Array<{t1,t2,value}>, hasMotion: boolean }}
 */
function buildTweenTimeline(tweenTags, propName, staticInit, duration) {
  const tweens = tweenTags
    .filter(t => t.tags.some(tg => tg.name === propName))
    .map(t => {
      const inner = t.tags.find(tg => tg.name === propName);
      return {
        t1: t.t1 ?? 0,
        t2: t.t2 ?? duration,
        value: inner.value,
      };
    })
    .sort((a, b) => a.t1 - b.t1);

  return { tweens, hasMotion: tweens.length > 0 };
}

/**
 * Compose a CSS transform string from all active transform components.
 * Composition order: anchorStr [moveTranslate] [scaleX scaleY] [rotate rotateX rotateY]
 *
 * includeScale / includeRotate are determined once per animation to guarantee all
 * keyframes in the Web Animations call have the same transform structure.
 *
 * @param {string}  anchorStr      – from \an N
 * @param {string}  moveTranslate  – 'translate(Xpx,Ypx)' or ''
 * @param {number}  sx             – scaleX fraction (1.0 = 100%)
 * @param {number}  sy             – scaleY fraction
 * @param {number}  rz             – Z rotation degrees
 * @param {number}  rx             – X rotation degrees
 * @param {number}  ry             – Y rotation degrees
 * @param {boolean} includeScale   – always emit scaleX/Y even at 1
 * @param {boolean} includeRotate  – always emit rotate/X/Y even at 0
 * @returns {string}
 */
function buildTransformString(anchorStr, moveTranslate, sx, sy, rz, rx, ry, includeScale, includeRotate) {
  const parts = [anchorStr];
  if (moveTranslate) parts.push(moveTranslate);
  if (includeScale)  parts.push(`scaleX(${fmtN(sx)}) scaleY(${fmtN(sy)})`);
  if (includeRotate) {
    parts.push(`rotate(${fmtN(rz)}deg)`);
    if (rx !== 0 || includeRotate) parts.push(`rotateX(${fmtN(rx)}deg)`);
    if (ry !== 0 || includeRotate) parts.push(`rotateY(${fmtN(ry)}deg)`);
  }
  return parts.join(' ');
}

/** Format a number without unnecessary trailing zeros. */
function fmtN(n) {
  return +parseFloat(n.toFixed(4));
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
