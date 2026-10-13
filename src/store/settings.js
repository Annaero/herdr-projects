// Settings as saved and read: yours, your entry for a repo, one task's own, and the repo's file. What there is to set
// is settings-list.js: a new setting goes there. Each part is a file of its own in settings/: the values, the places,
// the one lookup, set and unset, `show`, and the one-time move from the old names.
export * from "./settings-list.js";
export { NONE, ms, tokensOf, tokensSay, agentOf, fits, check, commandOf, listOf, say, AGENT_KINDS, nearest } from "./settings/values.js";
export { REPO_FILE, configFile, yours, repoFile } from "./settings/places.js";
export { lookup, setting, work, toSend, inRepo } from "./settings/lookup.js";
export { setValue, setMany, unsetValue, checked } from "./settings/change.js";
export { rows as settingRows, problems as settingProblems, showText } from "./settings/show.js";
export { moveSettings, movedTask, movedConfig } from "./settings/migrate.js";
