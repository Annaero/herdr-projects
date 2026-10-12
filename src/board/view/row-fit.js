// What a section of the list shows when space is short: its rows give the same things up together, in one order.
//
// The order, first to go to last: what a row says, the bar, the word "ago", the part of a name past NAME_OWED cells,
// the percent with the minutes left, the review tag, the pull request, the time, and then the rest of the name.
// A row is { room, name, has }: the cells right of its mark, its name's width, which columns it has something in.
// A cell is { key, w }: one column of the list, left to right, at the width it is decided with.

// A name is whole up to this many cells. What is past them is cut before a column goes, so that one long name does
// not cost every row of its section the columns (a title is at most TITLE_MAX, 60: it loses a third at most).
export const NAME_OWED = 40;
// The minutes left are decided at this width whatever they read now: "9m" turning "10m" must not hide a bar.
export const ETA_STEADY = 4;

// The columns from `from` to the right edge: a cell between each, two before them.
export const wide = (cells, from) => cells.slice(from).reduce((n, c) => n + c.w + 1, 1);
// A row's first own column at or right of `from`: blank cells left of it are not columns to that row.
export const ownFrom = (row, cells, from) => { while (from < cells.length && !row.has[cells[from].key]) from++; return from; };
// What is left for a row's name and what it says, beside the columns it shows from `from`.
export const labelRoom = (row, cells, from) => { const at = ownFrom(row, cells, from); return at < cells.length ? row.room - wide(cells, at) : row.room; };

// Where a section's columns start: `from` is the first one its rows show, the same for every row, so a column is on
// each row that has it or on none. `cost` is what the section went without, to compare two widths of the columns:
// the columns right of the bar it does not show, then the cells cut off its names.
export function shownFrom(rows, cells) {
  const fits = (from, owed) => rows.every((row) => ownFrom(row, cells, from) === cells.length || labelRoom(row, cells, from) >= Math.min(row.room, row.name, owed));
  // The minutes left go with their percent: alone beside the time they would read as a second time.
  const stops = [...cells.keys(), cells.length].filter((n) => !(cells[n]?.key === "eta" && cells[n - 1]?.key === "percent"));
  // A bar is never worth a cut name: names are cut only for the columns right of it.
  const from = Math.min(stops.find((n) => fits(n, Infinity)), stops.find((n) => cells[n]?.key !== "bar" && fits(n, NAME_OWED)));
  const cut = rows.reduce((n, row) => n + Math.max(0, Math.min(row.room, row.name) - labelRoom(row, cells, from)), 0);
  return { from, cost: [Math.max(from, cells[0]?.key === "bar" ? 1 : 0), from < cells.length ? cut : 0] };
}
