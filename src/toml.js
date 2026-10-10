// A TOML reader for herdr's config.toml: the whole format (v1.0, and the newer \e and \x escapes), so that whatever
// herdr accepts the plugin reads the same. Dates and times are kept as text. A file that is not TOML throws.
export function parseToml(source) {
  const s = String(source).replace(/\r\n/g, "\n");
  let i = 0;
  const root = {};
  let table = root;
  const fail = (why) => { throw new Error(`TOML: ${why} at line ${s.slice(0, i).split("\n").length}`); };
  const ws = () => { while (s[i] === " " || s[i] === "\t") i++; };
  const comment = () => { if (s[i] === "#") while (i < s.length && s[i] !== "\n") i++; };
  const blank = () => { for (;;) { ws(); comment(); if (s[i] === "\n") i++; else break; } };
  const eol = () => { ws(); comment(); if (i < s.length && s[i] !== "\n") fail("expected the end of the line"); };
  const escape = () => {
    const c = s[i++];
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" }[c];
    if (simple !== undefined) return simple;
    const n = { x: 2, u: 4, U: 8 }[c], hex = s.slice(i, i + (n || 0));
    if (!n || hex.length !== n || /[^0-9a-fA-F]/.test(hex) || parseInt(hex, 16) > 0x10ffff) fail("bad escape");
    i += n;
    return String.fromCodePoint(parseInt(hex, 16));
  };
  // The closing quotes of a multi-line string: up to two more quotes before them belong to the text.
  const closing = (q) => { let n = 3; while (n < 5 && s[i + n] === q) n++; i += n; return q.repeat(n - 3); };
  const basic = () => {
    let out = "";
    if (s.startsWith('"""', i)) {
      i += 3; if (s[i] === "\n") i++;
      for (;;) {
        if (i >= s.length) fail("a string is not closed");
        if (s.startsWith('"""', i)) return out + closing('"');
        if (s[i] !== "\\") { out += s[i++]; continue; }
        i++;
        let j = i; while (s[j] === " " || s[j] === "\t") j++;
        if (s[j] === "\n") { i = j; while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++; } else out += escape(); // a backslash ending a line joins the next
      }
    }
    for (i++; ;) {
      const c = s[i];
      if (c === undefined || c === "\n") fail("a string is not closed");
      i++;
      if (c === '"') return out;
      out += c === "\\" ? escape() : c;
    }
  };
  const literal = () => {
    if (s.startsWith("'''", i)) {
      i += 3; if (s[i] === "\n") i++;
      const start = i, end = s.indexOf("'''", i);
      if (end < 0) fail("a string is not closed");
      i = end;
      return s.slice(start, end) + closing("'");
    }
    const end = s.indexOf("'", i + 1);
    if (end < 0 || s.slice(i, end).includes("\n")) fail("a string is not closed");
    const out = s.slice(i + 1, end); i = end + 1;
    return out;
  };
  const take = (re) => { re.lastIndex = i; const m = re.exec(s); if (m) i = re.lastIndex; return m && m[0]; };
  const key = () => {
    for (const keys = []; ;) {
      ws();
      keys.push(s[i] === '"' ? basic() : s[i] === "'" ? literal() : take(/[A-Za-z0-9_-]+/y) ?? fail("expected a key"));
      ws();
      if (s[i] !== ".") return keys;
      i++;
    }
  };
  // Keys are only ever the table's own: a key named __proto__ or constructor is plain data, never the object's
  // inherited property, so no file can reach Object.prototype.
  const own = (obj, k) => (Object.hasOwn(obj, k) ? obj[k] : undefined);
  const set = (obj, k, v) => { Object.defineProperty(obj, k, { value: v, writable: true, enumerable: true, configurable: true }); return v; };
  const at = (obj, keys) => {
    for (const k of keys) {
      let next = own(obj, k);
      if (Array.isArray(next)) next = next.at(-1); // inside the newest [[table]]
      if (next === undefined) next = set(obj, k, {});
      if (next === null || typeof next !== "object") fail(`${k} is not a table`);
      obj = next;
    }
    return obj;
  };
  const put = (obj, keys, v) => { set(at(obj, keys.slice(0, -1)), keys.at(-1), v); };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '"') return basic();
    if (c === "'") return literal();
    if (c === "[") {
      i++;
      for (const out = []; ;) {
        blank();
        if (s[i] === "]") { i++; return out; }
        out.push(value()); blank();
        if (s[i] === ",") i++; else if (s[i] !== "]") fail("expected , or ]");
      }
    }
    if (c === "{") {
      i++;
      for (const out = {}; ;) {
        blank();
        if (s[i] === "}") { i++; return out; }
        const k = key();
        if (s[i] !== "=") fail("expected =");
        i++; put(out, k, value()); blank();
        if (s[i] === ",") i++; else if (s[i] !== "}") fail("expected , or }");
      }
    }
    const t = take(/\d{4}-\d\d-\d\d[Tt ]\d\d:[^\s,\]}#]*/y) ?? take(/[^\s,\]}#]+/y) ?? fail("expected a value");
    if (t === "true" || t === "false") return t === "true";
    if (/^[+-]?(inf|nan)$/.test(t)) return t.endsWith("nan") ? NaN : t[0] === "-" ? -Infinity : Infinity;
    if (/^0(x[0-9a-fA-F_]+|o[0-7_]+|b[01_]+)$/.test(t)) return Number(t.replace(/_/g, ""));
    if (/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?$/.test(t)) return Number(t.replace(/_/g, ""));
    if (/^\d{4}-\d\d-\d\d|^\d\d:\d\d/.test(t)) return t;
    return fail(`unknown value ${t}`);
  };
  for (;;) {
    blank();
    if (i >= s.length) return root;
    if (s[i] === "[") {
      const list = s[i + 1] === "[", close = list ? "]]" : "]";
      i += close.length;
      const k = key();
      if (!s.startsWith(close, i)) fail(`expected ${close}`);
      i += close.length;
      if (list) { const parent = at(root, k.slice(0, -1)), name = k.at(-1); const rows = own(parent, name) ?? set(parent, name, []); if (!Array.isArray(rows)) fail(`${name} is not a list of tables`); rows.push(table = {}); }
      else table = at(root, k);
    } else {
      const k = key();
      if (s[i] !== "=") fail("expected =");
      i++; put(table, k, value());
    }
    eol();
  }
}
