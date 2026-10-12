// A stand-in for gh. Canned answers come from $HERDR_FAKE_DIR/gh.json; every call is logged to gh.log. The tests
// call it in their own process (`globalThis.__swGh`, see helpers.js): started as a program for every call it was a
// tenth of the suite's time. test/bin/gh is the same thing as a program, for whatever does start one.
import fs from "node:fs";
import path from "node:path";

export function run(a, dir = process.env.HERDR_FAKE_DIR) {
  let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(dir, "gh.json"), "utf8")); } catch {}
  fs.appendFileSync(path.join(dir, "gh.log"), a.join(" ") + "\n");
  const ok = (out = "") => ({ status: 0, stdout: out ? out + "\n" : "", stderr: "" });
  const fail = (m) => ({ status: 1, stdout: "", stderr: m + "\n" });
  // `late: { head, times }`: the first `times` looks at the pull request still name `head`, the commit before a push.
  const late = () => { const f = path.join(dir, "gh-late"); let n = 0; try { n = Number(fs.readFileSync(f, "utf8")); } catch {} fs.writeFileSync(f, String(n + 1)); return n < c.late.times; };
  if (a[0] === "pr" && a[1] === "create") return c.createFail ? fail(c.createFail) : ok("https://github.com/o/r/pull/7");
  if (a[0] === "pr" && (a[1] === "ready" || a[1] === "comment")) return ok();
  if (a[0] === "pr" && a[1] === "merge") {
    const only = a.includes("--match-head-commit") ? a[a.indexOf("--match-head-commit") + 1] : "";
    if (c.head && only && only !== c.head && !a.includes("--disable-auto")) return fail("Head branch was modified. Review and try the merge again.");
    if (a.includes("--disable-auto")) return c.disableFail ? fail("could not disable auto-merge") : ok();
    if (a.includes("--auto")) return c.autoOk ? ok() : fail("auto-merge is not allowed");
    if (c.mergeFail) return fail(c.mergeFail);
    if (!c.queue) fs.writeFileSync(path.join(dir, "gh-merged"), "1"); // `queue`: accepted, but only lined up to merge later
    return ok();
  }
  if (a[0] === "pr" && a[1] === "view" && c.late && late()) return ok(JSON.stringify({ state: "OPEN", headRefOid: c.late.head }));
  if (a[0] === "pr" && a[1] === "view") return ok(JSON.stringify({ ...(c.view || { state: "OPEN", statusCheckRollup: [], comments: [], reviews: [], author: { login: "me" } }), ...(fs.existsSync(path.join(dir, "gh-merged")) ? { state: "MERGED" } : {}) }));
  return fail("fake gh: unknown " + a.join(" "));
}
