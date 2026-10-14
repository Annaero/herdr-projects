//! The board inside the herdr web UI. A front door (door.rs) stands in front of the web UI's server and passes every
//! request through to it (proxy.rs), but for the board's own page and calls under `/superwork/` and one script line in
//! the web UI's page. The board there is the terminal board's own state and update, one per browser (web.rs, view.rs),
//! sent as data (model/). The front door runs in the page server's process and follows the web UI (keep.rs); the one
//! setup step is the web UI's shared link (link.rs), by hand with `herdr-superwork web-ui` (command.rs).
pub mod boards;
pub mod command;
pub mod door;
pub mod find;
pub mod follow;
pub mod ink;
pub mod keep;
pub mod link;
pub mod model;
pub mod page;
pub mod pcs;
pub mod proxy;
pub mod view;
pub mod web;
