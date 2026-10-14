//! The repo's own rules, checked with the rest: no source file past its size, every one says what it holds (the map
//! is made from those words), a key's chord only in the keys' table, and no made table out of date.
#[test]
fn every_source_file_is_within_its_size_says_what_it_holds_and_every_made_table_is_up_to_date() {
    let bad = sw::docs::guard::problems();
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}
#[test]
fn the_map_is_made_from_each_files_top_comment_whole_or_for_one_folder() {
    let all = sw::docs::map::where_page("").unwrap();
    assert!(all.contains("## `src/board/`") && all.contains("## The pages: `docs/`"), "{all}");
    let one = sw::docs::map::where_page("src/webui").unwrap();
    assert!(one.contains("## `src/webui/`") && !one.contains("## `src/board/`") && !one.contains("The pages"));
    assert!(sw::docs::map::where_page("nowhere").unwrap().contains("No folder of source files is at or under `nowhere`."));
}
