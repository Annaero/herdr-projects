// The board's own drawing code, used for a web page: a theme that marks text with the name of its colour instead of
// a terminal's colour codes, and the reading of such text into pieces a page can draw ({ t: text, c: colour name,
// b: bold, d: dim }). So the same functions that paint the terminal board (a row's mark, what it says, the task
// panel's lines) say what the web board shows, and the page only gives each colour name a colour of its own.
// A colour name travels as a 256-colour code, which the layout code already measures as no width at all.
const names = [];
const code = (token) => { let n = names.indexOf(token); if (n < 0) n = names.push(token) - 1; return n; };
const MARKS = { idle: "○", working: "●", blocked: "◆", done: "✓", error: "✕", unknown: "·" };

export const webTheme = {
  fg: (token, s) => (s === "" || s == null ? "" : `\x1b[38;5;${code(token)}m${s}\x1b[39m`),
  bg: (token, s) => String(s ?? ""),
  selected: (s) => String(s ?? ""),
  under: (token, s) => String(s ?? ""),
  line: (s) => String(s ?? ""),
  muted: (s) => webTheme.fg("overlay0", s),
  // The page draws each state's mark itself (the web UI's own shapes); the word is what travels.
  mark: (state) => MARKS[state] || MARKS.unknown,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
  inverse: (s) => String(s ?? ""),
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};

// Marked text as pieces. Codes it does not know are dropped; text between them keeps the style in force. A link the
// board wrote for the terminal (OSC 8) is a piece's `href`.
export function pieces(text) {
  const out = [];
  let c = "", b = false, d = false, href = "", last = 0;
  const push = (s) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev && (prev.c || "") === c && !!prev.b === b && !!prev.d === d && (prev.href || "") === href) { prev.t += s; return; }
    out.push({ t: s, ...(c ? { c } : {}), ...(b ? { b } : {}), ...(d ? { d } : {}), ...(href ? { href } : {}) });
  };
  const str = String(text ?? "");
  const re = /\x1b\[([0-9;]*)m|\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b_[^\x07]*\x07|\x1b\][^\x07]*\x07/g;
  for (let m; (m = re.exec(str)); ) {
    push(str.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== undefined) { href = /^https?:\/\//.test(m[2]) ? m[2] : ""; continue; }
    if (m[1] === undefined) continue;
    const n = m[1].split(";").map(Number);
    if (n[0] === 38 && n[1] === 5) c = names[n[2]] || "";
    else if (n[0] === 39) c = "";
    else if (n[0] === 0 || m[1] === "") { c = ""; b = d = false; }
    else if (n[0] === 1) b = true;
    else if (n[0] === 2) d = true;
    else if (n[0] === 22) { b = false; d = false; }
  }
  push(str.slice(last));
  return out;
}
export const plain = (text) => pieces(text).map((p) => p.t).join("");
