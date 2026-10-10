// The detached runner's entry: `herdr-superwork run <job> <task id>`. Every runner runs one housekeeping pass as
// it exits, so a slot freed by a merge is reused at once.
import * as S from "./store.js";
import { housekeeping } from "./housekeeping.js";

export async function runJob(job, id, extra = []) {
  // A stop from the board ends this runner's own subprocesses with it.
  if (process.env.HERDR_SUPERWORK_INLINE !== "1") process.once("SIGTERM", () => { try { process.kill(-process.pid, "SIGKILL"); } catch {} process.exit(0); });
  try {
    if (job === "delegate") await (await import("./delegate.js")).delegateJob(id);
    else if (job === "restart") await (await import("./delegate.js")).restartJob(id);
    else if (job === "finish") await (await import("./finish.js")).finishJob(id, { force: extra.includes("--force") });
    else if (job === "pipeline") await (await import("./finish.js")).pipelineJob(id);
    else if (job === "sync") await (await import("./finish.js")).syncJob(id, { force: extra.includes("--force") });
    else if (job === "recover") await (await import("./finish.js")).recoverJob(id);
    else if (job === "land") await (await import("./land.js")).landJob(id);
    else if (job === "cleanup") await (await import("./land.js")).cleanupJob(id);
    else if (job === "prpoll") await (await import("./housekeeping.js")).pollPrs();
    else if (job === "dispatch") await (await import("./helpers.js")).dispatchJob(id);
    else throw new Error(`Unknown job ${job}`);
  } catch (e) {
    process.stderr.write(`${new Date().toISOString()} ${job} ${id}: ${e.stack || e}\n`);
  }
  const socket = id && id !== "-" ? S.get(id)?.link?.socket : undefined;
  try { housekeeping(socket, { force: true }); } catch {}
}
