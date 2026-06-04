/**
 * ASS tag parser — SP1 subset.
 *
 * Converts a dialogue object (from subs.append()) into a LayerSpec:
 * {
 *   text:       string,         // display text (tags stripped)
 *   startMs:    number,         // absolute song ms
 *   endMs:      number,
 *   duration:   number,
 *   layer:      number,
 *   style:      { left, top, color, opacity },
 *   keyframes:  [...],          // Web Animations keyframes
 * }
 *
 * SP1 tags handled: \pos(x,y)  \fad(in,out)  \alpha &HXX&  \c &HBBGGRR&
 * Later sub-phases extend this file.
 */

const TAG_RE = /\{([^}]*)\}/g;

/**
 * Parse a single dialogue object returned by Fengari.
 *
 * @param {object} dialogue  – { layer, start_time, end_time, text, style }
 * @param {object} [opts]    – { xres, yres, lineStartMs }
 * @returns {object|null}    LayerSpec, or null if text is empty after stripping
 */
export function parseAssDialogue(dialogue, opts = {}) {
  const xres = opts.xres ?? 640;
  const yres = opts.yres ?? 480;
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
  };

  let fadeIn = 0;
  let fadeOut = 0;

  for (const tag of parseTags(tagBlock)) {
    if (tag.name === 'pos') {
      style.left = ((tag.x / xres) * 100).toFixed(3) + '%';
      style.top = ((tag.y / yres) * 100).toFixed(3) + '%';
    } else if (tag.name === 'fad') {
      fadeIn = tag.fadeIn;
      fadeOut = tag.fadeOut;
    } else if (tag.name === 'alpha') {
      style.opacity = tag.value;
    } else if (tag.name === 'color') {
      style.color = tag.value;
    }
  }

  const keyframes = buildFadKeyframes(duration, fadeIn, fadeOut, style.opacity);

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

/** Extract the content of the first {...} block. */
function extractTagBlock(text) {
  const m = text.match(/^\{([^}]*)\}/);
  return m ? m[1] : '';
}

/** Remove all {…} override tag blocks from text. */
function stripTags(text) {
  return text.replace(TAG_RE, '').trim();
}

/** Parse tag block string into structured tag objects. */
function parseTags(block) {
  const tags = [];
  let i = 0;

  while (i < block.length) {
    if (block[i] !== '\\') { i++; continue; }
    i++; // skip backslash

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
    if (block[i] === 'c' && block[i + 1] === ' ' || block[i] === 'c' && block[i + 1] === '&') {
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

/**
 * Build Web Animations keyframes for a \fad(fadeIn, fadeOut) effect.
 *
 * The initial CSS opacity of the element is always 0 (set in createLayerEl),
 * so elements are invisible during the animation delay. Keyframes control the
 * full opacity lifecycle from animation start to end.
 *
 *   \fad(0,0)   → [{op:base,off:0}, {op:base,off:1}]           — always visible
 *   \fad(300,0) → [{op:0,off:0}, {op:base,off:0.3}, {op:base,off:1}]
 *   \fad(0,300) → [{op:base,off:0}, {op:base,off:0.7}, {op:0,off:1}]
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

  // Start: invisible if fading in, otherwise full opacity immediately
  frames.push({ opacity: fi > 0 ? 0 : baseOpacity, offset: 0 });

  // End of fade-in
  if (fi > 0) {
    frames.push({ opacity: baseOpacity, offset: fi / duration });
  }

  // Start of fade-out plateau (only if there's a gap between fade-in end and fade-out start)
  const foStartOff = fo > 0 ? 1 - fo / duration : 1;
  const fiEndOff   = fi > 0 ? fi / duration : 0;
  if (fo > 0 && foStartOff > fiEndOff) {
    frames.push({ opacity: baseOpacity, offset: foStartOff });
  }

  // End: transparent if fading out, otherwise stay at baseOpacity
  frames.push({ opacity: fo > 0 ? 0 : baseOpacity, offset: 1 });

  return frames;
}

/**
 * Parse a raw ASS color string &HBBGGRR& → 'rgb(RR,GG,BB)'.
 * Exported for testing.
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
 * Exported for testing.
 */
export function parseAssAlpha(hex) {
  const h = hex.replace(/^&H/, '').replace(/&$/, '');
  const val = parseInt(h, 16);
  return (255 - val) / 255;
}
