//! A task that waits for others to be done (`--after`, docs/after.md): it waits, holding no slot, says so on its row,
//! in its panel and in `details`, and starts by itself once they are done (merged, research with its report, or
//! marked done), its agent told what came before it.
use crate::common;
use common::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use sw::cli::{flags::parse, tasks::command};
use sw::json::*;

/// A second repo beside the test's own, for chains across repos.
pub fn other_repo(w: &World) -> PathBuf {
    let root = w.base.join("other");
    std::fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("b.txt"), "one\n").unwrap();
    git(&root, &["add", "-A"]); git(&root, &["commit", "-qm", "init"]);
    root
}
/// A command as typed: what it answers, or why it was refused.
pub fn run(a: &[&str]) -> Result<(Value, String), String> { command(a[0], &parse(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>())).map_err(|e| e.msg) }
fn housekeep(w: &World) { sw::housekeeping::housekeeping(&w.socket, sw::housekeeping::Force::Yes); }

#[test]
fn a_task_waits_for_one_of_another_repo_starts_when_that_merges_and_is_told_what_landed() {
    let w = world_with(Opts { repo: true, settings: json!({ "review.when": "never" }), ..Default::default() });
    w.script(json!({ "worker": [step(1), step(2)] }));
    let other = other_repo(&w);
    let first = to_approval(&w, "Change the skill");
    let (_, said) = run(&["add", "Take it in", "--repo", &other.display().to_string(), "--after", &first, "--delegate"]).unwrap();
    let next = "other/1".to_string();
    assert_eq!(said, format!("{next}: added, it starts after {first} by itself"));
    // Waiting: no agent, no slot, plainly said on its row, in details and in the list.
    let t = task(&next);
    assert_eq!((t.s("stage"), t.s("msg")), ("after", "starts after proj/1"));
    assert_eq!(starts(&w).len(), 1, "only the first task's agent was started");
    let r = row(&next);
    assert_eq!((r.s("state"), r.s("note")), ("idle", "starts after proj/1"));
    assert_eq!(sw::shown::states::group_of(&sw::shown::states::as_row(&r)), "to do");
    let d = sw::actions::finish_line::details(&next).unwrap();
    assert_eq!((d.at("after").at("waiting"), d.at("after").at("waitsFor")), (&json!(true), &json!([first])));
    assert!(run(&["list"]).unwrap().1.contains("Take it in  · starts after proj/1"), "{}", run(&["list"]).unwrap().1);
    housekeep(&w);
    assert_eq!(task(&next).s("stage"), "after", "nothing is done yet");
    // Delegating it again says it still waits, and how to start it early or drop the wait.
    let e = sw::actions::start::delegate(&next, vec![]).unwrap_err().msg;
    assert!(e.contains("other/1 still waits: it starts after proj/1 by itself.") && e.contains("delegate other/1 --now") && e.contains("after other/1 --clear"), "{e}");
    // The first merges: the waiting one starts by itself, and its agent is told what landed.
    sw::actions::finish_line::approve(&first, None, false).unwrap();
    let a = settle(&first);
    assert_eq!(a.s("stage"), "done", "{}", a.at("failure"));
    let commit = git(&w.root, &["rev-parse", "HEAD"]);
    assert_eq!(a.s("mergeCommit"), commit);
    housekeep(&w);
    let b = settle(&next);
    assert!(!["after", "queued"].contains(&b.s("stage")), "{}", b.s("stage"));
    let told = prompts(&w, b.at("link").s("pane")).join("\n");
    assert!(told.contains("This task waited for the tasks below to be done, and they are."), "{told}");
    assert!(told.contains(&format!("- proj/1 \"Change the skill\" (repo proj): done, its work merged, merge commit {commit}.")), "{told}");
    assert!(told.contains("Its closing note:\n    Did v1."), "{told}");
    let d = sw::actions::finish_line::details(&next).unwrap();
    assert_eq!(d.at("after").at("handedOver").get(0).map(|x| x.s("commit").to_string()), Some(commit));
}

#[test]
fn a_research_task_with_its_report_and_a_task_marked_done_without_a_merge_both_count_as_done() {
    let w = world();
    w.script(json!({ "worker": [step(1)] }));
    let research = sw::actions::filing::add(&w.root, "Look into the API", sw::actions::filing::AddOpts { research: Some(true), ..Default::default() }).unwrap().t("id");
    let plain = w.add("Talk to the vendor");
    let id = w.add("Use what was found");
    let (_, said) = run(&["delegate", &id, "--after", &format!("{research},{plain}")]).unwrap();
    assert_eq!(said, format!("{id}: delegated, starts after {research}, {plain} by itself"));
    // The research task is done with its report; the other is waited for still.
    std::fs::write(sw::store::files::dir_of(&research).join("closing.md"), "The API has a rate limit of 10/s.\n").unwrap();
    sw::store::tasks::set(&research, json!({ "stage": "done", "report": { "file": "index.html", "link": "https://box/report/index.html" } })).unwrap();
    housekeep(&w);
    assert_eq!((task(&id).s("stage"), task(&id).s("msg")), ("after", "starts after proj/2"));
    let shown = run(&["after", &id]).unwrap().1;
    assert_eq!(shown, format!("{id}: waits for {research} (done), {plain}"));
    // Marked done, nothing merged: that is done too.
    sw::actions::filing::report(&plain, sw::actions::filing::Report { state: "done".into(), msg: "Agreed on v2".into(), ..Default::default() }).unwrap();
    housekeep(&w);
    let t = settle(&id);
    assert!(!["after", "queued"].contains(&t.s("stage")), "{}", t.s("stage"));
    let told = prompts(&w, t.at("link").s("pane")).join("\n");
    assert!(told.contains("- proj/1 \"Look into the API\" (repo proj): done, research only, its report: https://box/report/index.html. Its closing note:\n    The API has a rate limit of 10/s."), "{told}");
    assert!(told.contains("- proj/2 \"Talk to the vendor\" (repo proj): done.") && !told.contains("its work merged"), "{told}");
}

#[test]
fn a_task_it_waits_for_that_fails_is_stopped_archived_or_removed_makes_it_wait_for_you_with_the_reason() {
    let w = world();
    let dep = w.add("First");
    let id = w.add("Second");
    run(&["delegate", &id, "--after", &dep]).unwrap();
    let blocked = |why: &str| {
        housekeep(&w);
        let t = task(&id);
        assert_eq!((t.s("stage"), t.s("msg"), t.s("afterBlocked")), ("after", why, why));
        let r = row(&id);
        assert_eq!((r.s("state"), r.s("kind")), ("blocked", "question"));
        assert_eq!(sw::shown::states::group_of(&sw::shown::states::as_row(&r)), "needs you");
        assert_eq!(sw::notify::event_of(&t), "needs you");
        assert!(starts(&w).is_empty());
    };
    sw::store::tasks::set(&dep, json!({ "stage": "failed" })).unwrap();
    blocked("proj/1 failed");
    let e = sw::actions::start::delegate(&id, vec![]).unwrap_err().msg;
    assert!(e.starts_with("proj/2 waits for you: proj/1 failed.") && e.contains("--now"), "{e}");
    // Set going again, the reason goes and it waits as before.
    sw::store::tasks::set(&dep, json!({ "stage": "working" })).unwrap();
    housekeep(&w);
    assert_eq!((task(&id).s("msg"), task(&id).at("afterBlocked").clone()), ("starts after proj/1".into(), Value::Null));
    assert_eq!(row(&id).s("state"), "idle");
    sw::store::tasks::set(&dep, json!({ "stage": "stopped" })).unwrap();
    blocked("proj/1 was stopped");
    sw::store::tasks::set(&dep, json!({ "stage": "todo", "archivedAt": 1 })).unwrap();
    blocked("proj/1 was archived without being done");
    // Archived once it was done, it counts as done.
    sw::store::tasks::set(&dep, json!({ "stage": "done" })).unwrap();
    housekeep(&w);
    assert_eq!(task(&id).s("stage"), "starting", "it went on to a slot: {}", task(&id).s("msg"));
    // Removed: a task that waits for it now waits for you.
    let other = w.add("Third");
    run(&["after", &other, &dep]).unwrap();
    sw::actions::archive::clear(&dep).unwrap();
    let e = run(&["delegate", &other]).unwrap();
    assert_eq!(e.1, format!("{other}: delegated, waits for you: proj/1 was removed"));
}

#[test]
fn a_wait_in_a_circle_an_unknown_task_and_one_of_another_machine_are_refused_and_change_nothing() {
    let w = world_with(Opts { repo: true, settings: json!({ "board.machines": "otherbox" }), ..Default::default() });
    let a = w.add("A");
    let b = w.add("B");
    let c = w.add("C");
    run(&["after", &b, &a]).unwrap();
    run(&["after", &c, &b]).unwrap();
    let e = run(&["after", &a, &c]).unwrap_err();
    assert_eq!(e, "proj/1 cannot wait for that: tasks would wait on each other (proj/1 → proj/3 → proj/2 → proj/1). Nothing was changed.");
    let e = run(&["delegate", &a, "--after", &a]).unwrap_err();
    assert!(e.contains("(proj/1 → proj/1)"), "{e}");
    assert!(!task(&a).has("after") && task(&a).s("stage") == "todo");
    let e = run(&["after", &a, "proj/99"]).unwrap_err();
    assert_eq!(e, "No task proj/99: it cannot be waited for. Nothing was changed.");
    let e = run(&["after", &a, "otherbox#4"]).unwrap_err();
    assert!(e.contains("otherbox#4 is a task of otherbox, another machine: a task can only wait for tasks on its own machine"), "{e}");
    // A refused --after on add adds nothing.
    let n = sw::store::tasks::all().len();
    assert!(run(&["add", "D", "--after", "proj/99", "--delegate"]).is_err());
    assert_eq!(sw::store::tasks::all().len(), n);
    // An id said twice, or by its number, is one task.
    run(&["after", &c, &format!("{a},{a} #2")]).unwrap();
    assert_eq!(task(&c).at("after"), &json!([a, b]));
}
