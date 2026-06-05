/**
 * SP6 example — Lollipop shapes with \p1 drawing commands.
 *
 * Demonstrates: \p1 candy shape, \1c color array, \3c border color,
 * \shad 2 shadow, \be1 edge blur, loop 7 particles with retime() stagger.
 *
 * Requires SP5 KT substrate + SP6 drawing/tag extensions.
 */
export const luaScript = `
-- code once
-- Define a 3-color palette (cyan, magenta, yellow) in ASS BGR order
local colors = {"&H69FFF6&", "&HFF69B4&", "&HFFF069&"}
-- end code once

-- template syl noblank notext loop 7
!retime("syl", (j-1)*50, 500)!{\\c!colors[math.random(3)]!\\an5\\pos(!$scenter!,!$smiddle!)\\blur0\\bord0\\fscx!math.random(30,60)!\\fscy!math.random(30,60)!\\t(\\blur5)\\fad(0,300)\\p1\\be1}m 0 0 b 21 0 21 25 0 25 b -19 25 -19 0 0 0
-- end template

-- template syl noblank
!retime("start2syl", -300 + syl.i * 30, 0)!{\\pos(!$scenter!,!$smiddle!)\\an5\\bord2\\blur3\\3c&H000000&\\shad2\\fscx0\\fscy0\\t(0,200,\\fscx100\\fscy100)\\fad(200,0)}!syl.text_stripped!
-- end template
`;
