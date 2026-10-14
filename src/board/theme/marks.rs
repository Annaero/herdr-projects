//! herdr's mark for each state (src/client/shell.rs, status_icon): its symbols, or its dots where herdr's
//! `ui.status_indicators` says "dots". Every state has its own mark, so no two are told apart by colour alone: ◐ an
//! agent works, ◑ its reviewer, ◒ the board's own step, ◓ it waits for a free slot, ✓ done, ○ to do, ✗ went wrong, ◆
//! ready for your yes, and what a task that waits for you needs: ? an answer, ! a yes or no, @ a sign-in.
pub const MARK_STATES: [&str; 10] = ["working", "review", "board", "queue", "ready", "blocked", "done", "idle", "unknown", "error"];
pub fn mark(state: &str, kind: &str, symbols: bool) -> &'static str {
    let pair: (&str, &str) = if state == "blocked" {
        match kind { "question" => ("?", "?"), "permission" => ("!", "!"), "auth" => ("@", "@"), _ => ("!", "!") }
    } else {
        match state { "working" => ("●", "◐"), "review" => ("●", "◑"), "board" => ("●", "◒"), "queue" => ("●", "◓"), "ready" => ("◆", "◆"), "done" => ("●", "✓"), "idle" => ("○", "○"), "error" => ("✗", "✗"), _ => ("·", "·") }
    };
    if symbols { pair.1 } else { pair.0 }
}
/// The marks as the web page gets them: it draws herdr's dots itself, and tells the reviewer, the board's own step and
/// a task that waits for a free slot from the agent's dot by these half moons; what a waiting task needs as on the
/// terminal board.
pub fn web_mark(state: &str, kind: &str) -> &'static str {
    if state == "blocked" { if let s @ ("?" | "!" | "@") = mark(state, kind, true) { if kind == "question" || kind == "permission" || kind == "auth" { return s; } } }
    match state { "idle" => "○", "working" => "●", "review" => "◑", "board" => "◒", "queue" => "◓", "ready" => "◆", "blocked" => "!", "done" => "✓", "error" => "✗", _ => "·" }
}
