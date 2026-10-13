// The board inside the herdr web UI, asked about once: with that plugin installed and its link shared, the board asks
// whether the link may go through its front door, which is what puts the Board into the web UI (docs/web-ui.md).
// Yes does it; no leaves the link alone for good; later asks again the next time the board opens.

export class WebUi {
  askWebUi() {
    if (this.webUiAsked || this.ask || this.setup || this.menu || process.env.HERDR_SUPERWORK_INLINE === "1") return;
    this.webUiAsked = true; // one look per open board: looking asks herdr and Tailscale
    (this.ctx.webUi ? Promise.resolve(this.ctx.webUi) : import("../../webui/command.js")).then(async (W) => {
      const st = await W.offer();
      if (!st || this.disposed || this.ask || this.setup) { if (st) this.webUiAsked = false; return; }
      const url = st.links.direct.map((e) => e.url).join(", ");
      this.confirm("Show this board in the herdr web UI?", () => {
        W.linkNow().then((r) => { this.flash(r.msg, r.ok ? "green" : "red"); this.tui.requestRender(); }, (e) => { this.flash(e.message, "red"); this.tui.requestRender(); });
        this.flash("Pointing the web UI's link at the board's front door…");
      }, null, {
        detail: `The web UI's link (${url}) then goes through a small front door of the board's own, on this machine only. It passes everything on to the web UI untouched and adds a Board entry to its menu. The login stays the web UI's. \`herdr-superwork web-ui unlink\` points the link back.`,
        no: () => { W.decline(); this.flash("Left as it is. `herdr-superwork web-ui link` does it later."); },
        keys: [["sayYes", "yes"], ["sayNo", "no"], ["back", "later"]],
      });
      this.tui.requestRender();
    }).catch(() => {});
  }
}
export const part = WebUi; // what this file adds to the board: view.js loads every file here that names its part
