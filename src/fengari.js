/**
 * Fengari Lua VM wrapper.
 * Fengari is a pure-JS Lua 5.3 interpreter — no WASM, init is synchronous.
 *
 * Lifecycle:
 *   initVM(opts)          — call once at G.TYPE.INIT; sets up aegisub + karaskel globals
 *   runScript(L, script, lineTable, opts) — call per LINE preview; returns dialogue[]
 *   disposeVM(L)          — call at G.TYPE.UNINIT
 */

import * as fengariMod from 'fengari-web';

function getFengari() {
  return fengariMod;
}

/** One-time VM initialization. Returns the Lua state L. */
export function initVM(opts = {}) {
  const { lua, lauxlib, lualib, to_luastring } = fengariMod;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const setupCode = buildSetupCode(opts);
  const status = lauxlib.luaL_dostring(L, to_luastring(setupCode));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: Fengari setup error: ' + msg);
  }

  return L;
}

/**
 * Run a karaskel Lua script for one line. Returns an array of dialogue objects:
 * [{ layer, start_time, end_time, text, style }]
 */
export function runScript(L, luaScript, lineTable, opts = {}) {
  const { lua, lauxlib, to_luastring } = getFengari();

  // Reset per-line state + inject line table
  const preCode = buildPreCode(lineTable, opts);
  let status = lauxlib.luaL_dostring(L, to_luastring(preCode));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: pre-code error: ' + msg);
  }

  status = lauxlib.luaL_dostring(L, to_luastring(luaScript));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: script error: ' + msg);
  }

  return collectResults(L, opts);
}

/**
 * Execute a Lua code string in an existing VM state. Throws on Lua error.
 * Used by kt-substrate.js for code-once blocks and template bodies.
 */
export function execLua(L, code) {
  const { lua, lauxlib, to_luastring } = getFengari();
  const status = lauxlib.luaL_dostring(L, to_luastring(code));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: execLua error: ' + msg);
  }
}

/**
 * Evaluate a Lua expression and return a value safe to splice back into Lua code.
 * - Numbers/booleans → plain string ("320", "true")
 * - Strings → Lua-quoted string literal ('"hello"') so the result is valid Lua
 */
export function evalExpression(L, expr) {
  execLua(L,
    'do local _v = (' + expr + ');' +
    'if type(_v) == "string" then _kt_result = string.format("%q", _v)' +
    ' else _kt_result = tostring(_v) end end'
  );
  return readGlobal(L, '_kt_result');
}

/**
 * Set up the per-line Lua context (line table, subs, _appended, randomseed).
 * Must be called before expandKTLine processes template bodies.
 */
export function setupLineContext(L, lineTable, opts = {}) {
  const { lauxlib, lua, to_luastring } = getFengari();
  const preCode = buildPreCode(lineTable, opts);
  const status = lauxlib.luaL_dostring(L, to_luastring(preCode));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: setupLineContext error: ' + msg);
  }
}

/**
 * Collect and return the current _appended[] table from the Lua VM.
 * Same as the internal collectResults but exported for kt-substrate.js.
 */
export function collectResultsRaw(L, opts) {
  return collectResults(L, opts);
}

export function disposeVM(L) {
  if (!L || !fengariMod) return;
  fengariMod.lua.lua_close(L);
}

/**
 * Inject measured text extents into the live Lua VM so aegisub.text_extents()
 * returns real values. Must be called after patchMetrics() and before runScript().
 *
 * @param {object} L – Fengari Lua state
 * @param {Map<string, {w: number, h: number}>} extentsMap
 *   Keyed by syl.text_stripped; values in video coordinate space.
 */
export function injectExtents(L, extentsMap) {
  const { lauxlib, lua, to_luastring } = getFengari();

  const entries = [...extentsMap.entries()]
    .map(([text, { w, h }]) => `[${luaStr(text)}]={w=${w},h=${h}}`)
    .join(',');

  const code = `
_extents = {${entries}}
aegisub.text_extents = function(style, text)
  local e = _extents[text]
  if e then return e.w, e.h, 0, 0 else return 0, 0, 0, 0 end
end
`;
  const status = lauxlib.luaL_dostring(L, to_luastring(code));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: injectExtents error: ' + msg);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildSetupCode(opts) {
  const xres = opts.xres ?? 640;
  const yres = opts.yres ?? 480;
  const fps = opts.fps ?? 24;

  return `
_xres = ${xres}
_yres = ${yres}
_fps  = ${fps}

aegisub = {}
aegisub.video_size      = function() return _xres, _yres end
aegisub.ms_from_frame   = function(n) return n * (1000 / _fps) end
aegisub.text_extents    = function(style, text) return 0, 0, 0, 0 end
aegisub.set_undo_point  = function() end
aegisub.register_macro  = function(name, desc, fn) fn() end
aegisub.progress        = { set = function() end, task = function() end, title = function() end }

karaskel = {}
karaskel.collect_head     = function(subs, config) end
karaskel.preproc_line     = function(subs, config, line, do_furigana) end
karaskel.preproc_line_pos = function(meta, styles, line, do_furigana) end

function retime(mode, s, e)
  local ls = line and line.start_time or 0
  local ss = syl and syl.start_time or 0
  local se = syl and syl.end_time   or 0
  local sd = syl and syl.duration   or 0
  if     mode == "syl"       then return ls+ss+s, ls+ss+sd+e
  elseif mode == "presyl"    then return ls+ss+s, ls+ss+e
  elseif mode == "postsyl"   then return ls+se+s, ls+se+e
  elseif mode == "start2syl" then return ls+s,    ls+ss+e
  elseif mode == "abs"       then return s, e
  else                            return ls+ss+s, ls+ss+sd+e
  end
end
`;
}

function buildPreCode(lineTable, opts) {
  const seed = opts.seed ?? lineTable.id ?? lineTable.start_time ?? 0;
  const sylsLua = lineTable.kara.map((syl, i) =>
    `    {text_stripped=${luaStr(syl.text_stripped)},` +
    `start_time=${syl.start_time},end_time=${syl.end_time},` +
    `duration=${syl.duration},` +
    `center=${Math.round(syl.center)},middle=${Math.round(syl.middle)},` +
    `width=${Math.round(syl.width ?? 0)},height=${Math.round(syl.height ?? 0)},` +
    `left=${Math.round(syl.left ?? 0)},right=${Math.round(syl.right ?? 0)},` +
    `i=${i + 1}}`
  ).join(',\n');

  return `
_appended = {}
subs = {}
subs.append = function(obj) table.insert(_appended, obj) end

line = {
  start_time = ${lineTable.start_time},
  end_time   = ${lineTable.end_time},
  duration   = ${lineTable.end_time - lineTable.start_time},
  middle     = ${Math.round(lineTable.middle)},
  left       = ${Math.round(lineTable.left ?? 0)},
  right      = ${Math.round(lineTable.right ?? (opts.xres ?? 640))},
  top        = ${Math.round(lineTable.top ?? 0)},
  bottom     = ${Math.round(lineTable.bottom ?? (opts.yres ?? 480))},
  width      = ${Math.round(lineTable.lineWidth ?? (opts.xres ?? 640))},
  height     = ${Math.round(lineTable.lineHeight ?? 36)},
  kara       = {
${sylsLua}
  }
}

math.randomseed(${seed})
`;
}

function collectResults(L, opts) {
  const { lua, lauxlib, to_luastring } = getFengari();

  // Serialize _appended to JSON via Lua (avoids complex Lua→JS table traversal)
  const collectCode = `
do
  local parts = {}
  for i, item in ipairs(_appended) do
    local txt = tostring(item.text or "")
    txt = txt:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('\\n', '\\\\n'):gsub('\\r', '')
    local sty = tostring(item.style or "Default"):gsub('"', '\\\\"')
    table.insert(parts, string.format(
      '{"layer":%d,"start_time":%d,"end_time":%d,"text":"%s","style":"%s"}',
      item.layer or 0,
      math.floor(item.start_time or 0),
      math.floor(item.end_time or 0),
      txt, sty
    ))
  end
  _json_result = "[" .. table.concat(parts, ",") .. "]"
end
`;

  const status = lauxlib.luaL_dostring(L, to_luastring(collectCode));
  if (status !== lua.LUA_OK) {
    const msg = readString(L, -1);
    lua.lua_pop(L, 1);
    throw new Error('animr-aegisub: collect error: ' + msg);
  }

  const json = readGlobal(L, '_json_result');
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('animr-aegisub: JSON parse error: ' + e.message + '\nJSON: ' + json);
  }
}

function readGlobal(L, name) {
  const { lua, to_luastring, to_jsstring } = getFengari();
  lua.lua_getglobal(L, to_luastring(name));
  const raw = lua.lua_tostring(L, -1);
  const str = raw ? to_jsstring(raw) : '';
  lua.lua_pop(L, 1);
  return str;
}

function readString(L, idx) {
  const { lua, to_jsstring } = getFengari();
  const raw = lua.lua_tostring(L, idx);
  return raw ? to_jsstring(raw) : '(no message)';
}

function luaStr(s) {
  return "'" + (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '') + "'";
}
