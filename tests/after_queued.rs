//! `--after` is a condition, tab (delegate) the start: a task only to wait for others stays in to do with a dim note
//! and never starts by itself; tabbed, it is queued like a task that waits for a free slot (◌, pink, last under
//! working, "queued after PRJ-1") on the row, the panel, `list`, herdr's sidebar and the web Board.
use crate::common;
use common::board::{open, web};
use common::*;
use serde_json::{json, Value};
use sw::cli::{flags::parse, tasks::command};
use sw::json::*;
use sw::shown::ink::Ink;
use sw::shown::states::as_row;

fn run(a: &[&str]) -> Result<(Value, String), String> { command(a[0], &parse(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>())).map_err(|e| e.msg) }
fn housekeep(w: &World) { sw::housekeeping::housekeeping(&w.socket, sw::housekeeping::Force::Yes); }
fn has(text: &str, re: &str) -> bool { regex::Regex::new(re).unwrap().is_match(text) }
fn said_ink(id: &str) -> (String, Ink) { let s = sw::shown::row_says::sentence(&as_row(&row(id))); (s.text(), s.0.first().map(|p| p.c).unwrap_or(Ink::Plain)) }

#[test]
fn a_task_only_to_wait_for_others_stays_in_to_do_with_a_dim_note_and_never_starts_by_itself() {
    let w = world();
    w.script(json!({ "worker": [{ "status": "working" }] }));
    let dep = w.add("First");
    let id = w.add("Second");
    let (_, said) = run(&["add", "Third", "--repo", &w.root.display().to_string(), "--after", &dep]).unwrap();
    assert_eq!(said, "proj/3: added, it will wait for PRJ-1 to be done once it is delegated");
    run(&["after", &id, &dep]).unwrap();
    // In to do, with its ○ and a dim note of what it is to wait for.
    let r = row(&id);
    assert_eq!((r.s("stage"), r.s("state"), r.s("note")), ("todo", "idle", "after PRJ-1"));
    assert_eq!(sw::shown::states::group_of(&as_row(&r)), "to do");
    assert!(!sw::shown::queue::queued(&r));
    assert_eq!(said_ink(&id), ("after PRJ-1".into(), Ink::Todo));
    let mut b = open(&w.root, 30);
    let text = b.screen(120).join("\n");
    assert!(has(&text, r"\n ○ PRJ-2 +Second +after PRJ-1 +0s ago"), "{text}");
    assert!(run(&["list"]).unwrap().1.contains("Second  · after PRJ-1"));
    // What it is to wait for is done: it still does not start by itself, and the note goes.
    sw::store::tasks::set(&dep, json!({ "stage": "done" })).unwrap();
    housekeep(&w);
    assert_eq!(task(&id).s("stage"), "todo");
    assert!(starts(&w).is_empty());
    assert_eq!(row(&id).s("note"), "");
    // Tab on it now starts it at once: nothing to wait for any more, so nothing is asked.
    b.s.sel = id.clone(); b.load();
    b.press(&["tab"]);
    assert!(!b.text().contains("now?"), "{}", b.text());
    let t = settle(&id);
    assert!(!["after", "queued", "todo"].contains(&t.s("stage")), "{}", t.s("stage"));
    assert_eq!(starts(&w).len(), 1);
}

#[test]
fn a_tabbed_task_with_after_is_queued_like_one_that_waits_for_a_free_slot_and_starts_once_they_are_done() {
    let w = world_with(Opts { repo: true, settings: json!({ "board.agents": 1 }), ..Default::default() });
    w.script(json!({ "worker": [{ "status": "working" }, { "status": "working" }, { "status": "working" }] }));
    let (busy, slot, dep) = (w.add("At work"), w.add("Waits for a slot"), w.add("Comes first"));
    let id = w.add("Comes after");
    run(&["after", &id, &dep]).unwrap();
    delegate(&busy); sw::clock::advance(1000); delegate(&slot);
    // Tab queues it: it is not done before PRJ-3 is.
    let mut b = open(&w.root, 40);
    b.s.sel = id.clone(); b.load();
    b.press(&["tab"]);
    assert_eq!(task(&id).s("stage"), "after");
    let r = as_row(&row(&id));
    assert_eq!((r.s("state"), sw::shown::states::group_of(&r)), ("working", "working"));
    assert_eq!(sw::shown::states::status_ink(&r), Ink::Queue);
    assert_eq!(sw::shown::states::standing(&r), "queued after PRJ-3");
    assert_eq!(said_ink(&id), ("queued after PRJ-3".into(), Ink::Queue));
    assert_eq!(sw::shown::row_says::row_fields(&r, sw::clock::now()).percent.text(), "", "no place: it waits for a task, not a slot");
    // On the board: ◌, under working with the queued tasks, after those that wait for a slot.
    let lines = b.screen(120);
    let at = |t: &str| lines.iter().position(|l| l.contains(t)).unwrap_or_else(|| panic!("no {t}:\n{}", lines.join("\n")));
    assert!(lines[at("Comes after")].contains('◌') && lines[at("Comes after") + 1].contains("queued after PRJ-3"), "{}", lines.join("\n"));
    assert!(at("At work") < at("Waits for a slot") && at("Waits for a slot") < at("Comes after") && at("Comes after") < at("▾ to do"), "{}", lines.join("\n"));
    assert!(lines[at("Waits for a slot")].contains("Q#1"), "{}", lines.join("\n"));
    let panel = sw::board::view::panel::panel(&mut b.s, &b.theme, &r, 100, false, 0).iter().map(|l| l.text()).collect::<Vec<_>>().join("\n");
    assert!(panel.contains("◌ queued after PRJ-3") && !panel.contains("Now "), "{panel}");
    // herdr's sidebar and the web Board say the same.
    let e = sw::flow::sidebar_entry::entry_of(&row(&id), "", sw::clock::now());
    assert_eq!((e.place.as_str(), e.progress.as_str()), ("queued after PRJ-3", ""));
    let s = web(&w, "board", json!({}));
    let rows: Vec<Value> = s.at("list").arr("groups").iter().flat_map(|g| g.arr("rows").iter().cloned()).collect();
    let wr = rows.iter().find(|x| x.s("id") == id).unwrap();
    assert_eq!((wr.s("mark"), wr.s("color")), ("◌", "queue"));
    // The task it waits for is done and a slot frees: it starts by itself, after the one that waited for the slot.
    sw::clock::advance(1000);
    sw::store::tasks::set(&dep, json!({ "stage": "done" })).unwrap();
    housekeep(&w);
    assert_eq!(task(&id).s("stage"), "queued", "done, and no slot yet: it waits for one");
    assert_eq!((row(&slot).i("queuePlace"), row(&id).i("queuePlace")), (1, 2));
    settle(&busy);
    sw::actions::talk::stop(&busy).ok();
    housekeep(&w);
    settle(&slot);
    sw::actions::talk::stop(&slot).ok();
    housekeep(&w);
    assert!(!["after", "queued"].contains(&settle(&id).s("stage")), "{}", task(&id).s("stage"));
}
