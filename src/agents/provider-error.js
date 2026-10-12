// Provider errors: which ones pass by themselves, and which need the human.


// ---- provider errors: which ones pass by themselves ---------------------------------------------------------------------
// A turn can end because the model's provider failed, not because the agent finished or did something wrong. Some of
// those pass by themselves (the model is at capacity, the servers are overloaded, a rate limit, a dropped connection):
// the board waits and tries again. The others need the human (a login, a model that does not exist, a usage limit, a
// request the provider refuses) and are never retried. An error nobody recognises counts as the second kind.
// The program's own code for the error decides where it has one; the words decide for the rest.
//   Codex   `codex_error_info` on `task_complete` and on `error`. Seen in real files of 0.160.0: "server_overloaded"
//           and "other"; the other names are the ones in Codex's protocol.
//   Claude  `error` and `apiErrorStatus` on an `isApiErrorMessage` entry. Seen: "model_not_found" (404).
//   pi      only words (`errorMessage`).
const CODE_PASSING = { server_overloaded: "provider is overloaded", model_cap: "model is at capacity", http_connection_failed: "connection dropped", response_stream_connection_failed: "connection dropped",
  response_stream_disconnected: "connection dropped", response_too_many_failed_attempts: "connection dropped", internal_server_error: "provider had a server error", server_error: "provider had a server error", overloaded: "provider is overloaded", overloaded_error: "provider is overloaded" };
const CODE_LASTING = ["unauthorized", "bad_request", "context_window_exceeded", "usage_limit_exceeded", "sandbox_error", "authentication_failed", "billing_error", "invalid_request", "model_not_found", "max_output_tokens"];
const WORDS_AUTH = /\b(?:status|error|HTTP)\b[^\n]{0,12}\b40[13]\b|\b401 Unauthorized\b/i;
const WORDS_LASTING = /usage limit|(?<!rate.?)limit reached|hit your [\w ]*limit|\bquota\b|billing|credit balance|payment|not supported|unsupported|does not exist|may not exist|not found|unknown (?:provider|model)|invalid|context (?:window|length)|flagged|content policy/i;
const WORDS_PASSING = [
  [/at capacity/i, "model is at capacity"],
  [/rate.?limit|too many requests|\b429\b/i, "model is rate limited"],
  [/overloaded|\b529\b/i, "provider is overloaded"],
  [/socket|connection|network|\bE(?:CONN\w+|TIMEDOUT|AI_AGAIN|PIPE)\b|timed? ?out|fetch failed|stream (?:ended|closed|disconnected|error)|disconnect/i, "connection dropped"],
  [/\b(?:API error|status|HTTP)\b[^\n]{0,12}\b5\d\d\b|internal server error|bad gateway|service unavailable|upstream|server error|you can retry your request|try again later/i, "provider had a server error"],
];
export function providerError(text, { code = "", status = 0 } = {}) {
  const words = String(text || ""), c = String(code || "").toLowerCase(), n = Number(status) || 0;
  const said = (WORDS_PASSING.find(([re]) => re.test(words)) || [])[1] || "";
  const lasting = { passing: false, reason: "", auth: false };
  if (c === "unauthorized" || c === "authentication_failed" || n === 401 || n === 403 || WORDS_AUTH.test(words)) return { ...lasting, auth: true };
  if (CODE_LASTING.includes(c) || (n >= 400 && n < 500 && n !== 408 && n !== 429) || WORDS_LASTING.test(words)) return lasting;
  if (CODE_PASSING[c]) return { passing: true, reason: said || CODE_PASSING[c], auth: false };
  if (n === 429 || c === "rate_limit") return { passing: true, reason: "model is rate limited", auth: false };
  if (n === 408 || n >= 500) return { passing: true, reason: said || (n === 529 ? "provider is overloaded" : "provider had a server error"), auth: false };
  return said ? { passing: true, reason: said, auth: false } : lasting;
}
