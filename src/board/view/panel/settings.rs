//! The settings in the task panel: every setting this task runs with, a few to a row, each one that is not the
//! built-in value marked with the place it came from; and its agent's session. Every setting by its name, each one
//! changeable, is the settings page (page.rs). Read from the task's `snap`: this machine's lookup, or what the task's
//! machine sent.
use super::kit::Kit;
use super::Ctx;
use crate::agents::start::has_fast;
use crate::board::keys::key_name;
use crate::json::*;
use crate::shown::ink::{Ink, Inked};
use crate::shown::words::tokens;
use crate::store::settings::values::{agent_of, say};

/// The rows that stay longest where there is no room for all of them, after the ones with a value of their own.
const MAIN: [&str; 6] = ["Agent", "Reviewer", "Review when", "Send back", "Merge", "Research"];
fn came_from(x: &Value) -> String {
    if !x.is_object() || x.s("place") == "builtin" || x.s("from") == "built in" { return String::new(); }
    match x.s("place") { "task" => "this task".into(), "repo" => "you, for this repo".into(), "you" => "you".into(), "file" => "this repo".into(), _ => x.t("from") }
}
/// One row: a label and what it says, each item with the settings it says.
#[derive(Clone, Debug, Default)]
pub struct SRow { pub label: String, pub items: Vec<(String, Vec<String>)>, pub fact: bool, pub mark: bool, pub rank: i32 }
pub struct Drawn { pub rows: Vec<SRow>, pub part: usize, pub cut: bool, pub session: Vec<SRow> }
pub fn settings(k: &mut Kit, c: &Ctx, r: &Obj) -> Drawn {
    let snap = r.at("snap");
    let all: std::collections::HashMap<String, Value> = snap.arr("settings").iter().map(|x| (x.t("name"), x.clone())).collect();
    let val = |n: &str| all.get(n).map(|x| x.at("value").clone()).unwrap_or(Value::Null);
    let sval = |n: &str| text(&val(n));
    let from = |names: &[&str]| { let mut v: Vec<String> = vec![]; for n in names { let f = came_from(all.get(*n).unwrap_or(&Value::Null)); if !f.is_empty() && !v.contains(&f) { v.push(f); } } v.join(", ") };
    let applies = |n: &str| all.get(n).map(|x| !x.s("note").starts_with("does not apply")).unwrap_or(false);
    let it = |t: String, names: &[&str]| if t.is_empty() { None } else { Some((t, names.iter().map(|x| x.to_string()).collect::<Vec<_>>())) };
    let mut rows: Vec<SRow> = vec![];
    let mut row = |label: &str, items: Vec<Option<(String, Vec<String>)>>, fact: bool, mark: bool| { let list: Vec<_> = items.into_iter().flatten().collect(); if !list.is_empty() { rows.push(SRow { label: label.into(), items: list, fact, mark, rank: 0 }); } };
    let folder = snap.t("folder");
    let tree = snap.t("tree");
    let here_root = c.repo_root.clone();
    row("Project", vec![it(folder.clone(), &[])], true, !r.b("host") && !here_root.is_empty() && snap.s("root") != here_root);
    if r.b("host") { row("Machine", vec![it(r.t("host"), &[])], true, true); }
    // Where the worktree is and its branch: on the whole task only, beside the list their lines are the settings'.
    row("Worktree", vec![it(if !tree.is_empty() { format!("on · {tree}") } else if !r.b("startedOnce") && snap.b("canWorktree") { "on".into() } else { "off".into() }, &[])], true, false);
    if snap.b("branch") { row("Branch", vec![it(format!("{}{}", snap.s("branch"), if !tree.is_empty() && r.b("from") { format!("  (from {})", if r.s("from") == "HEAD" { "your checkout" } else { r.s("from") }) } else { String::new() }), &[])], true, false); }
    // Each role reads the same way: program and version with its model, effort; fast, "asks first" and words of
    // your own only where they are so, or where somebody said otherwise.
    let role = |name: &str, kind: &str, version: &str| -> Vec<Option<(String, Vec<String>)>> {
        let on = if name == "worker" { r.t("on") } else { r.t("reviewerOn") };
        let who = agent_of(&if on.is_empty() { sval(&format!("{name}.agent")) } else { on });
        let k = if kind.is_empty() { who.kind.clone() } else { kind.to_string() };
        let model = if k == who.kind { who.model.clone() } else { String::new() };
        let effort = if sval(&format!("{name}.effort")) == "default" { String::new() } else { sval(&format!("{name}.effort")) };
        let fastn = format!("{name}.fast");
        let fast = if val(&fastn) == json!(true) { if all.get(&fastn).map(|x| x.b("note")).unwrap_or(false) || !has_fast(&k) { format!("no fast mode in {k}") } else { "fast".into() } } else if !from(&[&fastn]).is_empty() && has_fast(&k) { "fast mode off".into() } else { String::new() };
        let accn = format!("{name}.access");
        let access = if sval(&accn) == "ask" { "asks before acting".to_string() } else if !from(&[&accn]).is_empty() { "acts without asking".into() } else { String::new() };
        let instr = format!("{name}.instructions");
        let own_words = if !val(&instr).is_null() && sval(&instr) != "none" { "words of your own".to_string() } else { String::new() };
        let an = format!("{name}.agent"); let en = format!("{name}.effort");
        vec![it(format!("{k}{} · {}", if version.is_empty() { String::new() } else { format!(" {version}") }, if model.is_empty() { "default model".into() } else { model }), &[&an]), it(format!("{} effort", if effort.is_empty() { "default".into() } else { effort }), &[&en]), it(fast, &[&fastn]), it(access, &[&accn]), it(own_words, &[&instr])]
    };
    // Under each of the two: who takes over when it cannot go on.
    let backed = ["worker.fallback", "reviewer.fallback"].iter().any(|n| val(n).is_array());
    let takes = |name: &str| -> Option<Vec<Option<(String, Vec<String>)>>> { if !backed { return None; } let v = val(name); let who = if v.is_array() { strings(&v).join(", then ") } else { "nobody".into() }; Some(vec![it(format!("{who} · when the {} cannot go on", if name == "worker.fallback" { "agent" } else { "reviewer" }), &[name])]) };
    row("Agent", role("worker", r.s("agent"), r.s("agentVersion")), false, false);
    if let Some(t) = takes("worker.fallback") { row("Takes over", t, false, false); }
    // A plan first: who says yes to it, and who writes it when that is not the working agent.
    let plan_by = sval("plan.approve");
    let planner = agent_of(&sval("plan.agent"));
    let writer = if planner.kind.is_empty() { "the agent".to_string() } else { format!("{}{}", planner.kind, if planner.model.is_empty() { String::new() } else { format!(" · {}", planner.model) }) };
    if plan_by.is_empty() || plan_by == "none" { row("Plan first", vec![it("off".into(), &["plan.approve"]), if from(&["plan.agent"]).is_empty() { None } else { it(format!("would be written by {writer}"), &["plan.agent"]) }], false, false); }
    else { row("Plan first", vec![it(if plan_by == "reviewer" { "the reviewer approves it".into() } else { "you approve it".into() }, &["plan.approve"]), it(format!("written by {writer}"), &["plan.agent"])], false, false); }
    // Done several times at once: how many and by whom, and who picks.
    let many = r.arr("attempts").len() > 1 || crate::store::attempts::attempt_count(&val("attempts.by")) > 1;
    if many { row("Attempts", vec![it(if r.arr("attempts").len() > 1 { r.arr("attempts").iter().map(|a| format!("{} {}", a.s("letter"), a.s("agent"))).collect::<Vec<_>>().join(", ") } else { say(&val("attempts.by")) }, &["attempts.by"]), it(if r.at("picked").is_object() { format!("{} was chosen", r.at("picked").s("letter")) } else if sval("attempts.pick") == "reviewer" { "the reviewer picks".into() } else { "you pick".into() }, &["attempts.pick"])], false, false); }
    let no_review = sval("review.when") == "never";
    let reviewer = if no_review { let mut v = vec![it("off".into(), &["review.when"])]; v.extend(role("reviewer", "", "").into_iter().filter(|i| i.as_ref().map(|i| !from(&i.1.iter().map(|s| s.as_str()).collect::<Vec<_>>()).is_empty()).unwrap_or(false))); v } else { role("reviewer", "", "") };
    row("Reviewer", reviewer, false, false);
    if let Some(t) = takes("reviewer.fallback") { row("Takes over", t, false, false); }
    row("Review when", vec![it(if no_review { "never".into() } else if sval("review.when") == "always" { "always".into() } else { "in a repo".into() }, &["review.when"]), if !no_review || !from(&["review.evidence"]).is_empty() { it(if val("review.evidence") == json!(false) { "no evidence".into() } else { "with evidence".into() }, &["review.evidence"]) } else { None }], false, false);
    let bar = sval("review.mustFix");
    let rounds = val("review.rounds");
    row("Send back", vec![it(match bar.as_str() { "trivial" => "any finding".into(), "critical" => "critical only".into(), b => format!("{b} or worse") }, &["review.mustFix"]), it(if rounds == json!(0) { "by hand".into() } else { format!("{} round{} max", if rounds.is_null() { "?".into() } else { text(&rounds) }, if rounds == json!(1) { "" } else { "s" }) }, &["review.rounds"])], false, false);
    let check = if val("check.command").is_null() { "none".to_string() } else { sval("check.command") };
    if applies("check.command") { row("Check", vec![it(if check == "none" { "no command".into() } else { check }, &["check.command"]), it(format!("{} at most", sval("check.timeout")), &["check.timeout"])], false, false); }
    let research = crate::research::is_research(r);
    if research { row("Research", vec![it("only · no change to the repo".into(), &["research.only"])], false, false); }
    else { row("Merge", vec![it(if sval("merge.by") == "itself" { "by itself, once it passes".into() } else { "after your yes".into() }, &["merge.by"]), if applies("merge.method") { it(sval("merge.method"), &["merge.method"]) } else { None }, if applies("merge.pr") { it(if val("merge.pr") == json!(false) { "no pull request".into() } else { "opens a pull request".into() }, &["merge.pr"]) } else { None }, if applies("merge.checks") && applies("merge.pr") && val("merge.pr") != json!(false) { it(if sval("merge.checks") == "none" { "GitHub's checks ignored".into() } else { "waits for GitHub's checks".into() }, &["merge.checks"]) } else { None }], false, false); }
    let time = if val("limit.time").is_null() { "none".to_string() } else { sval("limit.time") };
    let most = if val("limit.tokens").is_null() { "none".to_string() } else { sval("limit.tokens") };
    let limited = time != "none" || most != "none" || !from(&["limit.time", "limit.tokens"]).is_empty();
    if limited { row("Limits", vec![it(if time != "none" { format!("{time} a run") } else { "no time limit".into() }, &["limit.time"]), it(if most == "none" { "no token limit".into() } else if all.get("limit.tokens").map(|x| x.b("note")).unwrap_or(false) { format!("{most} tokens, not counted") } else { format!("{most} tokens") }, &["limit.tokens"])], false, false); }
    let said = |n: &str| { let v = val(n); if v.is_null() || text(&v) == "none" { String::new() } else { crate::re!(r"\s*\n\s*").replace_all(&say(&v), " / ").into_owned() } };
    if applies("workspace.from") { row("Workspace", vec![it(format!("from {}", if sval("workspace.from") == "here" { "your checkout" } else { "main" }), &["workspace.from"]), it(if said("workspace.setup").is_empty() { String::new() } else { format!("set up with {}", said("workspace.setup")) }, &["workspace.setup"]), it(if said("workspace.include").is_empty() { String::new() } else { format!("copies {}", said("workspace.include")) }, &["workspace.include"]), it(if said("workspace.teardown").is_empty() { String::new() } else { format!("torn down with {}", said("workspace.teardown")) }, &["workspace.teardown"]), it(if val("workspace.cleanup") == json!(false) { "kept when done".into() } else { "removed when done".into() }, &["workspace.cleanup"])], false, false); }
    row("Also", vec![if !many { it("one attempt".into(), &["attempts.by", "attempts.pick"]) } else { None }, if !research { it("not research only".into(), &["research.only"]) } else { None }, if !limited { it("no limits".into(), &["limit.time", "limit.tokens"]) } else { None }, if !backed { it("no fallback".into(), &["worker.fallback", "reviewer.fallback"]) } else { None }], false, false);
    let mut notes: Vec<String> = r.at("fallbacks").as_object().map(|o| o.values().filter(|v| truthy(v)).map(text).collect()).unwrap_or_default();
    notes.extend(snap.arr("problems").iter().map(|x| format!("Not counted: {}", text(x))));
    if !notes.is_empty() { row("Note", vec![it(notes.join("\n"), &[])], true, true); }
    // Where room is short the rows go from the last of this order: a value somebody chose, then who works, who
    // reviews, the review and the merge, then the rest.
    for x in rows.iter_mut() { x.rank = if x.fact { 3 } else if x.items.iter().any(|i| !from(&i.1.iter().map(|s| s.as_str()).collect::<Vec<_>>()).is_empty()) { 0 } else if MAIN.contains(&x.label.as_str()) { 1 } else { 2 }; }
    // The agent's session, full screen only.
    let mut session = vec![];
    let fixed = |session: &mut Vec<SRow>, label: &str, t: String| session.push(SRow { label: label.into(), items: vec![(t, vec![])], fact: true, mark: false, rank: 3 });
    let usage = if c.agent { r.at("usage").clone() } else { Value::Null };
    if usage.is_object() && usage.b("context") && usage.b("window") { fixed(&mut session, "Context", format!("{}% full of {}", ((usage.f("context") / usage.f("window")) * 100.0).round().min(100.0), tokens(usage.f("window")))); }
    if usage.is_object() { fixed(&mut session, "Tokens", format!("{} in · {} out", tokens(usage.f("in")), tokens(usage.f("out")))); }
    if r.at("spent").b("total") { fixed(&mut session, "Used so far", format!("{} tokens, counted for this task", crate::store::settings::values::tokens_say(r.at("spent").f("total")))); }
    fixed(&mut session, "Task id", if r.b("rid") { r.t("rid") } else { r.t("id") });
    let l = r.at("link");
    if l.b("pane") { fixed(&mut session, "herdr", format!("{}space {} · pane {}{}", if l.b("socket") && !r.b("host") { format!("session {} · ", crate::herdr::cli::session_name(l.s("socket"))) } else { String::new() }, if l.b("workspace") { l.s("workspace") } else { "?" }, l.s("pane"), if l.b("agent") { format!(" · {}", l.s("agent")) } else { String::new() })); }
    // Not read yet (the board's first frame is drawn from the files alone): it says so, never a row of blanks.
    let known = snap.at("settings").is_array();
    let shown: Vec<SRow> = if !known { vec![] } else if c.full { rows.clone() } else { rows.iter().filter(|x| !x.fact || x.mark).cloned().collect() };
    let lines = if known { draw_rows(k, &shown, 0, &from_owned(&all)) } else { k.wrap("Reading its settings…").into_iter().map(|l| l.recolor(Ink::Muted)).collect() };
    let mut part_lines = vec![k.head("Settings", None)];
    part_lines.extend(lines);
    if c.full && !r.b("archivedAt") { let change = if c.web { "All settings, below, has every one of them, and changes them".to_string() } else { format!("{} changes them: every setting, and the place each one comes from", key_name("settings")) }; part_lines.extend(k.wrap(&change).into_iter().map(|l| l.recolor(Ink::Muted))); }
    let part = k.part(part_lines);
    k.parts[part].name = "settings";
    if c.full && !session.is_empty() { let mut sl = vec![k.head("Session", None)]; sl.extend(draw_rows(k, &session, 0, &from_owned(&all))); k.part(sl); }
    Drawn { rows: shown, part, cut: !c.full && !tree.is_empty(), session }
}
pub fn from_owned(all: &std::collections::HashMap<String, Value>) -> std::collections::HashMap<String, String> { all.iter().map(|(k, v)| (k.clone(), came_from(v))).collect() }
/// A table of labels and what they say. A value somebody chose is in the text colour, with the place it came from
/// after it in words; one that is the built-in value is quieter. `more`: how many settings have no room.
pub fn draw_rows(k: &Kit, list: &[SRow], more: usize, from: &std::collections::HashMap<String, String>) -> Vec<Inked> {
    let places = |names: &[String]| { let mut v: Vec<String> = vec![]; for n in names { if let Some(f) = from.get(n).filter(|f| !f.is_empty()) { if !v.contains(f) { v.push(f.clone()); } } } v.join(", ") };
    let mut out = vec![];
    for x in list {
        let items: Vec<Inked> = x.items.iter().map(|(t, names)| {
            let where_ = if x.fact { String::new() } else { places(names) };
            let on = if x.fact { x.mark } else { !where_.is_empty() };
            let body = Inked::join(t.split('\n').enumerate().map(|(n, l)| { let p = if on { Inked::plain(l) } else { Inked::of(l, Ink::Soft) }; if n > 0 { Inked::plain("\n").add(p) } else { p } }));
            if where_.is_empty() { body } else { body.add(Inked::plain(" ")).add(Inked::of(format!("({where_})"), Ink::Accent)) }
        }).collect();
        out.extend(k.fact(&x.label, k.flow(items, None, " · ")));
    }
    if more > 0 { out.extend(k.wrap(&format!("{more} more setting{} · {} shows {}", if more == 1 { "" } else { "s" }, key_name("settings"), if more == 1 { "it" } else { "them" })).into_iter().map(|l| l.recolor(Ink::Muted))); }
    out
}
