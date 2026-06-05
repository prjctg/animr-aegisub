/**
 * DOM element factory and layout utilities.
 *
 * SP1: one <div> per LayerSpec, positioned absolutely within #kstage.
 * SP2: measureLineEls() for real getBoundingClientRect text metrics.
 * SP4: createSylStack() groups clipped specs in an overflow:hidden wrapper.
 * SP6: createDrawingEl() creates a Canvas element for \p1 drawing specs.
 */

import { parseDrawingCmds } from './ass-drawing.js';

export function buildStageHtml() {
  return `<div id="kstage" style="position:absolute;inset:0;overflow:hidden;pointer-events:none"></div>`;
}

/**
 * Create a positioned text element for one LayerSpec.
 * @param {object} spec   – LayerSpec with .text and .style
 * @param {object} opts   – { font, fontSize, fontWeight }
 * @param {Element} stage – #kstage container element
 * @returns {HTMLElement}
 */
export function createLayerEl(spec, opts, stage) {
  const el = stage.ownerDocument.createElement('div');
  el.textContent = spec.text;
  const parts = [
    'position:absolute',
    `left:${spec.style.left}`,
    `top:${spec.style.top}`,
    `transform:${spec.style.transform ?? 'translate(-50%,-50%)'}`,
    `color:${spec.style.color}`,
    `opacity:0`,
    `z-index:${spec.layer ?? 0}`,
    `font-family:${opts.font ?? 'sans-serif'}`,
    `font-size:${opts.fontSize ?? '52px'}`,
    `font-weight:${opts.fontWeight ?? 'bold'}`,
    'white-space:nowrap',
  ];
  if (spec.style.filter)                 parts.push(`filter:${spec.style.filter}`);
  if (spec.style.WebkitTextStrokeWidth)  parts.push(`-webkit-text-stroke-width:${spec.style.WebkitTextStrokeWidth}`);
  if (spec.style.WebkitTextStrokeColor)  parts.push(`-webkit-text-stroke-color:${spec.style.WebkitTextStrokeColor}`);
  if (spec.style.textShadow)             parts.push(`text-shadow:${spec.style.textShadow}`);
  parts.push(`will-change:opacity,transform${spec.style.filter ? ',filter' : ''}`);
  el.style.cssText = parts.join(';');
  return el;
}

/**
 * Create a Canvas element for a drawing-mode LayerSpec (\p1 etc.).
 *
 * The canvas is 400×400px, positioned at posX/posY (via left/top % + \an transform),
 * so CSS transforms (scale, rotate) apply relative to the drawing's visual center.
 * The Path2D is drawn with its coordinate origin at the canvas center (200, 200).
 *
 * @param {object} spec   – LayerSpec with drawingScale > 0 and drawingCmds string
 * @param {object} opts   – { xres, yres }
 * @param {Element} stage – #kstage container
 * @returns {HTMLCanvasElement}
 */
export function createDrawingEl(spec, opts, stage) {
  const CANVAS_SIZE = 400;
  const ORIGIN = CANVAS_SIZE / 2; // 200

  const el = stage.ownerDocument.createElement('canvas');
  el.width  = CANVAS_SIZE;
  el.height = CANVAS_SIZE;

  const parts = [
    'position:absolute',
    `left:${spec.style.left}`,
    `top:${spec.style.top}`,
    `transform:${spec.style.transform ?? 'translate(-50%,-50%)'}`,
    `opacity:0`,
    `z-index:${spec.layer ?? 0}`,
    'pointer-events:none',
  ];
  if (spec.style.filter) parts.push(`filter:${spec.style.filter}`);
  parts.push(`will-change:opacity,transform${spec.style.filter ? ',filter' : ''}`);
  el.style.cssText = parts.join(';');

  // Draw the path immediately (static drawing; animation drives opacity/transform)
  if (spec.drawingCmds) {
    try {
      const path = parseDrawingCmds(spec.drawingCmds, spec.drawingScale ?? 1);
      const ctx = el.getContext('2d');
      ctx.translate(ORIGIN, ORIGIN);
      ctx.fillStyle = spec.style.color ?? 'white';
      ctx.fill(path);
    } catch (e) {
      (opts.onError ?? console.error)('animr-aegisub: drawing parse error:', e);
    }
  }

  return el;
}

/**
 * Create a syl-stack wrapper div for a group of clipped LayerSpecs.
 *
 * The wrapper is sized to the clip rect and has overflow:hidden, so any child
 * element positioned outside the clip rect bounds is automatically clipped.
 * Children are positioned as a % of the wrapper's dimensions using video-coord
 * arithmetic, so they land at the correct absolute video position.
 *
 * Only call this when all specs share the same clip rect (spec.clip).
 *
 * @param {Array}   clippedSpecs – LayerSpecs with non-null .clip
 * @param {object}  opts         – { xres, yres, font, fontSize, fontWeight }
 * @param {Element} stage        – #kstage container (for ownerDocument)
 * @returns {{ wrapper: HTMLElement, children: HTMLElement[] }}
 */
export function createSylStack(clippedSpecs, opts, stage) {
  const xres = opts.xres ?? 640;
  const yres = opts.yres ?? 480;
  const clip = clippedSpecs[0].clip;
  const clipW = clip.x2 - clip.x1;
  const clipH = clip.y2 - clip.y1;

  const wrapper = stage.ownerDocument.createElement('div');
  wrapper.className = 'syl-stack';
  wrapper.style.cssText = [
    'position:absolute',
    `left:${(clip.x1 / xres * 100).toFixed(3)}%`,
    `top:${(clip.y1 / yres * 100).toFixed(3)}%`,
    `width:${(clipW / xres * 100).toFixed(3)}%`,
    `height:${(clipH / yres * 100).toFixed(3)}%`,
    'overflow:hidden',
    'pointer-events:none',
  ].join(';');

  const children = clippedSpecs.map(spec => {
    const el = stage.ownerDocument.createElement('div');
    el.textContent = spec.text;

    // Position as % of the wrapper's dimensions (= video-coord arithmetic)
    const relX = ((spec.posX - clip.x1) / clipW * 100).toFixed(3);
    const relY = ((spec.posY - clip.y1) / clipH * 100).toFixed(3);

    const parts = [
      'position:absolute',
      `left:${relX}%`,
      `top:${relY}%`,
      `transform:${spec.style.transform ?? 'translate(-50%,-50%)'}`,
      `color:${spec.style.color}`,
      `opacity:0`,
      `z-index:${spec.layer ?? 0}`,
      `font-family:${opts.font ?? 'sans-serif'}`,
      `font-size:${opts.fontSize ?? '52px'}`,
      `font-weight:${opts.fontWeight ?? 'bold'}`,
      'white-space:nowrap',
    ];
    if (spec.style.filter)                parts.push(`filter:${spec.style.filter}`);
    if (spec.style.WebkitTextStrokeWidth) parts.push(`-webkit-text-stroke-width:${spec.style.WebkitTextStrokeWidth}`);
    parts.push(`will-change:opacity,transform${spec.style.filter ? ',filter' : ''}`);

    el.style.cssText = parts.join(';');
    wrapper.appendChild(el);
    return el;
  });

  return { wrapper, children };
}

/**
 * Create hidden measurement elements for each syl, wait for one rAF,
 * read getBoundingClientRect(), convert px → video coords, and clean up.
 *
 * All values in the returned Map are in video coordinate space (0..xres, 0..yres).
 *
 * @param {Array}   syls       – syl objects with .d text
 * @param {number}  slotY      – container-px Y for the line's baseline
 * @param {number}  containerW – stage width in px
 * @param {number}  containerH – stage height in px
 * @param {object}  opts       – { font, fontSize, fontWeight, xres, yres }
 * @param {Element} stage      – #kstage container
 * @returns {Promise<Map<number, {width,height,center,left,right,middle}>>}
 *   Keyed by syl index (0-based).
 */
export function measureLineEls(syls, slotY, containerW, containerH, opts, stage) {
  return new Promise(resolve => {
    const xres = opts.xres ?? 640;
    const yres = opts.yres ?? 480;

    // Invisible row wrapper — stacks syls inline for natural width measurement
    const wrapper = stage.ownerDocument.createElement('div');
    wrapper.style.cssText = [
      'position:absolute',
      'top:-9999px',
      'left:0',
      'white-space:nowrap',
      'visibility:hidden',
      `font-family:${opts.font ?? 'sans-serif'}`,
      `font-size:${opts.fontSize ?? '52px'}`,
      `font-weight:${opts.fontWeight ?? 'bold'}`,
    ].join(';');

    const spans = syls.map(syl => {
      const span = stage.ownerDocument.createElement('span');
      span.textContent = syl.d ?? '';
      wrapper.appendChild(span);
      return span;
    });

    stage.appendChild(wrapper);

    requestAnimationFrame(() => {
      const map = new Map();
      let accPx = 0;

      // Center the syllable row within the container
      const totalPx = spans.reduce((sum, s) => sum + s.getBoundingClientRect().width, 0);
      const startPx = (containerW - totalPx) / 2;

      spans.forEach((span, i) => {
        const rect = span.getBoundingClientRect();
        const leftPx   = startPx + accPx;
        const rightPx  = leftPx + rect.width;
        const centerPx = leftPx + rect.width / 2;
        accPx += rect.width;

        map.set(i, {
          width:  rect.width  / containerW * xres,
          height: rect.height / containerH * yres,
          center: centerPx   / containerW * xres,
          left:   leftPx     / containerW * xres,
          right:  rightPx    / containerW * xres,
          middle: slotY      / containerH * yres,
        });
      });

      wrapper.remove();
      resolve(map);
    });
  });
}

/**
 * Compute Y slot positions (in container pixels) for N streams.
 * Ported from karaoke-anim-v2.yaml lines 30–36.
 *
 * @param {number} n       – number of streams
 * @param {number} H       – container height in pixels
 * @param {object} [opts]  – { position: 'top'|'center'|'bottom', fontSize, lineSpacing }
 * @returns {number[]}     Y values in pixels
 */
export function computeSlotYs(n, H, opts = {}) {
  const pos = opts.position ?? 'center';
  const fs = parseFloat(opts.fontSize ?? '52') || 52;
  const spacing = parseFloat(opts.lineSpacing ?? '1.35') || 1.35;

  const anchor =
    pos === 'bottom' ? H * 0.82 :
    pos === 'top'    ? H * 0.18 :
    H * 0.5;

  if (n === 1) return [anchor];

  const step = fs * spacing * 2;
  const topY = anchor - step * (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => topY + i * step);
}
