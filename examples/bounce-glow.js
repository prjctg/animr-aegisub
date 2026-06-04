/**
 * SP3 example: syllables pop in with a scale bounce and a blurred glow duplicate.
 *
 * Layer 0 — main text: starts scaled to 130%, bounces through 100% → 110% → 100%
 *           using three consecutive \t() segments (tests multi-segment interpProp).
 * Layer 1 — glow copy: larger static scale, heavy blur that clears quickly via \t(),
 *           and a longer fade-out to create a lingering afterglow.
 *
 * Requires SP3+ parser (syl.center / syl.middle from equal-width approximation is fine).
 */

import { karaskel } from "https://cdn.jsdelivr.net/gh/prjctg/animr-aegisub@0.1/dist/animr-aegisub.js";

export const luaScript = `
for si, syl in ipairs(line.kara) do
  if syl.text_stripped ~= "" then
    local t0 = line.start_time + syl.start_time
    local t1 = line.start_time + syl.end_time

    -- Layer 0: main syllable with spring-style scale bounce
    subs.append({
      layer = 0,
      start_time = t0 - 80,
      end_time   = t1 + 400,
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(80,200)" ..
        "\\fscx130\\fscy130" ..
        "\\t(0,200,\\fscx100\\fscy100)" ..
        "\\t(200,350,\\fscx110\\fscy110)" ..
        "\\t(350,500,\\fscx100\\fscy100)}%s",
        syl.center, syl.middle,
        syl.text_stripped)
    })

    -- Layer 1: glow duplicate — larger, blurred, dissolves quickly
    subs.append({
      layer = 1,
      start_time = t0 - 80,
      end_time   = t1 + 400,
      text = string.format(
        "{\\an5\\pos(%d,%d)\\fad(80,400)" ..
        "\\fscx140\\fscy140" ..
        "\\t(0,200,\\fscx105\\fscy105)" ..
        "\\blur8\\t(0,80,\\blur4)}%s",
        syl.center, syl.middle,
        syl.text_stripped)
    })
  end
end
`;

export const {
  h,
  s,
  default: init,
} = karaskel(luaScript, {
  font: "sans-serif",
  fontSize: "52px",
  fontWeight: "bold",
  position: "center",
});

export default init;
