#!/bin/sh
# The one command that runs the tests, for everyone: `npm run check` (`npm test`, `sh scripts/check.sh`). It builds the
# program, writes the made tables when they are out of date (and says so: commit them), checks the repo's own rules and
# runs every test. `--all` runs everything (as a run with no names does); names run one area's test files or the
# tests whose names hold them (`npm run check board-panel textbox`); `--fresh` runs again what already passed. What
# passed is remembered for the exact code it passed on (every file of the folder, committed or not, and the compiler): asked again, it answers at
# once. How it works: docs/testing.md.
set -e
# A check that stops says why, also when a step stopped it with no word of its own (`set -e`).
step="starting"
trap 'st=$?; [ "$st" = 0 ] || echo "The check stopped while $step (exit $st)." >&2' EXIT
quit() { echo "$1" >&2; trap - EXIT; exit 2; }
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
# The folder checked is this one. The board runs a task's check with HERDR_SUPERWORK_REPO set to your own checkout
# (finish/pipeline.rs), and the program's made pages and rules follow that variable (docs.rs): taken along, the check
# would read and write your checkout, not the task's.
unset HERDR_SUPERWORK_REPO
fresh=0; names=""
for a in "$@"; do
  case "$a" in
    --all) ;;
    --fresh) fresh=1 ;;
    --*) quit "check does not know $a. It takes: --all, --fresh, and names of tests." ;;
    *) names="$names $a" ;;
  esac
done
say() { [ -n "$HERDR_SUPERWORK_PROGRESS" ] && printf '%s\n' "$1" > "$HERDR_SUPERWORK_PROGRESS" || true; }
if ! command -v cargo >/dev/null 2>&1; then
  for d in "$HOME/.cargo/bin"; do [ ! -x "$d/cargo" ] || PATH="$d:$PATH"; done
fi
command -v cargo >/dev/null 2>&1 || quit "The check needs Rust (cargo): https://rustup.rs"
# Compiles through the build cache every worktree shares, when the workspace setup installed it, on this task's share
# of the cores (docs/testing.md).
. scripts/build-cache.sh
. scripts/share-cores.sh
# The code as it stands, new files and uncommitted changes too, and the compiler that builds it.
cache="${XDG_CACHE_HOME:-$HOME/.cache}/herdr-superwork-check"
stamp=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  idx=$(mktemp); cp "$(git rev-parse --git-path index)" "$idx" 2>/dev/null || true
  tree=$(GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1 && GIT_INDEX_FILE="$idx" git write-tree 2>/dev/null || true); rm -f "$idx"
  [ -n "$tree" ] && stamp="$tree-$(rustc -V | tr -c 'A-Za-z0-9.\n' '_')-$(printf '%s' "$names" | tr -c 'A-Za-z0-9_\n' '_')"
fi
if [ "$fresh" = 0 ] && [ -n "$stamp" ] && [ -f "$cache/$stamp" ]; then
  say '{"state":"known"}'
  echo "The check already passed for this exact code."
  exit 0
fi
started=$(date +%s)
say "0/3 steps"
step="building the program"
cargo build --profile quick --quiet
say "1/3 steps"
# The made tables, written when out of date; then the rules (tests/guard.rs runs them too).
step="writing the made tables"
./target/quick/herdr-superwork docs
step="checking the repo's rules"
./target/quick/herdr-superwork docs --guard
say "2/3 steps"
# A name that is an area (a test file `tests/<name>.rs`, or several `tests/<name>_*.rs`; `-` stands for `_`) runs
# those files, which are modules of the one test program (tests/main.rs); any other name runs the tests whose own
# names hold it.
step="running the tests"
mods=""; words=""
for n in $names; do
  f=$(printf '%s' "$n" | tr - _); found=""
  for t in tests/"$f".rs tests/"$f"_*.rs; do
    [ -f "$t" ] && [ "$t" != tests/main.rs ] && { found=1; mods="$mods|$(basename "$t" .rs)"; }
  done
  [ -n "$found" ] || words="$words $n"
done
if [ -n "$mods" ]; then
  # Exactly the tests of those modules: `settings::` as a filter would also run `web_settings::`.
  all=$(cargo test --profile quick --quiet --test main -- --list)
  picked=$(printf '%s\n' "$all" | sed -n 's/: test$//p' | grep -E "^(${mods#|})::" || true)
  # shellcheck disable=SC2086
  [ -z "$picked" ] || cargo test --profile quick --quiet --no-fail-fast --test main -- --exact $picked
fi
# shellcheck disable=SC2086
if [ -z "$mods" ] || [ -n "$words" ]; then cargo test --profile quick --quiet --no-fail-fast -- $words; fi
say "3/3 steps"
if [ -n "$stamp" ]; then { mkdir -p "$cache" && echo "passed in $(( $(date +%s) - started ))s" > "$cache/$stamp"; } || true; fi
echo "The check passed in $(( $(date +%s) - started ))s."
