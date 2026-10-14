//! The Boards section of the web UI's sidebar: one entry per machine with a board, named as the web UI names it, and one
//! for all machines, each with a dot in the board's status colours and a short line of how it stands; a machine that
//! cannot be reached says so; picking an entry shows that machine's board, and the board and the section stay in step.
use crate::common;
use crate::far;
use common::*;
use far::Far;
use serde_json::{json, Value};
use sw::json::*;
use sw::webui::pcs::Pc;

fn call(what: &str, args: Value, pcs: Option<Vec<Pc>>) -> Result<Value, String> { let mut a = args; if a.get("role").is_none() { a["role"] = json!("watch"); } sw::webui::web::call("t", what, a, "", pcs) }
fn boards(pcs: Option<Vec<Pc>>) -> Value { call("boards", json!({}), pcs).unwrap() }
fn pc(id: &str, name: &str, to: &str, local: bool) -> Pc { Pc { id: id.into(), name: name.into(), to: to.into(), local, connected: true, state: "connected".into(), ..Default::default() } }
fn pcs() -> Option<Vec<Pc>> { Some(vec![pc("local", "Mac", "", true), pc("pc-9", "vm-box", "vm-a", false)]) }
/// Each entry as (whose board, its name, its dot, its line).
fn entries(b: &Value) -> Vec<(String, String, String, String)> { b.arr("boards").iter().map(|e| (e.t("scope"), e.t("name"), e.t("dot"), e.t("line"))).collect() }
fn e(scope: &str, name: &str, dot: &str, line: &str) -> (String, String, String, String) { (scope.into(), name.into(), dot.into(), line.into()) }
fn working(id: &str) { sw::actions::filing::report(id, sw::actions::filing::Report { state: "working".into(), msg: "On it".into(), ..Default::default() }).unwrap(); }
fn web_world() -> (World, Far) {
    let w = world_with(Opts { repo: true, settings: json!({ "board.machines": "vm-a" }), ..Default::default() });
    let far = Far::new(&w.base);
    std::fs::write(sw::store::files::data_dir().join("view.json"), json!({ "cwd": w.root_str() }).to_string()).unwrap();
    (w, far)
}

#[test]
fn each_machine_has_its_board_in_the_section_named_as_the_web_ui_names_it_with_how_it_stands_and_all_machines_add_up() {
    let (w, far) = web_world();
    w.add("Later");
    working(&w.add("Write notes"));
    let mut busy = far::theirs(1); busy["state"] = json!("working"); busy["stage"] = json!("working");
    let mut stuck = far::theirs(3); stuck["state"] = json!("blocked");
    far.tasks("vm-a", "0.2.0", json!([busy, far::theirs(2), stuck]));
    // asked before the other machine answered: it is being asked, and there is nothing to add up yet
    let first = boards(pcs());
    assert_eq!(first.arr("boards")[0].s("name"), "Mac", "this machine as the web UI names it");
    far::answered("t", 1);
    let b = boards(None);
    assert_eq!(entries(&b), vec![
        e("", "Mac", "yellow", "1 working · 1 to do"),
        e("vm-a", "vm-box", "red", "1 needs you · 1 working · 1 to do"),
        e("*", "All machines", "red", "1 needs you · 2 working · 2 to do"),
    ]);
    assert_eq!(b.s("scope"), "", "the board shows this machine");
}

#[test]
fn a_board_with_nothing_going_on_is_all_quiet_its_archive_left_out_and_all_machines_is_there_also_with_no_other_machine() {
    let w = world();
    std::fs::write(sw::store::files::data_dir().join("view.json"), json!({ "cwd": w.root_str() }).to_string()).unwrap();
    sw::actions::archive::archive(&w.add("Old")).unwrap();
    // a web UI that names this machine only by its id, or none: the board's own words for it
    let b = boards(Some(vec![pc("local", "local", "", true)]));
    assert_eq!(b.at("boards"), &json!([
        { "scope": "", "name": "This machine", "dot": "quiet", "line": "all quiet", "title": "This machine's board: all quiet" },
        { "scope": "*", "name": "All machines", "dot": "quiet", "line": "all quiet", "title": "Every machine's board: all quiet" },
    ]));
    // picked, it stays picked when the board learns again that there is no other machine
    assert_eq!(call("scope", json!({ "to": "*" }), None).unwrap().at("flags").s("scope"), "*");
    { let c = sw::webui::web::client("t"); let mut g = c.lock().unwrap(); let fx = sw::board::update::update(&mut g.s, sw::board::update::Event::Machines(vec![])); sw::webui::web::effects(&mut g, fx, false); }
    assert_eq!(boards(None).s("scope"), "*");
}

#[test]
fn a_machine_that_cannot_be_reached_says_so_on_its_entry_and_a_machine_without_a_pc_keeps_the_boards_name() {
    let (_w, far) = web_world();
    far.ends("vm-a", "list", "", "ssh: connect to host vm-a port 22: Connection refused\n", 255);
    boards(Some(vec![pc("local", "Mac", "", true)]));
    far::answered("t", 1);
    let b = boards(None);
    let them = &b.arr("boards")[1];
    assert_eq!((them.s("name"), them.s("line"), them.at("off"), them.s("dot")), ("vm-a", "not reachable", &json!(true), ""));
    assert!(them.s("title").starts_with("vm-a is not reachable: "), "{}", them.s("title"));
    assert_eq!(b.arr("boards")[2].s("line"), "all quiet · 1 not reachable");
}

#[test]
fn picking_an_entry_shows_that_machines_board_as_other_machines_does_and_the_two_stay_in_step() {
    let (_w, far) = web_world();
    far.tasks("vm-a", "0.2.0", json!([far::theirs(1)]));
    boards(pcs());
    far::answered("t", 1);
    // a device that only watches may pick: it only changes what this browser looks at
    let s = call("scope", json!({ "to": "vm-a" }), None).unwrap();
    assert_eq!(s.at("flags").s("scope"), "vm-a");
    assert_eq!(s.at("list").at("head").s("only"), "vm-a");
    assert!(s.at("msg").s("text").contains("Only vm-a"), "said as the board says it: {}", s.at("msg"));
    assert_eq!(boards(None).s("scope"), "vm-a", "the section highlights what the board shows");
    // the other way round: the board's own Other machines moves the section's highlight with it
    call("press", json!({ "id": "scope" }), None).unwrap();
    assert_eq!(boards(None).s("scope"), "");
    call("scope", json!({ "to": "*" }), None).unwrap();
    assert_eq!(boards(None).s("scope"), "*");
    assert!(call("scope", json!({ "to": "nowhere" }), None).unwrap_err().contains("nowhere"));
    assert_eq!(boards(None).s("scope"), "*", "nothing changed");
}
