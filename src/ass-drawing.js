/**
 * ASS drawing command parser — SP6.
 *
 * Converts ASS \pN drawing syntax into a Canvas Path2D.
 * Drawing scale: \pN → 1/2^(N-1) pixel resolution.
 *   \p1 → scale=1 (coords in px)
 *   \p2 → scale=0.5 (coords in 0.5px)
 *   \p4 → scale=0.125 (coords in 0.125px)
 *
 * The returned Path2D has its origin at the drawing coordinate (0,0).
 * Callers should ctx.translate(originX, originY) before ctx.fill(path)
 * to position the drawing at the desired canvas pixel coordinate.
 */

/**
 * Parse ASS drawing commands into a Path2D.
 *
 * @param {string} cmdStr       – drawing command string (content after tag block in \p1 lines)
 * @param {number} drawingScale – N from \pN (1, 2, 4, …); defaults to 1
 * @returns {Path2D}
 */
export function parseDrawingCmds(cmdStr, drawingScale = 1) {
  const scale = 1 / Math.pow(2, Math.max(1, drawingScale) - 1);
  const path = new Path2D();
  const tokens = String(cmdStr).trim().split(/\s+/);
  let i = 0;

  function peek() { return tokens[i]; }
  function isNumTok(t) { return t !== undefined && /^-?\d/.test(t); }
  function nextNum() { return parseFloat(tokens[i++]) * scale; }

  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) { i++; continue; }

    // Command tokens are non-numeric
    if (!isNumTok(tok)) {
      i++;
      const cmd = tok.toLowerCase();

      if (cmd === 'm') {
        // m x y — move to, opens a new sub-path
        if (isNumTok(peek()) && isNumTok(tokens[i + 1])) {
          path.moveTo(nextNum(), nextNum());
        }
      } else if (cmd === 'n') {
        // n x y — move to without closing (same effect in Canvas 2D)
        if (isNumTok(peek()) && isNumTok(tokens[i + 1])) {
          path.moveTo(nextNum(), nextNum());
        }
      } else if (cmd === 'l') {
        // l x y [x y …] — one or more line segments
        while (isNumTok(peek()) && isNumTok(tokens[i + 1])) {
          path.lineTo(nextNum(), nextNum());
        }
      } else if (cmd === 'b') {
        // b cx1 cy1 cx2 cy2 x y [cx1 …] — one or more cubic bezier segments
        while (
          isNumTok(peek()) && isNumTok(tokens[i + 1]) &&
          isNumTok(tokens[i + 2]) && isNumTok(tokens[i + 3]) &&
          isNumTok(tokens[i + 4]) && isNumTok(tokens[i + 5])
        ) {
          const cx1 = nextNum(), cy1 = nextNum();
          const cx2 = nextNum(), cy2 = nextNum();
          const x   = nextNum(), y   = nextNum();
          path.bezierCurveTo(cx1, cy1, cx2, cy2, x, y);
        }
      } else if (cmd === 's') {
        // s x y [x y …] — uniform cubic b-spline; approximated as line segments
        while (isNumTok(peek()) && isNumTok(tokens[i + 1])) {
          path.lineTo(nextNum(), nextNum());
        }
      } else if (cmd === 'p') {
        // p x y [x y …] — extend b-spline; approximated as line segments
        while (isNumTok(peek()) && isNumTok(tokens[i + 1])) {
          path.lineTo(nextNum(), nextNum());
        }
      } else if (cmd === 'c') {
        // c — close sub-path
        path.closePath();
      }
      // Unknown commands are silently skipped
    } else {
      // Leading numbers without a command: skip
      i++;
    }
  }

  return path;
}
