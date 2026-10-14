//! The checks a pull request is to get before GitHub lists them, so that one not registered yet is waited for and
//! never taken for "none". GitHub Actions: each workflow of the branch that runs for this pull request (triggers.rs
//! decides it as GitHub does: its events, branches, paths and types) must have its run on the commit, finished and
//! passed; a run waits for all of its jobs, every member of a matrix too. Each check the branch it merges into
//! requires (its protection, its rulesets) must be listed. An outside CI, with nothing listed: checks of its own on
//! the branch it merges into or on the repo's other pull requests. Used by checks.rs.
use super::triggers::{parse, runs_for, Flow, Pr};
use crate::flow::git::{gh, CHECK_BAD, CHECK_GOOD};
use crate::json::*;
use crate::store::repos::git_out;
use std::path::{Path, PathBuf};

/// What the workflows of the branch say of this commit.
#[derive(Default, Debug)]
pub struct Flows { pub waiting: Vec<String>, pub failed: Vec<Value> }
fn tree_of(t: &Obj) -> PathBuf { if t.b("worktree") { PathBuf::from(t.s("worktree")) } else { crate::store::repos::folder_of(t.s("id")) } }
/// The workflows in the task's worktree that run for this pull request, each with its file (`.github/workflows/…`).
pub fn flows_for(t: &Obj, base: &str) -> Vec<(String, Flow)> {
    let tree = tree_of(t);
    let Ok(dir) = std::fs::read_dir(tree.join(".github").join("workflows")) else { return vec![] };
    let files = git_out(&tree, &["diff", "--name-only", &format!("origin/{base}...HEAD")]).ok().map(|o| o.lines().map(String::from).collect());
    let pr = Pr { base, branch: t.s("branch"), files };
    let mut out: Vec<(String, Flow)> = dir.flatten().filter(|e| e.path().extension().map(|x| x == "yml" || x == "yaml").unwrap_or(false))
        .filter_map(|e| { let f = e.file_name().to_string_lossy().to_string(); std::fs::read_to_string(e.path()).ok().map(|y| (format!(".github/workflows/{f}"), parse(&f, &y))) })
        .filter(|(_, w)| runs_for(w, &pr)).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
/// Each workflow that runs for it, against its runs on this commit: none yet, or one not finished, is waited for (by the
/// workflow's name); one that finished and failed is a failed check. GitHub not answering: all of them are waited for.
pub fn flows_state(t: &Obj, root: &Path, base: &str, head: &str) -> Flows {
    let flows = flows_for(t, base);
    if flows.is_empty() { return Flows::default(); }
    let r = gh(&["api", &format!("repos/{{owner}}/{{repo}}/actions/runs?head_sha={head}&per_page=100"), "--jq", ".workflow_runs[] | [.path, .status, (.conclusion // \"\"), .html_url] | @tsv"], root, 30000);
    let runs: Vec<Vec<String>> = if r.status == 0 { r.stdout.lines().map(|l| l.split('\t').map(String::from).collect()).collect() } else { vec![] };
    let mut out = Flows::default();
    for (file, flow) in flows {
        let mine: Vec<&Vec<String>> = runs.iter().filter(|x| x.first().map(|p| p.split('@').next() == Some(file.as_str())).unwrap_or(false)).collect();
        let at = |x: &Vec<String>, i: usize| x.get(i).cloned().unwrap_or_default().to_uppercase();
        if let Some(bad) = mine.iter().find(|x| at(x, 1) == "COMPLETED" && CHECK_BAD.contains(&at(x, 2).as_str())) {
            out.failed.push(json!({ "name": flow.name, "conclusion": at(bad, 2), "detailsUrl": bad.get(3).cloned().unwrap_or_default() }));
        } else if mine.is_empty() || mine.iter().any(|x| at(x, 1) != "COMPLETED" || !CHECK_GOOD.contains(&at(x, 2).as_str())) {
            out.waiting.push(flow.name.clone());
        }
    }
    out
}
/// The checks the branch it merges into requires before anything merges into it: its protection's and its rulesets'.
/// Asked of GitHub; where it cannot say, nothing is added here.
pub fn required(root: &Path, base: &str) -> Vec<String> {
    if base.is_empty() { return vec![]; }
    let mut out: Vec<String> = vec![];
    for (path, jq) in [(format!("repos/{{owner}}/{{repo}}/branches/{base}"), ".protection.required_status_checks.contexts[]?"),
        (format!("repos/{{owner}}/{{repo}}/rules/branches/{base}"), ".[] | select(.type == \"required_status_checks\") | .parameters.required_status_checks[].context")] {
        let r = gh(&["api", &path, "--jq", jq], root, 30000);
        if r.status != 0 { continue; }
        for l in r.stdout.lines().map(str::trim).filter(|l| !l.is_empty()) { if !out.iter().any(|o| o == l) { out.push(l.to_string()); } }
    }
    out
}
/// With nothing listed: an outside CI (one not of GitHub Actions, which flows_state decides exactly) that reports on
/// the newest commit of the branch it merges into, or on one of the repo's last pull requests. A question GitHub cannot
/// answer counts as yes, so nothing merges unchecked for it.
pub fn outside_ci(root: &Path, base: &str) -> bool {
    if base.is_empty() { return true; }
    let asks = [
        vec!["api".to_string(), format!("repos/{{owner}}/{{repo}}/commits/{base}/check-runs"), "--jq".into(), "[.check_runs[] | select(.app.slug != \"github-actions\")] | length".into()],
        vec!["api".to_string(), format!("repos/{{owner}}/{{repo}}/commits/{base}/status"), "--jq".into(), ".total_count".into()],
        ["pr", "list", "--state", "all", "--limit", "10", "--json", "statusCheckRollup", "--jq", "[.[].statusCheckRollup[] | select((.workflowName // \"\") == \"\")] | length"].iter().map(|s| s.to_string()).collect(),
    ];
    asks.iter().any(|a| {
        let r = gh(&a.iter().map(String::as_str).collect::<Vec<_>>(), root, 30000);
        r.status != 0 || r.stdout.trim().parse::<i64>().map(|n| n > 0).unwrap_or(true)
    })
}
