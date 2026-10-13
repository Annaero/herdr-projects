// The words on a program's screen, for a program whose saved conversation the board cannot read (agents/talk.js
// reads the others, and those never need this). What a terminal program draws is told from what it says by its
// shape alone, never by a list of one version's words: a line that is mostly drawing (a rule, a box's edge, a logo
// made of dots or blocks, a bar) holds few letters among its marks, and is left out; a box's edges are taken off the
// words inside it.
const EDGE = /^[\s│┃|╭╮╰╯┌┐└┘─━═]+|[\s│┃|╭╮╰╯┌┐└┘─━═]+$/gu;
const drawn = (line) => { const marks = line.replace(/\s/g, ""), words = marks.replace(/[^\p{L}\p{N}]/gu, ""); return !!marks && words.length * 2 < marks.length; };
export function screenText(screen) {
  const out = [];
  for (const raw of String(screen || "").split("\n")) {
    const line = raw.replace(EDGE, "");
    if (raw.trim() && (!line || drawn(line))) continue;
    if (!line && !out.at(-1)) continue; // one empty line between two blocks, none at the top
    out.push(line ? raw.replace(/^[\s]*[│┃|]\s?/u, "").replace(/\s*[│┃|]\s*$/u, "").trimEnd() : "");
  }
  while (out.length && !out.at(-1)) out.pop();
  return out.join("\n");
}
