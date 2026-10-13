// What the actions share: the stages an agent holds a slot in, and an action's answer.
import * as S from "../store.js";

export const AGENT_STAGES = ["queued", "attempts", ...S.SLOT_STAGES]; // "attempts": its attempts are at work (attempts.js)
export const say = (t, msg) => ({ task: t, msg });
