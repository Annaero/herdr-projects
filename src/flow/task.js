// A task's own places and its herdr: the closing note, the review folder, whether an agent is on it.
import path from "node:path";
import * as S from "../store.js";
import { herdr } from "../herdr.js";

export const RULE_DIR = ".herdr-superwork";
export const noteFile = (t) => path.join(S.cwdOf(t), RULE_DIR, `closing-${t.n}.md`);
export const reviewDir = (t) => path.join(S.cwdOf(t), RULE_DIR, `review-${t.n}`);
export const isAgentTask = (t) => !!t.link?.pane;
export const h = (t) => herdr(t.link?.socket || null);
