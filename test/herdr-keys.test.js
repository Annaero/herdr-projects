// The key that opens the board: prefix+a is offered, and a key herdr or the user's config already uses is never taken.
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../src/herdr-keys.js";

const DEFAULT_CONFIG = `[update]\n# channel = "stable"\n\n[keys]\n# prefix = "ctrl+b"\n# workspace_picker = "prefix+w"\n# open_worktree = ""    # optional\n# switch_tab = "prefix+1..9"\n# split_horizontal = "prefix+minus"\n# reload_config = "prefix+shift+r"\n# [[keys.command]]\n# key = "prefix+alt+g"\n# type = "popup"\n# command = "lazygit"\n\n[ui]\n# other = "prefix+a"\n`;

test("prefix+a is what the first run offers, and the next free key when the config already binds it", () => {
  const defs = K.parseDefaults(DEFAULT_CONFIG);
  assert.deepEqual(defs, { prefix: "ctrl+b", workspace_picker: "prefix+w", switch_tab: "prefix+1..9", split_horizontal: "prefix+minus", reload_config: "prefix+shift+r" }); // not the commented example, not another table
  assert.equal(K.parseDefaults("nothing here"), null);
  assert.deepEqual(K.suggest("", defs), { key: "prefix+a", note: "" });
  assert.deepEqual(K.suggest(""), { key: "prefix+a", note: "" }); // herdr could not be asked: its 0.9.3 keys are known anyway
  assert.deepEqual(K.suggest(`[[keys.command]]\nkey = 'Prefix+A'\ntype = "popup"\ncommand = "lazygit"\n`, defs), { key: "prefix+y", note: "prefix+a is already bound in your config (lazygit), so this is the next free key." });
  assert.deepEqual(K.suggest(`[keys]\nnew_tab = "prefix+a"\nnext_agent = "prefix+y"\n`, defs), { key: "prefix+u", note: "prefix+a is already bound in your config (new tab), so this is the next free key." });
  // however the config writes a binding: a list of keys, a command with several keys, single quotes
  assert.equal(K.suggest(`[keys]\nnew_tab = ["prefix+c", "prefix+a"]\n`, defs).key, "prefix+y");
  assert.equal(K.suggest(`[keys]\nprefix = ["ctrl+b", "prefix+a"]\nextra_prefixes = ["prefix+y"]\n`, defs).key, "prefix+u");
  assert.deepEqual(K.suggest(`[[keys.command]]\nkey = ["prefix+g", "prefix+a"]\ntype = "popup"\ncommand = "lazygit"\n`, defs), { key: "prefix+y", note: "prefix+a is already bound in your config (lazygit), so this is the next free key." });
  assert.equal(K.suggest(`not toml [\nnew_tab = ["prefix+c", 'prefix+a']\n`, defs).key, "prefix+y");
  const all = K.OFFERED.map((k, i) => `a${i} = "${k}"`).join("\n");
  assert.equal(K.suggest(`[keys]\n${all}\n`, defs).key, ""); // nothing left to offer: the user types one
  for (const k of K.OFFERED) assert.equal(K.check(k, "").ok, true, k); // none of the offered keys is herdr's own
});

test("a key herdr or the user's config uses is refused, with what it does today", () => {
  const defs = K.parseDefaults(DEFAULT_CONFIG);
  assert.deepEqual(K.check("prefix+w", "", defs), { ok: false, msg: "herdr itself uses prefix+w (workspace picker): the board would switch that off. Choose another." });
  assert.equal(K.check("prefix+w", "").ok, false); // also when herdr cannot be asked for its defaults
  assert.equal(K.check("Prefix+W", "", defs).ok, false);
  assert.equal(K.check("prefix+5", "", defs).ok, false); // prefix+1..9 is nine keys
  assert.equal(K.check("prefix+-", "", defs).ok, false); // another spelling of prefix+minus
  assert.equal(K.check("prefix+r+shift", "", defs).ok, false); // the parts in another order
  assert.equal(K.check("ctrl+b", "", defs).ok, false); // the prefix key itself
  // keys herdr binds but does not print in its default config are known all the same, whether or not herdr answers
  assert.equal(K.BUILT_IN.swap_pane_left, "prefix+shift+h"); assert.equal(K.BUILT_IN.copy_mode, "prefix+[");
  const real = K.BUILT_IN;
  assert.deepEqual(K.check("prefix+shift+h", "", real), { ok: false, msg: "herdr itself uses prefix+shift+h (swap pane left): the board would switch that off. Choose another." });
  for (const k of ["prefix+shift+j", "prefix+shift+k", "prefix+shift+l", "prefix+w", "prefix+c", "prefix+tab"]) assert.equal(K.check(k, "", real).ok, false, k);
  // the older [keys.indexed] table binds nine keys, and a list binds each key in it
  assert.match(K.check("ctrl+3", `[keys.indexed]\ntabs = "ctrl"\n`, defs).msg, /ctrl\+3 is already bound in your herdr config \(switch tabs\)/);
  assert.equal(K.check("alt+shift+9", `[keys.indexed]\nworkspaces = "shift+alt"\n`, defs).ok, false);
  assert.match(K.check("prefix+t", `[keys]\nnew_tab = ["prefix+c", "prefix+t"]\n`, defs).msg, /already bound in your herdr config \(new tab\)/);
  assert.equal(K.check("prefix+f", `[keys]\nfullscreen = ["prefix+f"]\n`, real).ok, false); assert.equal(K.check("prefix+z", `[keys]\nfullscreen = ["prefix+f"]\n`, real).ok, true); // zoom's older name
  assert.match(K.check("prefix w", "", defs).msg, /is not a key herdr understands/);
  assert.match(K.check("prefix+", "", defs).msg, /is not a key herdr understands/);
  const conf = `[keys]\nworkspace_picker = "prefix+o"\n\n[[keys.command]]\nkey = "prefix+g"\ntype = "popup"\ncommand = "lazygit"\ndescription = "git"\n`;
  assert.deepEqual(K.check("prefix+g", conf, defs, "~/.config/herdr/config.toml"), { ok: false, msg: "prefix+g is already bound in ~/.config/herdr/config.toml (git): the board would replace it. Choose another." });
  assert.match(K.check("prefix+o", conf, defs).msg, /already bound in your herdr config \(workspace picker\)/);
  assert.equal(K.check("prefix+w", conf, defs).ok, true); // the user moved herdr's action off it: the key is free
  assert.equal(K.check("prefix+a", conf, defs).ok, true);
  // the board's own binding is not "taken", and a config that cannot be read still has its keys found
  assert.equal(K.used(`[[keys.command]]\nkey = "prefix+a"\ntype = "plugin_action"\ncommand = "herdr-superwork.open"\n`, defs).has("prefix+a"), false);
  assert.equal(K.check("prefix+g", `this is = not toml [\nkey = "prefix+g"\n`, defs).ok, false);
  assert.equal(K.check("prefix+w", `this is = not toml [\nworkspace_picker = ""\n`, defs).ok, false);
});
