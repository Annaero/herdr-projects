//! Other machines from the board's side: whose board you see (this machine, every machine, or one), and what each
//! machine answered when it was asked for its tasks. One that did not answer is never an empty one: why is kept and
//! said where its tasks would be.
use super::list::relist;
use super::Effect;
use crate::board::data::Remote;
use crate::board::state::State;
use crate::json::*;
use crate::remote::why::{not_list, unknown};
use crate::remote::Machine;
use crate::shown::ink::Ink;

/// The machines herdr knows (or the `board.machines` setting names): new ones are added, gone ones dropped.
pub fn machines(s: &mut State, list: Vec<Machine>, fx: &mut Vec<Effect>) {
    if s.all() && list.is_empty() && s.remotes.is_empty() {
        s.scope.clear(); fx.push(Effect::Save);
        let off = crate::store::settings::lookup::setting("board.machines", None) == json!("none");
        s.flash(if off { "Other machines are off (unset board.machines turns them on).".to_string() } else { "No other machines. Add one with: herdr machine add <name> <ssh target>  (or name them in the board.machines setting).".into() }, Ink::Yellow);
    }
    for m in &list { s.remotes.entry(m.label.clone()).or_insert_with(|| Remote { machine: m.clone(), ..Default::default() }).machine = m.clone(); }
    s.remotes.retain(|k, _| list.iter().any(|m| m.label == *k));
    relist(s);
    fx.push(Effect::Poll(true));
}
pub fn answered(s: &mut State, label: &str, answer: Result<Value, Value>) {
    let now = s.now;
    let Some(m) = s.remotes.get_mut(label) else { return };
    m.busy = false;
    match answer {
        Ok(j) if j.at("tasks").is_array() => {
            m.ok = true; m.why = None; m.version = j.t("version");
            let mc = m.machine.clone();
            m.items = j.arr("tasks").iter().filter_map(|x| x.as_object()).map(|x| {
                let mut r = crate::shown::states::as_row(x);
                r.put("id", format!("{label}:{}", x.s("id"))); r.put("rid", x.s("id")); r.put("host", label);
                r.put("machineVersion", mc.label.clone()); std::sync::Arc::new(r)
            }).collect();
            m.autos = j.arr("automations").iter().filter_map(|x| x.as_object()).filter(|x| x.b("id") && x.b("name")).map(|x| {
                let mut a = x.clone();
                a.put("row", format!("{label}:auto:{}", x.s("id"))); a.put("host", label);
                let oldest_first: Vec<Value> = a.at("shown").arr("firings").iter().rev().cloned().collect();
                a.put("rowNow", serde_json::to_value(crate::automations::show::row_of(x, now, Some(&oldest_first))).unwrap_or(Value::Null));
                a
            }).collect();
        }
        Ok(j) => { m.ok = false; m.fail_at = now; m.items.clear(); m.autos.clear(); m.why = Some(not_list(&j, &m.machine.label, &m.machine.target)); }
        Err(why) => { m.ok = false; m.fail_at = now; m.items.clear(); m.autos.clear(); m.why = Some(if why.is_null() { unknown(&m.machine.label, &m.machine.target) } else { why }); }
    }
    relist(s);
}
/// Whose board, in turn: this machine, every machine, then each other machine by itself.
pub fn scope_next(s: &State) -> String {
    let ring: Vec<String> = std::iter::once(String::new()).chain(std::iter::once("*".to_string())).chain(s.remotes.keys().cloned()).collect();
    let at = ring.iter().position(|x| *x == s.scope).unwrap_or(0);
    ring[(at + 1) % ring.len()].clone()
}
pub fn next_scope(s: &mut State, fx: &mut Vec<Effect>) { let to = scope_next(s); set_scope(s, to, fx); }
pub fn set_scope(s: &mut State, to: String, fx: &mut Vec<Effect>) {
    s.scope = to; fx.push(Effect::Save);
    if s.all() { fx.push(Effect::Poll(true)); }
    let said = if s.scope.is_empty() { "This machine only.".to_string() } else if s.scope == "*" { "Every machine you can reach.".into() } else { format!("Only {}. What you type goes to {}.", s.scope, s.scope) };
    s.flash(said, Ink::Muted);
    relist(s);
}
