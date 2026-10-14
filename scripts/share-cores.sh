#!/bin/sh
# How many cores one task's build and tests may take, so that the tasks working at once share the machine instead of
# each taking all of it: the machine's cores divided by `board.agents` (how many agents work at once, from your
# settings; 4 when unset), rounded up. Sourced by scripts/check.sh and scripts/setup.sh; it sets CARGO_BUILD_JOBS and
# RUST_TEST_THREADS, and leaves either alone when you set it yourself. docs/testing.md.
sc_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)
sc_agents=$(awk '/"board"[[:space:]]*:/ { b = 1 }
  b && match($0, /"agents"[[:space:]]*:[[:space:]]*[0-9]+/) { s = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", s); print s; exit }' \
  "${HERDR_SUPERWORK_HOME:-$HOME/.herdr-superwork}/settings/config.json" 2>/dev/null)
case "$sc_agents" in ''|0*) sc_agents=4 ;; esac
sc_jobs=$(( (sc_cores + sc_agents - 1) / sc_agents ))
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-$sc_jobs}"; RUST_TEST_THREADS="${RUST_TEST_THREADS:-$sc_jobs}"
export CARGO_BUILD_JOBS RUST_TEST_THREADS
