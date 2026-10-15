#!/bin/sh
# The workspace setup (.herdr-superwork.json): run in every fresh worktree before its agent starts. It installs the
# build cache all worktrees share (scripts/build-cache.sh), starts from the warm build of the main line
# (scripts/warm-start.sh), builds the program through the cache with the `quick` profile on this task's share of the
# cores (scripts/share-cores.sh), keeps that build warm for the next worktree, and writes the made pages, the map
# among them.
set -e
cd "$(dirname -- "$0")/.."
sh scripts/build-cache.sh
. scripts/build-cache.sh
. scripts/share-cores.sh
. scripts/warm-start.sh
ws_seed
cargo build --profile quick
ws_keep
./target/quick/herdr-superwork docs
