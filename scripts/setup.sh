#!/bin/sh
# The workspace setup (.herdr-superwork.json): run in every fresh worktree before its agent starts. It installs the
# build cache all worktrees share (scripts/build-cache.sh), builds the program through it with the `quick` profile on
# this task's share of the cores (scripts/share-cores.sh), and writes the made pages, the map among them.
set -e
cd "$(dirname -- "$0")/.."
sh scripts/build-cache.sh
. scripts/build-cache.sh
. scripts/share-cores.sh
cargo build --profile quick
./target/quick/herdr-superwork docs
