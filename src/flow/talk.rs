//! A task's conversation as the board shows it: its agent's, or its reviewer's while the task is under review. Only
//! the words (agents/talk.rs): what was sent to the program and what it said. The same reading for this machine's
//! board and for the one another machine asks for (remote/).
use super::send::prompt_tail;
use crate::agents::talk::{can_read_talk, talk_of};
use crate::json::*;
use crate::store::repos::cwd_of;
use std::path::Path;

/// Whose conversation shows: "reviewer" from the moment a review starts until it ends, else "agent".
pub fn talker(t: &Obj) -> &'static str { if ["reviewing", "reviewneeds"].contains(&t.s("stage")) { "reviewer" } else { "agent" } }
/// { who, kind, readable, list }. `list`: [{ who: "you" | "them", text, at }], oldest first. Each text is cut to
/// `most` characters (what goes to another machine is kept small).
pub fn task_talk(t: &Obj, keep: usize, most: usize) -> Value {
    let who = talker(t);
    let kind = if who == "reviewer" { t.at("link").at("reviewer").t("kind") } else { t.t("agent") };
    if who == "reviewer" && kind.is_empty() { return json!({ "who": who, "kind": kind, "readable": true, "list": [] }); }
    if !can_read_talk(&kind) { return json!({ "who": who, "kind": kind, "readable": false, "list": [] }); }
    let cwd = cwd_of(t);
    let said = if who == "reviewer" { talk_of(&kind, None, t.s("reviewSession"), &cwd, keep) } else { talk_of(&kind, t.so("transcript").map(Path::new), t.s("session"), &cwd, keep) }.unwrap_or_default();
    // What the board adds to every prompt it sends (the closing-note rule) is not part of what was said.
    let tail = if who == "agent" && said.iter().any(|m| m.you) { prompt_tail(t) } else { String::new() };
    let list: Vec<Value> = said.iter().map(|m| {
        let mut text = if m.you && !tail.is_empty() && m.text.ends_with(&tail) { m.text[..m.text.len() - tail.len()].trim().to_string() } else { m.text.clone() };
        if text.chars().count() > most { text = format!("{}…", text.chars().take(most).collect::<String>()); }
        json!({ "who": if m.you { "you" } else { "them" }, "at": m.at, "text": text })
    }).collect();
    json!({ "who": who, "kind": kind, "readable": true, "list": list })
}
