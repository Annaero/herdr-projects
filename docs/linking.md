# Linking

Every build after an edit links the program again, and the test program, which hold the whole library. On Linux the
builds of this repo link with [mold](https://github.com/rui314/mold), the quickest linker there is; where mold is not
installed they link as Rust does by itself.

## How

- `.cargo/config.toml` gives the builds on Linux (x86_64 and aarch64) two flags: `-Clinker-features=-lld`, so the C
  compiler is no longer asked for Rust's own lld, and `-Clink-arg=-Bscripts/ld/`, so it runs `scripts/ld/ld` as its
  `ld`. That is a link to `scripts/linker.sh`. It holds for every build in the repo: the check, the workspace setup,
  and a `cargo build` or `cargo test` of your own.
- `scripts/linker.sh` runs mold, one pinned version checked against its published sha256, kept in
  `~/.cache/herdr-superwork` beside the shared build cache. The workspace setup installs it
  (`sh scripts/linker.sh --install`, in `scripts/setup.sh`). Like Rust's lld, mold links on all the cores: a link is a
  fraction of a second, and on this task's share of them ([testing](testing.md)) mold kept little of its gain.
- **Where mold is not installed** (GitHub CI, a fresh machine, no network, a platform with no mold build), the script
  runs the linker Rust uses by itself: its own lld (`rust-lld`, which Rust puts first on the linker's PATH) on x86_64,
  the system's `ld` elsewhere. Nothing has to be installed for a build to work.
- **Release builds link as before**: a link whose files go under a `release` folder (`cargo build --release`, also
  with `--target`) is that same linker. The release files themselves are built for musl targets, which
  `.cargo/config.toml` does not name.
- **macOS** keeps Apple's own linker (ld-prime, the default since Xcode 15): it is as quick as lld there, and mold has
  no macOS build.
- `HERDR_SUPERWORK_NO_MOLD=1` turns mold off. Switching it on or off rebuilds nothing.

## Why flags, and not a linker named in the config

Cargo keeps what it built by the settings it built it with, and gives a linker named in the config
(`linker = "scripts/linker.sh"`) as that worktree's whole path. Every library would then be out of date in a build
copied from another worktree (the warm start, [testing](testing.md)) and in the shared build cache, which keys a
compile by its arguments. The two flags are the same words in every worktree, so neither notices them.

The `-B` folder is relative, and the C compiler looks for it from where the compile runs: the repo itself for the
program and its tests. The build scripts and macros of the libraries are compiled in their own folders, where there is
no `scripts/ld/`: they link with the system's `ld`, small programs built once.

## What it saves

Measured on vm-str (16 cores, Rust 1.98.1, other tasks building at the same time), after a one-line change to
`src/lib.rs`, building as the check does (the program, then the test programs), six times each. Each cell is the range
of one link's time:

| Link | Rust's own lld (before) | mold on the check's 2 cores | mold on all cores (as shipped) |
|---|---|---|---|
| The program (39 MB) | 0.22–0.27 s | 0.16–0.20 s | 0.09–0.12 s |
| The test program (`tests/main.rs`) | 0.37–0.45 s | 0.28–0.33 s | 0.14–0.19 s |
| The library's own tests | 0.12–0.16 s | 0.06–0.10 s | 0.05–0.09 s |
| The program with debug data (`dev`, 134 MB) | 0.39–0.51 s | — | 0.17–0.22 s |
| **All links after one edit** | **about 0.8 s** | about 0.6 s | **about 0.4 s** |

mold links in about half the time, which saves about 0.4 s of every build after an edit. The whole build hardly
changes (about 2.7 s for the program and 6 s more for the tests, and the spread between runs is as large as the gain):
compiling is nearly all of it, because Rust's own lld was already quick.
