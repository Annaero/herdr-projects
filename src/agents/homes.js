// Where each agent program keeps its own settings and files.
import os from "node:os";
import path from "node:path";

export const claudeFile = () => process.env.HERDR_SUPERWORK_CLAUDE_JSON || path.join(os.homedir(), ".claude.json");
export const codexFile = () => process.env.HERDR_SUPERWORK_CODEX_TOML || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const piHome = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
