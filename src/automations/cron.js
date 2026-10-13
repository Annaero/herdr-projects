// A cron expression: five fields (minute, hour, day of the month, month, day of the week), read in this machine's
// time zone. `*`, lists (`1,15`), ranges (`1-5`), steps (`*/10`, `8-18/2`), and names for months and days (`jan`,
// `mon`). When both the day of the month and the day of the week are given, either one matching is enough, as in cron.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FIELDS = [["minute", 0, 59], ["hour", 0, 23], ["day of the month", 1, 31], ["month", 1, 12, MONTHS, 1], ["day of the week", 0, 7, DAYS, 0]];

function field(text, [what, min, max, names, base]) {
  const bad = () => new Error(`"${text}" is not a ${what} (${min} to ${max}${names ? `, or ${names[0]} to ${names.at(-1)}` : ""})`);
  const num = (s) => { const n = names ? names.indexOf(String(s).toLowerCase()) : -1; const v = n >= 0 ? n + base : /^\d+$/.test(s) ? Number(s) : NaN; if (!(v >= min && v <= max)) throw bad(); return v; };
  const out = new Set();
  for (const part of String(text).split(",")) {
    const [range, step = "1"] = part.split("/");
    const by = /^\d+$/.test(step) ? Number(step) : 0;
    if (!range || by < 1 || part.split("/").length > 2) throw bad();
    const [a, b] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(num) : [num(range), part.includes("/") ? max : num(range)];
    if (a > b) throw bad();
    for (let v = a; v <= b; v += by) out.add(what === "day of the week" && v === 7 ? 0 : v);
  }
  return out;
}
// The expression as sets of what matches, or an error that names the field that is wrong.
export function parseCron(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length !== 5) throw new Error(`A cron expression has five fields (minute hour day month weekday), as in "0 9 * * 1"; this has ${words.length}.`);
  const [minute, hour, dom, month, dow] = words.map((w, n) => field(w, FIELDS[n]));
  return { minute, hour, dom, month, dow, anyDom: words[2] === "*", anyDow: words[4] === "*", text: words.join(" ") };
}
// The first moment after `after` (a time in ms) the expression matches, in local time; 0 when there is none in the
// next five years (the 30th of February).
export function cronNext(cron, after) {
  const c = typeof cron === "string" ? parseCron(cron) : cron;
  const start = new Date(after);
  start.setSeconds(0, 0); start.setMinutes(start.getMinutes() + 1);
  const dayOk = (d) => c.month.has(d.getMonth() + 1) && (c.anyDom && c.anyDow ? true : c.anyDom ? c.dow.has(d.getDay()) : c.anyDow ? c.dom.has(d.getDate()) : c.dom.has(d.getDate()) || c.dow.has(d.getDay()));
  const hours = [...c.hour].sort((a, b) => a - b), minutes = [...c.minute].sort((a, b) => a - b);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let n = 0; n < 366 * 5; n++, day.setDate(day.getDate() + 1)) {
    if (!dayOk(day)) continue;
    for (const h of hours) for (const m of minutes) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
      // An hour the clock skips (the night summer time starts) lands on another hour: that tick is not this one.
      if (at.getHours() === h && at.getMinutes() === m && at.getTime() >= start.getTime()) return at.getTime();
    }
  }
  return 0;
}
