//! The chat at the bottom: one line that says who you talk to, and their latest message in the box under it. The same
//! shape for the Coordinator and for a task's agent: a mark, a name, a greyed line on where they stand, the message.
use super::fields::{fields, mark};
use super::talk::{coord_talk, talk, with_mine, Part};
use crate::board::keys::key_name;
use crate::board::state::{ChatAt, ChatFit, Mode, State};
use crate::board::tags::number_tag;
use crate::board::theme::Theme;
use crate::board::update::actions::has_agent;
use crate::board::update::chat::sent_to;
use crate::json::*;
use crate::shown::ink::{Ink, Inked};
use crate::shown::states::{checking, is_agent, reviewer_word, reviewing, standing, under_review};
use crate::status_words::{coordinator_stands, coordinator_status};

/// The fewest cells the status keeps when the progress stands beside it.
const CHAT_STATUS_MIN: usize = 20;
#[derive(Clone, Debug, Default)]
pub struct Who { pub mark: Inked, pub tag: String, pub name: String, pub status: String, pub progress: Vec<Inked>, pub text: String, pub parts: Vec<Part>, pub mine: bool, pub raw: bool, pub said: bool, pub turn: String, pub note: String, pub always: bool, pub ink: Ink }
fn parts_text(parts: &[Part]) -> String { parts.iter().map(|p| format!("{}{}", if p.by.is_empty() { String::new() } else { format!("{}:\n", p.by) }, p.text)).collect::<Vec<_>>().join("\n\n") }
/// Who the chat talks to now, as the chat draws it. None in find.
pub fn chat_of(s: &mut State, t: &Theme, r: Option<&Obj>) -> Option<Who> {
    if s.mode == Mode::Find { return None; }
    if let (true, Some(r)) = (s.reply, r) {
        let to_agent = has_agent(r);
        let word = if r.b("archivedAt") { "archived".to_string() } else if under_review(r) { reviewer_word(r).to_string() } else { standing(r) };
        let starts = !r.b("host") && !is_agent(r) && ["todo", "progress"].contains(&r.s("stage"));
        let status = if r.b("archivedAt") { "archived: read-only".to_string() } else if to_agent { let x = crate::shown::row_says::sentence(r).text(); if x.is_empty() { word.clone() } else { x } }
            else if starts { "no agent yet: your message starts one".into() } else if s.data.can_dispatch || r.b("host") { "no agent on it: your message goes to the Coordinator, about this task".into() } else { "no agent on it: your message is added to its description".into() };
        let said = to_agent && !r.b("archivedAt");
        let k = if said { Some(talk(r)) } else { None };
        // A dialog on its screen, or a review of its work, outranks your own words.
        let mine = if said && !k.as_ref().unwrap().dialog && !reviewing(r) { sent_to(s, r) } else { String::new() };
        let parts = k.as_ref().map(|k| with_mine(k.parts.clone(), &mine)).unwrap_or_default();
        let text = parts_text(&parts);
        let raw = k.as_ref().map(|k| k.raw).unwrap_or(false);
        // A status line that only starts the message in the box under it says nothing: where the task stands instead.
        let last = parts.last().map(|p| crate::shown::words::clean(&p.text)).unwrap_or_default();
        let echo = to_agent && status != word && s.chat_open && last.starts_with(status.trim_end_matches('…'));
        // While the board runs its check: the check's progress as the row has it.
        let progress = if to_agent && checking(r) {
            let f = fields(s, t, r, s.now);
            let cells = |c: Vec<Inked>| { let mut out = Inked::new(); for x in c.into_iter().filter(|x| !x.is_empty()) { if !out.is_empty() { out.push(" ", Ink::Plain); } out = out.add(x); } out }; // the cells it has, one space apart
            let a = cells(vec![f.bar.clone(), f.percent.clone(), f.eta.clone()]);
            let b = cells(vec![f.percent.clone(), f.eta.clone()]);
            let mut v: Vec<Inked> = vec![];
            for x in [a, b] { let x = x.trim_end(); if !x.is_empty() && !v.iter().any(|y| y.text() == x.text()) { v.push(x); } }
            v
        } else { vec![] };
        let h = r.at("handled");
        return Some(Who { mark: mark(t, r), tag: number_tag(r, &s.data.keys, &s.scope, true), name: crate::shown::words::clean(if r.b("title") { r.s("title") } else { r.s("id") }), status: if echo { word } else { status }, progress, text, parts, mine: !mine.is_empty(), raw: raw && mine.is_empty(), said, turn: format!("{}|{}|{}", r.s("said"), crate::json::text(h.at("msg")), crate::json::text(h.at("comp"))), ..Default::default() });
    }
    let far = if !s.scope.is_empty() && s.scope != "*" && s.remotes.contains_key(&s.scope) { s.scope.clone() } else { String::new() };
    if !far.is_empty() { return Some(Who { mark: Inked::of(t.mark("unknown", ""), Ink::Muted), name: format!("Coordinator on {far}"), status: format!("what you type goes to {far}"), ink: Ink::Muted, ..Default::default() }); }
    // No Coordinator (it is off, its program is not installed, or herdr is not running): the same box adds tasks.
    if !s.data.can_dispatch { return Some(Who { mark: Inked::of("+", Ink::Muted), name: "New task".into(), status: "added word for word".into(), ink: Ink::Muted, ..Default::default() }); }
    let v = s.data.coord.clone();
    let fresh = !v.unseen.is_empty() && !s.chat_open;
    let color = if fresh { Ink::Green } else { match v.state.as_str() { "working" | "starting" => Ink::Yellow, "blocked" => Ink::Red, "idle" => Ink::Green, _ => Ink::Muted } };
    let err = !v.error.is_empty();
    let word = if !err && fresh { "new reply".to_string() } else { coordinator_stands(&v.state, err) };
    let m = t.mark(if err { "error" } else if ["working", "starting"].contains(&v.state.as_str()) { "working" } else if v.state == "blocked" { "blocked" } else if v.state == "idle" { "idle" } else { "unknown" }, "");
    let note = if v.stale { format!("your default is now {}: herdr-superwork coordinator new starts a new one on it", crate::coordinator::who::describe(v.def.as_ref())) } else { String::new() };
    let (parts, raw, mine) = if err { (vec![Part { text: format!("It could not be started: {}", v.error), tone: "red".into(), ..Default::default() }], false, false) } else { let (p, raw, mine, _) = coord_talk(&v, &s.data.coord_screen); (p, raw, mine) };
    Some(Who { mark: Inked::of(m, if err { Ink::Red } else { color }), name: "Coordinator".into(), status: coordinator_status(&word, v.queue), text: parts_text(&parts), parts, raw, mine, note, said: true,
        turn: v.turn.as_ref().map(|x| x.id.clone()).unwrap_or_default(), always: err && s.err_hid != v.error, ink: if err { Ink::Red } else { color }, ..Default::default() })
}
/// The line that says who you talk to: the mark, the name in bold, and what it is doing now, greyed. The name is never
/// cut to make room: the status takes what is left.
pub fn chat_head(c: &Who, width: usize, tight: bool) -> Vec<Inked> {
    let bare = Inked::plain(" ").add(c.mark.clone()).add(Inked::plain(" "));
    let tagged = !c.tag.is_empty() && width as i64 - bare.width() as i64 - crate::text::width(&c.tag) as i64 - 1 >= CHAT_STATUS_MIN as i64;
    let lead = if tagged { bare.add(Inked::of(c.tag.clone(), Ink::Muted)).add(Inked::plain(" ")) } else { bare };
    let room = width.saturating_sub(lead.width()).max(1);
    let name = Inked::plain(c.name.clone()).bold();
    let nw = name.width();
    if nw > room && tight { return vec![lead.add(name.cut(room))]; }
    if nw > room {
        let w = name.wrap(room);
        let mut out = vec![lead.add(w[0].clone())];
        if let Some(b) = w.get(1) { out.push(Inked::plain("   ").add(if w.len() > 2 { b.cut(room.saturating_sub(1)).trim_end().add(Inked::plain("…")) } else { b.clone() })); }
        return out;
    }
    let left = room as i64 - nw as i64 - 2;
    let status = Inked::of(c.status.clone(), Ink::Muted);
    let sw = status.width();
    let progress = c.progress.iter().find(|p| left - p.width() as i64 - 2 >= sw.min(CHAT_STATUS_MIN) as i64).cloned().unwrap_or_default();
    let for_status = left - if progress.is_empty() { 0 } else { progress.width() as i64 + 2 };
    let mut out = lead.add(name);
    if !c.status.is_empty() && for_status >= 1 { out = out.add(Inked::plain("  ")).add(status.cut(for_status as usize)); }
    if !progress.is_empty() { out = out.add(Inked::plain("  ")).add(progress); }
    vec![out]
}
/// Above the text box: an empty line (a short window has none to spare), then who you talk to.
pub fn chat_lines(c: Option<&Who>, width: usize, tight: bool) -> Vec<Inked> {
    let Some(c) = c else { return vec![] };
    let mut out = if tight { vec![] } else { vec![Inked::new()] };
    out.extend(chat_head(c, width, tight));
    if !c.note.is_empty() && !tight { out.push(Inked::plain("   ").add(Inked::of(crate::text::cut(&c.note, width.saturating_sub(3).max(1)), Ink::Muted))); }
    out
}
/// Is the box open on the latest message? A start that failed says why, hidden or not.
pub fn chat_up(s: &State, c: Option<&Who>) -> bool { c.map(|c| s.chat_open || c.always).unwrap_or(false) }
/// The conversation, wrapped to `width`, on at most `max` lines: each thing said under the line that names who said it.
pub fn chat_message(s: &mut State, c: Option<&Who>, width: usize, max: usize) -> Vec<Inked> {
    if c.map(|c| c.text.is_empty()).unwrap_or(false) { s.chat_at = None; }
    let Some(c) = c.filter(|c| !c.text.is_empty()) else { return vec![] };
    if max < 1 { return vec![]; }
    let paint = |by: bool, l: Inked, p: &Part| if by { l.recolor(Ink::Muted) } else if !p.tone.is_empty() { l.recolor(crate::board::update::beat::ink_of(&p.tone)) } else if p.mine { l } else { l.recolor(Ink::Soft) };
    let (lines, latest) = super::chat_text::part_lines(&c.parts, width.max(1), &paint);
    let top = chat_window(s, c, lines.len(), max, latest);
    let rows = s.chat_fit.as_ref().map(|f| f.rows).unwrap_or(0);
    lines.into_iter().skip(top).take(rows).collect()
}
/// Which lines of a conversation show: the box opens on the newest thing said and holds only that; the first scroll up
/// opens it to the conversation. Only a screen starts at its end. Kept for as long as the same message shows.
pub fn chat_window(s: &mut State, c: &Who, total: usize, max: usize, latest: usize) -> usize {
    let key = [if s.reply { s.sel.clone() } else { String::new() }, if c.mine { "mine".into() } else { String::new() }, if c.raw { String::new() } else { c.turn.clone() }, c.text.clone()].join("\n");
    if s.chat_at.as_ref().map(|a| a.key != key).unwrap_or(true) { s.chat_at = Some(ChatAt { key, top: None }); }
    let at = s.chat_at.as_ref().unwrap().top;
    let open = c.raw || at.is_some();
    let rows = max.min(if open { total } else { total - latest }).max(1);
    let last = total.saturating_sub(rows);
    let top = at.unwrap_or(if c.raw { last } else { latest }).min(last);
    s.chat_fit = Some(ChatFit { total, rows, top, above: top, below: last - top, latest });
    top
}
/// The words on the box that say the message goes on, with the key that shows it, in `room` columns.
pub fn more_word(up: bool, room: usize) -> Inked {
    let arrow = if up { "↑" } else { "↓" };
    let key = key_name(if up { "chatScrollUp" } else { "chatScrollDown" });
    [format!("{key} more {arrow}"), format!("more {arrow}"), arrow.to_string()].into_iter().find(|w| crate::text::width(w) <= room).map(|w| Inked::of(w, Ink::Muted)).unwrap_or_default()
}
/// The task panel leaves "The agent said" to the chat while the chat shows that same message.
pub fn chat_shows(s: &mut State, r: &Obj) -> bool { s.reply && s.chat_open && !s.chat_folded && s.mode != Mode::Find && r.s("id") == s.sel && !r.b("archivedAt") && has_agent(r) && sent_to(s, r).is_empty() }
