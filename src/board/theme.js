// The board's colours, by the same token names pi-work's screen used. True colour, as herdr panes advertise.
// herdr does not share its theme with plugins, so it is light or dark, not the user's exact colours: the `theme`
// setting chooses, and "auto" asks the terminal for its background colour (OSC 11) when the board opens.
import { config } from "../store.js";

const DARK = {
  accent: [138, 190, 183], warning: [240, 198, 116], error: [204, 102, 102], success: [152, 195, 121], dim: [110, 110, 110],
  muted: [150, 150, 150], text: null, borderMuted: [80, 80, 80], mdLink: [129, 162, 190], selectedBg: [50, 54, 66],
};
const LIGHT = {
  accent: [30, 120, 110], warning: [160, 105, 0], error: [175, 40, 40], success: [45, 125, 45], dim: [140, 140, 140],
  muted: [100, 100, 100], text: null, borderMuted: [190, 190, 190], mdLink: [40, 90, 150], selectedBg: [222, 228, 238],
};
let RGB = DARK;
export const setLight = (light) => { RGB = light ? LIGHT : DARK; };
// Ask the terminal for its background colour; answers true (light), false (dark) or null (no answer in time).
export function detectLight(ms = 250) {
  const want = String(config().theme || "auto");
  if (want !== "auto") return Promise.resolve(want === "light");
  const fgbg = /;(\d+)$/.exec(process.env.COLORFGBG || "");
  const guess = fgbg ? [7, 15].includes(Number(fgbg[1])) : null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(guess);
  return new Promise((resolve) => {
    let buf = "", done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); process.stdin.off("data", on); try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); resolve(v); };
    const on = (d) => {
      buf += d;
      const m = /\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(buf);
      if (!m) return;
      const [r, g, b] = m.slice(1).map((x) => parseInt(x.slice(0, 2).padEnd(2, x[0]), 16));
      end(0.2126 * r + 0.7152 * g + 0.0722 * b > 140);
    };
    const timer = setTimeout(() => end(guess), ms);
    try { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", on); process.stdout.write("\x1b]11;?\x1b\\"); } catch { end(guess); }
  });
}
const plain = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
export const theme = {
  fg(token, s) { const c = RGB[token]; return plain || !c ? String(s) : `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[39m`; },
  bg(token, s) { const c = RGB[token]; return plain || !c ? String(s) : `\x1b[48;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[49m`; },
  bold: (s) => (plain ? String(s) : `\x1b[1m${s}\x1b[22m`),
  inverse: (s) => `\x1b[7m${s}\x1b[27m`,
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};
