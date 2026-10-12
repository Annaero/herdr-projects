// Failures: workflow diagnostics that live beside the task.
import { stripVTControlCharacters } from "node:util";

// ---- failures: workflow diagnostics live beside the task, not in its one-line message ------------------------------
// Require a login/credential diagnostic, not filenames, variable names or status numbers alone.
const AUTH = /^\s*(?:(?:fatal|error|api error|graphql):\s*)?(?:HTTP(?:\/\d(?:\.\d)?)?\s+(?:401|403)\s*:?\s*)?(?:unauthori[sz]ed|forbidden)[.!]?\s*$|\b(?:not (?:logged|signed) in|log ?in required|authentication (?:failed|required|error)|failed to authenticate|could not read Username|terminal prompts disabled)\b|\b(?:missing|invalid|expired|bad)\s+(?:credentials?|token|api[ _-]?key)\b|\b(?:credentials?|token|api[ _-]?key)\s+(?:(?:is|has|was)\s+)?(?:missing|invalid|expired|required)\b/i;
export function isAuthFailure(text) {
  return stripVTControlCharacters(String(text || "")).split(/\r?\n/).some((line) => {
    if (/^\s*(?:#\s*(?:Subtest|Suite):|(?:ok|not ok)\s+\d+\b|[✔✖✓✗▶ℹ])/.test(line)) return false; // reporter titles are data
    if (/\bAssertionError\b|\bexpected\b.*\b(?:received|got|actual)\b|^\s*(?:expected|actual|received|FAIL|not ok)\b/i.test(line)) return false;
    if (/^\s*(?:[+-](?:\s|$)|at\s|['"`]|\/\/|\/\*|(?:const|let|var|function|class|return|throw|assert|expect)\b)/.test(line)) return false;
    if (/^\s*(?:\[[^\]]+\]|.*\.[cm]?[jt]sx?):\d+(?::\d+)?\s*$/.test(line)) return false;
    const match = AUTH.exec(line);
    return !!match && !/['"`]/.test(line.slice(0, match.index));
  });
}
export function boundDetail(detail) {
  const d = String(detail || "");
  return d.length > 65536 ? d.slice(0, 32768) + "\n… output truncated …\n" + d.slice(-32768) : d;
}
// A patch that records a failure on a task. `auth` failures are the human's to fix.
export function failurePatch(failure) {
  const auth = failure.auth === true || (failure.auth !== false && isAuthFailure(failure.detail));
  return { failure: { ...failure, auth, detail: boundDetail(failure.detail), agentCanFix: auth ? false : failure.agentCanFix !== false,
    next: auth ? "Fix the login or credential, then tell the agent to continue." : failure.next, at: Date.now(), sentAt: null } };
}
