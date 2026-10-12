// What the actions share: the stages an agent holds a slot in, and an action's answer.
import * as S from "../store.js";

export const AGENT_STAGES = ["queued", ...S.SLOT_STAGES];
export const say = (t, msg) => ({ task: t, msg });
