// The herdr web UI plugin (devswha.herdr-web-ui): whether it is installed in this herdr, and the address its server
// listens on. Read from herdr and from the web UI's own files, never written: its settings (`PORT`, `HOST` in the
// `env` or `.env` of its config folder) and the port a start of it settled on (`plugin-port`, when the default was
// taken). Checked on herdr-web-ui 0.4.8 (scripts/plugin.ts, scripts/plugin-port.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "../store.js";
import { herdr } from "../herdr.js";
import { extras } from "../extras.js";

export const WEB_UI = "devswha.herdr-web-ui";
export const DEFAULT_PORT = 7317;
const valid = (n) => Number.isInteger(n) && n > 0 && n < 65536;

// `KEY=value` lines, as the web UI reads them: `.env` wins over `env`.
function envFiles(dir) {
  const vars = {};
  for (const name of ["env", ".env"]) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const t = line.trim(), eq = t.indexOf("=");
      if (!t || t.startsWith("#") || eq <= 0) continue;
      vars[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}
// Where the web UI listens and which herdr it shows, from its plugin's config folder.
export function addressFrom(configDir, env = process.env) {
  const vars = configDir ? envFiles(configDir) : {};
  const host = vars.HOST || "127.0.0.1";
  // Its herdr, worked out as the web UI's own start does (its scripts/plugin.ts, checked on 0.4.8): its settings are
  // laid over the environment herdr started it with, and then the startup socket herdr hands every plugin
  // (HERDR_SOCKET_PATH) wins over a HERDR_SOCKET in either. So a session's own socket comes first, also when the
  // settings name another. This process was started by that same herdr and has the same variable.
  // "": nothing says, and this process's own herdr stays as it is.
  const startup = vars.HERDR_SOCKET_PATH ?? env.HERDR_SOCKET_PATH;
  const socket = startup !== undefined ? startup : vars.HERDR_SOCKET || env.HERDR_SOCKET || "";
  if (valid(Number(vars.PORT))) return { host, port: Number(vars.PORT), socket };
  const state = vars.HERDR_WEB_STATE_DIR || env.HERDR_WEB_STATE_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "herdr-web-ui");
  let saved = NaN;
  try { saved = Number(fs.readFileSync(path.join(state, "plugin-port"), "utf8").trim()); } catch {}
  return { host, port: valid(saved) ? saved : DEFAULT_PORT, socket };
}
// A web UI named by hand (`HERDR_SUPERWORK_WEBUI=17431`, or `host:port`): one that herdr does not list as a plugin,
// which is how a copy of it is tried out. `off`: there is none, whatever is installed.
function named(value) {
  const v = String(value || "").trim();
  if (!v) return undefined;
  if (v.toLowerCase() === "off") return null;
  const at = v.lastIndexOf(":");
  const port = Number(at < 0 ? v : v.slice(at + 1));
  return valid(port) ? { host: at < 0 ? "127.0.0.1" : v.slice(0, at), port, named: true } : null;
}

// The web UI's address, or null when there is none to stand in front of: not installed, turned off in herdr, or the
// `webUi` setting is off. Asking herdr starts a program, so the answer is kept for a few seconds.
let kept = { at: 0, value: null };
export function webUi({ fresh = false, now = Date.now() } = {}) {
  if (!fresh && now - kept.at < 15000) return kept.value;
  let value = null;
  try { value = look(); } catch {}
  kept = { at: now, value };
  return value;
}
function look() {
  // Off by the setting, or taken out with `remove-extras` (until `web-ui link` asks for it again).
  if (S.setting("board.webUi") === "none" || extras().webUi === "removed") return null;
  const byHand = named(process.env.HERDR_SUPERWORK_WEBUI);
  if (byHand !== undefined) return byHand;
  const plugin = herdr().plugins().find((p) => p.plugin_id === WEB_UI && p.enabled !== false);
  if (!plugin) return null;
  return { ...addressFrom(herdr().pluginConfigDir(WEB_UI)), root: plugin.plugin_root || "", version: plugin.version || "" };
}
