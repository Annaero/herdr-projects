// The one-time move from the old settings: a run of this code that finds your file in the old shape converts your
// config.json (a copy of the old file is kept beside it as config.old.json), each task's own settings and what each
// task took from its repo's file. After it the old names are gone. A task under way keeps the choices it had.
import fs from "node:fs";
import path from "node:path";
import { tasksDir, readJson, writeJson, withLock, withTaskLock } from "../files.js";
import { configFile } from "./places.js";
import { check } from "./values.js";

const OFF = ["false", "off", "no", "none"], ON = ["true", "on", "yes", "auto"];
const off = (v) => v === false || OFF.includes(String(v).toLowerCase());
const on = (v) => v === true || ON.includes(String(v).toLowerCase());
const has = (v) => v !== undefined && v !== null && v !== "";
const withModel = (kind, model) => (has(model) ? `${kind}/${model}` : String(kind));
// Old names in, new names out: { "review.rounds": 5, … }. `builtin`: the old built-in programs, for a model that was
// set without its program. Anything that cannot be said in the new names is left out.
export function movedValues(old, builtin = {}) {
  const o = old || {}, out = {};
  const put = (name, v) => { try { out[name] = check(name, v); } catch {} };
  const agent = (name, kind, model, fallback) => { if (has(kind) && !off(kind)) put(name, withModel(String(kind).toLowerCase(), model)); else if (has(model) && fallback) put(name, withModel(fallback, model)); };
  agent("worker.agent", o.agent, o.model, builtin.agent);
  if (has(o.effort)) put("worker.effort", o.effort);
  if (o.fast !== undefined) put("worker.fast", on(o.fast));
  if (has(o.reviewer) && off(o.reviewer)) put("review.when", "never"); else agent("reviewer.agent", o.reviewer, o.reviewerModel, builtin.reviewer);
  if (has(o.reviewerEffort)) put("reviewer.effort", o.reviewerEffort);
  if (o.reviewerFast !== undefined) put("reviewer.fast", on(o.reviewerFast));
  if (has(o.coordinator) && off(o.coordinator)) put("coordinator.agent", "none"); else agent("coordinator.agent", o.coordinator, o.coordinatorModel, builtin.coordinator);
  if (has(o.coordinatorEffort)) put("coordinator.effort", o.coordinatorEffort);
  const wAgent = o.watcherAgent ?? o.helper, wModel = o.watcherModel ?? o.helperModel;
  if (has(o.watcher) && off(o.watcher)) put("watcher.agent", "none");
  else if (has(wAgent) || has(wModel)) put("watcher.agent", withModel(has(wAgent) ? String(wAgent).toLowerCase() : "claude", has(wModel) ? wModel : has(wAgent) ? "" : "claude-haiku-5-5"));
  if (has(o.watcherEvery)) put("watcher.every", `${Math.round(Number(o.watcherEvery))}s`);
  if (has(o.review) && !out["review.when"]) put("review.when", { all: "always", always: "always", everything: "always", none: "never", off: "never", false: "never", no: "never", never: "never" }[String(o.review).toLowerCase()] || "repos");
  // The old gate: a severity, or "off" (and the older reviewAuto: false), which sent nothing back by itself.
  const gate = has(o.gate) ? String(o.gate).toLowerCase() : o.reviewAuto !== undefined ? (on(o.reviewAuto) ? "major" : "off") : "";
  if (gate === "off" || ["manual", ...OFF].includes(gate)) put("review.rounds", 0); else if (gate) put("review.mustFix", gate);
  if (has(o.rounds) && out["review.rounds"] === undefined) put("review.rounds", Number(o.rounds));
  if (o.artifacts !== undefined) put("review.evidence", on(o.artifacts));
  if (has(o.base)) put("workspace.from", o.base === "head" ? "here" : "main");
  if (o.cleanup !== undefined) put("workspace.cleanup", on(o.cleanup));
  if (o.pr !== undefined) put("merge.pr", on(o.pr));
  if (has(o.merge)) put("merge.method", o.merge);
  if (o.autoMerge !== undefined && o.autoMerge !== null) put("merge.by", on(o.autoMerge) ? "itself" : "you");
  if (has(o.max)) put("board.agents", Number(o.max));
  if (has(o.machines)) {
    const names = String(o.machines).split(/[\s,]+/).filter(Boolean);
    put("board.machines", names.length === 1 && off(names[0]) ? "none" : names.map((n) => (has(o.remoteUser) && !n.includes("@") && n !== "auto" ? `${o.remoteUser}@${n}` : n)).join(", "));
  }
  if (has(o.theme)) put("board.theme", o.theme);
  if (has(o.webUi)) put("board.webUi", off(o.webUi) ? "none" : "auto");
  return out;
}
const nested = (flat) => { const out = {}; for (const [name, v] of Object.entries(flat)) { const [a, b] = name.split("."); (out[a] ||= {})[b] = v; } return out; };
// The repo's old file, as a task took it: setup, check, teardown, include.
const movedFacts = (cfg) => { const f = {}; if (cfg?.setup) f["workspace.setup"] = String(cfg.setup); if (cfg?.check) f["check.command"] = String(cfg.check); if (cfg?.teardown) f["workspace.teardown"] = String(cfg.teardown); if (Array.isArray(cfg?.include) && cfg.include.length) f["workspace.include"] = cfg.include.map(String); return f; };
const OLD_KEYS = ["agent", "model", "effort", "fast", "reviewerModel", "reviewerEffort", "reviewerFast", "coordinatorModel", "coordinatorEffort", "watcherAgent", "watcherModel", "watcherEvery", "helper", "helperModel", "gate", "reviewAuto", "rounds", "artifacts", "serve", "remerge", "worktree", "base", "pr", "autoMerge", "cleanup", "machines", "remoteUser", "max", "skill", "trust", "agentArgs", "theme", "ownTerminal", "webUi", "bell"];
const isOld = (file) => !!file && typeof file === "object" && (OLD_KEYS.some((k) => k in file) || ["reviewer", "coordinator", "watcher", "review", "merge"].some((k) => k in file && (typeof file[k] !== "object" || file[k] === null)));
// Your old config.json as the new one, or null when it is not in the old shape.
export function movedConfig(file) { return isOld(file) ? nested(movedValues(file, { agent: "claude", reviewer: "codex", coordinator: "claude" })) : null; }
// One task in the old shape (`own`, `repoCfg`) as the new one, or null when there is nothing to move. `old`: your old
// config, which a task's merging by itself depended on.
export function movedTask(t, old = {}) {
  if (!t || (t.own === undefined && t.repoCfg === undefined && t.worktreeMode === undefined && t.base === undefined)) return null;
  const own = t.own || {};
  // A model the task chose without a program goes with the program it ran on.
  const said = movedValues(own, { agent: t.agent || (old?.agent && String(old.agent)) || "claude", reviewer: old?.reviewer && !off(old.reviewer) ? String(old.reviewer) : "codex" });
  const settings = Object.fromEntries(Object.entries({ ...said, ...(t.settings || {}) }).filter(([n]) => !/^(board|coordinator|watcher)\./.test(n)));
  if (t.base === "head" || t.base === "fresh") settings["workspace.from"] ??= t.base === "head" ? "here" : "main";
  // The repo's own file could switch merging on by itself ("land": "auto") where you had chosen nothing. It no longer
  // can; a task that ran on that keeps it, as its own choice.
  if (t.repoCfg?.land === "auto" && own.autoMerge == null && (old?.autoMerge === undefined || old?.autoMerge === null) && t.startedOnce) settings["merge.by"] ??= "itself";
  const next = { ...t, settings };
  if (own.research === true) next.research = true; // the old switch: it becomes the setting when the task is read (old-research.js)
  if (t.repoCfg !== undefined) next.repoFile = movedFacts(t.repoCfg);
  for (const k of ["own", "repoCfg", "worktreeMode", "base"]) delete next[k];
  return next;
}
// The move itself. It starts from your file: only a config.json still in the old shape is converted, and with it every
// task. Nothing else marks it as done, so a file put back in the old shape is simply converted again, and a run that
// was cut off is finished by the next one. A task that an older version wrote afterwards is converted when it is
// next read (`movedOnRead`, used by store/tasks.js).
const keptFile = () => `${configFile().replace(/\.json$/, "")}.old.json`;
export const movedOnRead = (t) => movedTask(t, t?.repoCfg?.land === "auto" ? readJson(keptFile()) || {} : {}) || t;
export function moveSettings() {
  const file = readJson(configFile());
  if (!isOld(file)) return false;
  let moved = false;
  try {
    withLock("settings-move", () => {
      const old = readJson(configFile());
      if (!isOld(old)) return;
      let repos = [];
      try { repos = fs.readdirSync(tasksDir()); } catch {}
      for (const repo of repos) {
        let ns = [];
        try { ns = fs.readdirSync(path.join(tasksDir(), repo)); } catch { continue; }
        for (const n of ns.filter((x) => /^\d+$/.test(x))) {
          const f = path.join(tasksDir(), repo, n, "task.json");
          withTaskLock(`${repo}/${n}`, () => { const next = movedTask(readJson(f), old); if (next) writeJson(f, next); }, { waitMs: 10000 });
        }
      }
      // Your file last: until it is written the move is not done, and is done again from the start.
      fs.copyFileSync(configFile(), keptFile());
      writeJson(configFile(), movedConfig(old));
      moved = true;
    }, { waitMs: 10000 });
  } catch {} // busy or unreadable: the next run tries again
  return moved;
}
