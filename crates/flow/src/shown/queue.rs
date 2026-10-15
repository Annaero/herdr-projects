//! A task's place in the queue for a free slot (`board.agents` all taken): `Q#1` gets the next slot, `Q#2` the one
//! after. The board starts waiting tasks in this order (actions/start.rs: start_queued), so the row, the task panel,
//! `list`, `details`, herdr's sidebar and the web Board all say the same place.
use crate::json::*;

/// Waiting for a free slot: started, no slot yet.
pub fn queued(r: &Obj) -> bool { r.s("stage") == "queued" && !r.b("archivedAt") }
/// The waiting tasks of one herdr session, in the order they get a slot: the first to wait first.
pub fn order<'a>(all: impl IntoIterator<Item = &'a Obj>, socket: &str) -> Vec<&'a Obj> {
    let mut waiting: Vec<&Obj> = all.into_iter().filter(|t| t.s("stage") == "queued" && t.at("link").s("socket") == socket).collect();
    waiting.sort_by_key(|t| t.i("queuedAt"));
    waiting
}
/// Each waiting task's place, by its id: the tasks and their attempts (`tries`) together, as the slots count them.
pub fn places<'a>(all: impl IntoIterator<Item = &'a Obj>) -> Vec<(String, i64)> {
    let all: Vec<&Obj> = all.into_iter().collect();
    let mut sockets: Vec<&str> = all.iter().filter(|t| t.s("stage") == "queued").map(|t| t.at("link").s("socket")).collect();
    sockets.sort(); sockets.dedup();
    sockets.into_iter().flat_map(|s| order(all.iter().copied(), s).into_iter().enumerate().map(|(n, t)| (t.t("id"), n as i64 + 1)).collect::<Vec<_>>()).collect()
}
/// Writes each waiting task's place as `queuePlace` on the board's rows (and their attempts), and takes it off the rest.
pub fn number(rows: &mut [Obj]) {
    let all: Vec<Obj> = rows.iter().flat_map(|r| std::iter::once(r.clone()).chain(r.arr("tries").iter().filter_map(|c| c.as_object().cloned()))).collect();
    let at = places(all.iter());
    let place = |o: &mut Obj| match at.iter().find(|(id, _)| id == o.s("id")) { Some((_, n)) => o.put("queuePlace", *n), None => o.del("queuePlace") };
    for r in rows.iter_mut() {
        place(r);
        if let Some(tries) = r.get_mut("tries").and_then(|x| x.as_array_mut()) { for c in tries.iter_mut() { if let Some(o) = c.as_object_mut() { place(o); } } }
    }
}
/// `Q#2`, or nothing where the task does not wait or its place is not known.
pub fn tag(r: &Obj) -> String { if queued(r) && r.i("queuePlace") > 0 { format!("Q#{}", r.i("queuePlace")) } else { String::new() } }
/// "waiting for a free slot, Q#2": where a waiting task stands, in words.
pub fn words(r: &Obj) -> String { let q = tag(r); if q.is_empty() { WAITING.into() } else { format!("{WAITING}, {q}") } }
pub const WAITING: &str = "waiting for a free slot";
