/**
 * Builds a karaskel-compatible line table from Animr SYL event data.
 *
 * SP1: equal-width approximation for syl.center/left/right (no getBBox).
 * SP2: patchMetrics() replaces these with real getBoundingClientRect values.
 *
 * Coordinate space: VIDEO space (0..xres, 0..yres), so Lua scripts using
 * \pos(syl.center, line.middle) produce normalized ASS coordinates.
 */

/**
 * @param {object} animrLine  – G LINE event object { id, s, e }
 * @param {Array}  animrSyls  – sorted SYL event objects [{ id, s, e, d }]
 * @param {number} slotY      – Y slot in container pixels (e.g. H * 0.5)
 * @param {number} containerW – container width in pixels
 * @param {number} containerH – container height in pixels
 * @param {object} [opts]     – { xres, yres, fontSize }
 * @returns {object} karaskel-compatible line table
 */
export function buildLineTable(animrLine, animrSyls, slotY, containerW, containerH, opts = {}) {
  const xres = opts.xres ?? 640;
  const yres = opts.yres ?? 480;
  const lineStart = animrLine.s;

  // Approximate syllable width based on font size (chars × avgCharWidth)
  const fontSize = parseFloat(opts.fontSize ?? '52') || 52;
  const avgCharPx = fontSize * 0.6;

  // Build kara array with equal-width center approximation
  const kara = (animrSyls || []).map((syl, i) => {
    const n = animrSyls.length;
    // Equal-width spacing across video width
    const sylW = xres / n;
    const centerX = sylW * (i + 0.5);
    const leftX = sylW * i;
    const rightX = sylW * (i + 1);
    const midY = (slotY / containerH) * yres;

    return {
      text_stripped: syl.d ?? '',
      start_time: syl.s - lineStart,
      end_time: syl.e - lineStart,
      duration: syl.e - syl.s,
      center: centerX,
      left: leftX,
      right: rightX,
      middle: midY,
      // Approximate pixel dimensions from char count × avg char width
      width: Math.max(avgCharPx, (syl.d ?? '').length * avgCharPx),
      height: fontSize * 1.2,
      // Back-reference (populated SP2+)
      i: i + 1,
    };
  });

  const midY = (slotY / containerH) * yres;

  return {
    id: animrLine.id,
    start_time: lineStart,
    end_time: animrLine.e,
    kara,
    middle: midY,
    left: 0,
    right: xres,
    top: midY - (fontSize * 0.6),
    bottom: midY + (fontSize * 0.6),
    lineWidth: xres,
    lineHeight: fontSize * 1.2,
  };
}

/**
 * Patch lineTable.kara in-place with real measured metrics from measureLineEls().
 * Must be called before runScript() so Lua sees accurate syl.width/center/etc.
 *
 * @param {object} lineTable  – from buildLineTable()
 * @param {Map<number, {width,height,center,left,right,middle}>} metricsMap
 *   Keyed by syl index (0-based). All values in video coordinate space.
 */
export function patchMetrics(lineTable, metricsMap) {
  for (let i = 0; i < lineTable.kara.length; i++) {
    const m = metricsMap.get(i);
    if (!m) continue;
    const syl = lineTable.kara[i];
    syl.width  = m.width;
    syl.height = m.height;
    syl.center = m.center;
    syl.left   = m.left;
    syl.right  = m.right;
    syl.middle = m.middle;
  }
}
