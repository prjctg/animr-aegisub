/**
 * animr-aegisub — Public API
 *
 * Two export styles that mirror animr-shadertoy:
 *
 *   // Declarative (3-line usage):
 *   const { h, s, default: init } = karaskel(luaScript);
 *   export { h, s };
 *   export default init;
 *
 *   // Imperative:
 *   export default function(G, shadowRoot, config) {
 *     createKaraskel(G, shadowRoot, luaScript, opts, config);
 *   }
 */

import { buildStageHtml } from './layout.js';
import { wireEvents } from './events.js';

const DEFAULTS = {
  xres: 640,
  yres: 480,
  fps: 24,
  channel: 0,
  font: 'sans-serif',
  fontSize: '52px',
  fontWeight: 'bold',
  position: 'center',
  previewMs: 1500,
  lineSpacing: 1.35,
  onError: console.error,
};

/**
 * Imperative entry point. Wire all G events for the given Lua script.
 *
 * @param {object} G
 * @param {ShadowRoot} shadowRoot
 * @param {string} luaScript
 * @param {object} [userOpts]
 * @param {object} [config]   – Animr module config (reserved for SP2+ config binding)
 */
export function createKaraskel(G, shadowRoot, luaScript, userOpts = {}, config = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  wireEvents(G, shadowRoot, luaScript, opts);
}

/**
 * Declarative factory — returns the three Animr module exports directly.
 *
 * @param {string} luaScript – karaskel Lua source
 * @param {object} [userOpts]
 * @returns {{ h: string, s: string, default: function }}
 */
export function karaskel(luaScript, userOpts = {}) {
  const h = buildStageHtml();
  const s = '';
  const defaultFn = (G, shadowRoot, config) =>
    createKaraskel(G, shadowRoot, luaScript, userOpts, config);
  return { h, s, default: defaultFn };
}
