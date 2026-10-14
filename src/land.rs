//! Landing: bring the branch up to date with main in the task's own worktree, merge (through the pull request when
//! there is one, else locally), then clean up. Conflicts are rolled back and saved; a checkout with unsaved files is
//! never forced. One part per file in land/: the clean-up, and the merge.
pub mod cleanup;
pub mod merge;
pub use cleanup::{cleanup, cleanup_job, cleanup_with, tidy, Cleanup};
pub use merge::{land_core, land_job};
