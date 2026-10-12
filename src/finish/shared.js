// The finish line's shared pieces: the approval question's words, and marking a task as failed.
import * as S from "../store.js";
import * as F from "../flow.js";
import * as G from "../gate.js";

export const ms = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);
export const lastLines = (text, n = 12) => String(text || "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).join("\n");
export const firstLine = (text) => String(text || "").split("\n").find((l) => l.trim())?.trim() || "";
export const approvalMessage = (t, note = "") => {
  const rv = S.currentReview(t);
  const kept = rv?.keptAt && rv.kept ? ` ${S.keptWords(rv.kept, S.reviewHistory(t).at(-1)?.round).replace(/^r/, "R")}.` : "";
  return `Approve to merge?${rv ? ` ${G.sentence(rv)}` : ""}${kept} ${firstLine(t.summary) || "The work is finished."}${note}`;
};
export function fail(g, failure, extra = {}) {
  const t = g.set((t) => { t.stage = "failed"; t.msg = failure.msg || failure.title; t.mergeIntent = extra.keepIntent ? t.mergeIntent : null; Object.assign(t, S.failurePatch(failure), extra.patch || {}); });
  F.labelPane(t, null);
  return t;
}
