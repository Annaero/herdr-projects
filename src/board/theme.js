// The board's colours, by the same token names pi-work's screen used. True colour, as herdr panes advertise.
const RGB = {
  accent: [138, 190, 183], warning: [240, 198, 116], error: [204, 102, 102], success: [152, 195, 121], dim: [110, 110, 110],
  muted: [150, 150, 150], text: null, borderMuted: [80, 80, 80], mdLink: [129, 162, 190], selectedBg: [50, 54, 66],
};
const plain = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
export const theme = {
  fg(token, s) { const c = RGB[token]; return plain || !c ? String(s) : `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[39m`; },
  bg(token, s) { const c = RGB[token]; return plain || !c ? String(s) : `\x1b[48;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[49m`; },
  bold: (s) => (plain ? String(s) : `\x1b[1m${s}\x1b[22m`),
  inverse: (s) => `\x1b[7m${s}\x1b[27m`,
  underline: (s) => `\x1b[4m${s}\x1b[24m`,
};
