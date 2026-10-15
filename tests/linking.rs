//! [real programs] The linker of the builds (`scripts/linker.sh`, which the C compiler runs as `scripts/ld/ld`): mold
//! when it is installed; the linker Rust uses by itself when it is not, for a release build and when turned off.
use std::path::{Path, PathBuf};

/// A home with a cache folder, and a `rust-lld`, an `ld` and (once installed) a mold that write down their name and
/// the arguments they were given, one a line.
struct Bench { base: PathBuf }
impl Bench {
    fn new(name: &str) -> Bench {
        let base = std::env::temp_dir().join(format!("sw-linking-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("cache")).unwrap();
        let b = Bench { base };
        b.linker(&b.base.join("bin/rust-lld"), "rust-lld");
        b.linker(&b.base.join("bin/ld"), "ld");
        b
    }
    fn linker(&self, p: &Path, name: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, format!("#!/bin/sh\n{{ echo {name}; for a; do echo \"$a\"; done; }} > '{}'\n", self.saw().display())).unwrap();
        std::fs::set_permissions(p, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    }
    fn saw(&self) -> PathBuf { self.base.join("saw") }
    /// Installs a stand-in where scripts/linker.sh looks for the mold it installed.
    fn install_mold(&self) {
        let script = std::fs::read_to_string(root().join("scripts/linker.sh")).unwrap();
        let version = script.lines().find_map(|l| l.strip_prefix("ln_version=")).unwrap();
        self.linker(&self.base.join(format!("cache/herdr-superwork/mold-{version}/bin/mold")), "mold");
    }
    /// The linker as the C compiler runs it: which linker it ended in, and with what.
    fn link(&self, args: &[&str], env: &[(&str, &str)]) -> Vec<String> {
        let _ = std::fs::remove_file(self.saw());
        let o = std::process::Command::new(root().join("scripts/ld/ld")).args(args).env_clear()
            .env("HOME", self.base.join("home")).env("XDG_CACHE_HOME", self.base.join("cache"))
            .env("PATH", format!("{}:/usr/bin:/bin", self.base.join("bin").display())).envs(env.iter().copied()).output().unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        std::fs::read_to_string(self.saw()).unwrap().lines().map(String::from).collect()
    }
}
impl Drop for Bench { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.base); } }

fn root() -> &'static Path { Path::new(env!("CARGO_MANIFEST_DIR")) }
const LINK: &[&str] = &["--eh-frame-hdr", "-m", "elf_x86_64", "main.o", "-o", "/w/target/quick/deps/herdr_superwork-1"];
fn ran(linker: &[&str], args: &[&str]) -> Vec<String> { linker.iter().chain(args).map(|s| s.to_string()).collect() }
/// The linker Rust uses by itself on this machine: its own lld on x86_64, the system's ld elsewhere.
fn as_rust(args: &[&str]) -> Vec<String> {
    if std::env::consts::ARCH == "x86_64" { ran(&["rust-lld", "-flavor", "gnu"], args) } else { ran(&["ld"], args) }
}

#[test]
fn real_programs_without_mold_a_build_links_as_rust_does_by_itself() {
    let b = Bench::new("none");
    assert_eq!(b.link(LINK, &[]), as_rust(LINK));
    std::fs::remove_file(b.base.join("bin/rust-lld")).unwrap();
    assert_eq!(b.link(LINK, &[]), ran(&["ld"], LINK), "a Rust with no lld of its own links with the system's ld");
}

#[test]
fn real_programs_with_mold_installed_a_build_links_with_it() {
    let b = Bench::new("mold");
    b.install_mold();
    assert_eq!(b.link(LINK, &[]), ran(&["mold"], LINK));
}

#[test]
fn real_programs_a_release_build_and_a_build_with_mold_turned_off_link_as_before() {
    let b = Bench::new("release");
    b.install_mold();
    let release = ["main.o", "-o", "/w/target/x86_64-unknown-linux-gnu/release/deps/herdr_superwork-1"];
    assert_eq!(b.link(&release, &[]), as_rust(&release));
    assert_eq!(b.link(LINK, &[("HERDR_SUPERWORK_NO_MOLD", "1")]), as_rust(LINK));
}

#[test]
fn the_cargo_config_is_the_same_words_in_every_worktree() {
    // cargo keeps what it built by these words: a path of one worktree in them would make a build copied from another
    // (scripts/warm-start.sh), and every library in the shared build cache, out of date
    let config = std::fs::read_to_string(root().join(".cargo/config.toml")).unwrap();
    assert!(config.contains(r#""-Clink-arg=-Bscripts/ld/""#), "{config}");
    assert!(!config.contains("linker ="), "a linker named in the config is given to cargo as its whole path: {config}");
    assert_eq!(std::fs::read_link(root().join("scripts/ld/ld")).unwrap(), Path::new("../linker.sh"));
}
