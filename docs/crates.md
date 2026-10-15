# Crates

The program is five crates, one on top of the other, so that a change builds again only the crate it is in and those
on top of it. The compiler reads a whole crate again after any edit (and once more for its tests): one crate of 27,000
lines meant every edit, also one line of the board's screen, paid for all of them.

| Crate | Folder | What it holds |
|---|---|---|
| sw-core | `crates/core/` | the data (`store/`), herdr and the agents, and the small tools every part uses |
| sw-flow | `crates/flow/` | the flow of a task: delegating, the finish line, landing, the keeper, other machines, automations |
| sw-board | `crates/board/` | the board's screen (`board/`): its state, what a key does, what it draws |
| sw-web | `crates/web/` | the board in the herdr web UI (`webui/`): the front door and the web board |
| herdr-projects | `Cargo.toml`, `src/` | the command line (`cli/`) and the made pages (`docs.rs`); the library is `sw` |

Most changes are to the board's screen and the web board: those build sw-board, sw-web and the command line again,
and take sw-core and sw-flow as they were. A change to sw-core builds all five again, as before.

## One path for a module, in every crate

Each crate's `src/lib.rs` names its modules (`pub mod store;`) and passes on those of the crate below it as its own
(`pub use sw_core::*;`). So a module is `crate::store` in every crate and `sw::store` in the tests, wherever it is
built: moving a module to another crate changes no path that uses it.

A new module goes in the lowest crate whose code it uses: one `pub mod` line in that crate's `src/lib.rs`. A new file
in a folder is one line in that folder's `mod.rs`, as before.

## A crate uses only the crates below it

The compiler holds to that: code in sw-flow that names `crate::board::view` does not build. When the code below needs
something from above, either it moves down, or the caller above hands it in:

- **Moved down.** The keys' table (`crates/flow/src/board/keys.rs`) and the theme (`crates/flow/src/board/theme/`) are
  built in sw-flow, in a `board` module of its own: a message of the flow names a key, and the review page takes the
  board's colours. sw-board's `board` module passes them on, so they are `crate::board::keys` everywhere. The same for
  what the flow and the board's screen use of the web UI (`crates/flow/src/webui/`): where it is (`find.rs`), its PCs
  (`pcs.rs`), its link (`link.rs`, `command.rs`), passing a request on (`proxy.rs`) and the front door started from
  outside (`keep.rs`). The front door's own loop, which serves the web board, is `door_loop.rs` in sw-web.
- **Handed in.** The page server (`review_page::serve_main`, sw-flow) is also the front door of the herdr web UI: the
  command line hands it the front door's loop (`webui::door_loop::run_door`, sw-web).

## A new worktree

Each crate's code is in its own folder, so cargo keeps what a crate was built from by paths inside that folder, the
same in every worktree. A new worktree starts from the warm build of the main line ([testing](testing.md)), and there
a crate none of whose files changed since that build is taken as built whole: only the crates a change reaches are
built again. The shared build cache keeps the libraries, not these crates: the compiler keeps its own notes on them in
each `target/` (incremental compilation), which a cache cannot take.

## What it saves

Measured on vm-str (16 cores, other tasks building at the same time), on this task's share of two cores, after a
one-line change to a file of each crate (the median of three runs; one run for a fresh worktree):

| Change in | Program built again, before → after | Fresh worktree from the warm build, before → after |
|---|---|---|
| the board's screen (sw-board) | 2.7 s → 1.5 s | 12.8 s → 4.8 s |
| the web board (sw-web) | 2.9 s → 1.1 s | 13.1 s → 2.6 s |
| the command line (`src/`) | 2.8 s → 0.7 s | 13.5 s → 1.5 s |
| the flow (sw-flow) | 2.8 s → 2.4 s | 12.5 s → 10.7 s |
| the data (sw-core) | 2.7 s → 3.2 s | 12.9 s → 13.1 s |

A build from nothing is about the same (33 s → 30 s), and so is the test program (4 s after a change, 15 s in a fresh
worktree): it is one crate of its own, `tests/main.rs`, built again after any change below it.
