/**
 * DOM element factory and layout utilities.
 *
 * SP1: one <div> per LayerSpec, positioned absolutely within #kstage.
 * SP2: measureLineEls() for real getBoundingClientRect text metrics.
 * SP4: will add syl-stack model with N children.
 */

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
  el.style.cssText = [
    'position:absolute',
    `left:${spec.style.left}`,
    `top:${spec.style.top}`,
    // \an N provides the anchor offset; default is center (\an5)
    `transform:${spec.style.transform ?? 'translate(-50%,-50%)'}`,
    `color:${spec.style.color}`,
    `opacity:0`,
    `font-family:${opts.font ?? 'sans-serif'}`,
    `font-size:${opts.fontSize ?? '52px'}`,
    `font-weight:${opts.fontWeight ?? 'bold'}`,
    'white-space:nowrap',
    'will-change:opacity,transform',
  ].join(';');
  return el;
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
