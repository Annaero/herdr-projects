//! A stand-in for the gh program, answering in the test's own thread (flow::git::set_fake_gh): canned answers set by
//! the test (`w.gh_says(json!({..}))`), every call logged (`gh_log(&w)`). No real gh, no network.
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use sw::flow::git::GhOut;
use sw::json::*;

/// What gh answers, as the old test/fake-gh.js: `user`, `createFail`, `head`, `disableFail`, `autoOk`, `mergeFail`,
/// `queue` (accepted, only lined up to merge later), `view` (what `pr view` gives), `late: { head, times }` (the first
/// `times` looks at the pull request still name `head`, the commit before a push), `log` (what `run view --log-failed`
/// prints of a failed job), `base` and `baseFail` (the checks of the branch it merges into, asked through `api`), `required` (the checks it requires), `runs` (a commit's workflow runs), `others`
/// (how many of the repo's last pull requests had checks).
#[derive(Default)]
pub struct FakeGh { pub cfg: RefCell<Value>, pub log: RefCell<Vec<String>>, pub merged: Cell<bool>, late: Cell<i64> }
fn ok(out: &str) -> GhOut { GhOut { status: 0, stdout: if out.is_empty() { String::new() } else { format!("{out}\n") }, stderr: String::new() } }
fn fail(m: &str) -> GhOut { GhOut { status: 1, stdout: String::new(), stderr: format!("{m}\n") } }
impl FakeGh {
    pub fn run(&self, a: &[String]) -> GhOut {
        let c = self.cfg.borrow().clone();
        self.log.borrow_mut().push(a.join(" "));
        let (x, y) = (a.first().map(|s| s.as_str()).unwrap_or(""), a.get(1).map(|s| s.as_str()).unwrap_or(""));
        let has = |f: &str| a.iter().any(|s| s == f);
        match (x, y) {
            ("api", "user") => ok(if c.b("user") { c.s("user") } else { "me" }),
            ("pr", "create") => if c.b("createFail") { fail(c.s("createFail")) } else { ok("https://github.com/o/r/pull/7") },
            ("pr", "ready") | ("pr", "comment") => ok(""),
            ("pr", "merge") => {
                let only = a.iter().position(|s| s == "--match-head-commit").and_then(|i| a.get(i + 1)).cloned().unwrap_or_default();
                if c.b("head") && !only.is_empty() && only != c.s("head") && !has("--disable-auto") { return fail("Head branch was modified. Review and try the merge again."); }
                if has("--disable-auto") { return if c.b("disableFail") { fail("could not disable auto-merge") } else { ok("") }; }
                if has("--auto") { return if c.b("autoOk") { ok("") } else { fail("auto-merge is not allowed") }; }
                if c.b("mergeFail") { return fail(c.s("mergeFail")); }
                if !c.b("queue") { self.merged.set(true); }
                ok("")
            }
            ("pr", "view") => {
                if c.at("late").is_object() { let n = self.late.get(); self.late.set(n + 1); if n < c.at("late").i("times") { return ok(&json!({ "state": "OPEN", "headRefOid": c.at("late").at("head") }).to_string()); } }
                let mut v = if c.at("view").is_object() { c.at("view").clone() } else { json!({ "state": "OPEN", "statusCheckRollup": [], "comments": [], "reviews": [], "author": { "login": "me" } }) };
                if self.merged.get() { v["state"] = json!("MERGED"); }
                ok(&v.to_string())
            }
            // Does the branch a pull request merges into have checks: `base: { "check-runs": n, "status": n }`, or
            // `baseFail` (GitHub cannot say). None by default.
            // A commit's workflow runs: `runs: [[path, status, conclusion, url], …]`.
            ("api", p) if p.contains("/actions/runs") => ok(&c.arr("runs").iter().map(|r| r.as_array().map(|x| x.iter().map(text).collect::<Vec<_>>().join("\t")).unwrap_or_default()).collect::<Vec<_>>().join("\n")),
            // The checks the branch it merges into requires: `required: [names]`.
            ("api", p) if p.contains("/branches/") => ok(&strings(c.at("required")).join("\n")),
            ("api", p) if p.starts_with("repos/") => if c.b("baseFail") { fail("HTTP 403") } else { let k = p.rsplit('/').next().unwrap_or(""); ok(&c.at("base").i(k).to_string()) },
            // How many of the repo's last pull requests had checks: `others`.
            ("pr", "list") => ok(&c.i("others").to_string()),
            ("run", "view") => if c.b("log") { ok(c.s("log")) } else { fail("log not found") },
            _ => fail(&format!("fake gh: unknown {}", a.join(" "))),
        }
    }
}
