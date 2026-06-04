/**
 * DOM element factory and layout utilities.
 *
 * SP1: one <div> per LayerSpec, positioned absolutely within #kstage.
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
    'transform:translate(-50%,-50%)',
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
