//! The board's own colours, picked to fit the theme: "review", the blue of a review that is running, and "auto", the
//! purple of an automation. Each is the theme's own colour of that hue where it is one and told apart from all it sits
//! beside; else the first of the board's own that is; else the one furthest from them.
use super::greys::{apart, rgb};
use super::{Pal, C};

pub const REVIEW_APART: f64 = 60.0;
pub const REVIEW_BLUE: u32 = 0x3b82f6;
const REVIEW_BLUES: [u32; 6] = [REVIEW_BLUE, 0x1d4ed8, 0x93c5fd, 0x0000ff, 0x6366f1, 0x0ea5e9];
/// Is it a blue at all? By its hue, from the blue-green side of cyan to the edge of violet, and not a grey.
pub fn is_blue(c: C) -> bool {
    let Some(x) = c.drawn() else { return false };
    let [r, g, b] = rgb(x);
    let spread = b - r.min(g);
    let hue = 60.0 * (4.0 + (r - g) / if spread == 0.0 { 1.0 } else { spread });
    b > r && b > g && spread >= 40.0 && (185.0..=255.0).contains(&hue)
}
fn least(c: C, beside: &[C]) -> f64 { beside.iter().map(|k| apart(c, *k)).fold(f64::INFINITY, f64::min) }
fn furthest(all: &[C], beside: &[C]) -> C { all.iter().copied().fold(None, |best: Option<C>, c| match best { Some(b) if least(b, beside) >= least(c, beside) => Some(b), _ => Some(c) }).unwrap_or(C::Own) }
/// "review": green says only "passed" or "ready" and amber only "the agent works", so a running review is a blue: the
/// theme's own where it is a blue told apart from green, red, amber, teal, the greys, text and background.
pub const REVIEW_BESIDE: [&str; 8] = ["green", "red", "yellow", "teal", "subtext0", "overlay0", "text", "panel_bg"];
pub fn review_blue(p: &Pal) -> C {
    let beside = REVIEW_BESIDE.map(|k| p.get(k));
    let fits = |c: C| is_blue(c) && least(c, &beside) >= REVIEW_APART;
    if let Some(c) = std::iter::once(p.blue).chain(REVIEW_BLUES.iter().map(|x| C::Rgb(*x))).find(|c| fits(*c)) { return c; }
    let mut any = vec![];
    for r in [0u32, 64, 128, 192] { for g in [0u32, 64, 128, 192] { for b in [160u32, 208, 255] { let c = C::Rgb(r << 16 | g << 8 | b); if is_blue(c) { any.push(c); } } } }
    furthest(&any, &beside)
}
pub const AUTO_APART: f64 = 40.0;
const PURPLES: [u32; 5] = [0xa855f7, 0xc084fc, 0x7c3aed, 0x6d28d9, 0xd946ef];
pub fn is_purple(c: C) -> bool {
    let Some(x) = c.drawn() else { return false };
    let [r, g, b] = rgb(x);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let spread = max - min;
    let s = if spread == 0.0 { 1.0 } else { spread };
    let h = if max == r { ((g - b) / s) % 6.0 } else if max == g { (b - r) / s + 2.0 } else { (r - g) / s + 4.0 };
    let hue = (60.0 * h + 360.0) % 360.0;
    g < r && g < b && spread >= 30.0 && (250.0..=345.0).contains(&hue)
}
fn is_light(c: u32) -> bool { let [r, g, b] = rgb(c); 0.2126 * r + 0.7152 * g + 0.0722 * b > 140.0 }
/// "auto": no task's state has it. The theme's own mauve where that is a purple told apart from every status colour,
/// the greys, text and background; among the terminal's own 16 colours, its magenta; else one of the board's purples.
pub const AUTO_BESIDE: [&str; 10] = ["red", "green", "yellow", "teal", "review", "todo", "text", "subtext0", "overlay0", "panel_bg"];
pub fn auto_purple(p: &Pal) -> C {
    let beside = AUTO_BESIDE.map(|k| p.get(k));
    let fits = |c: C| is_purple(c) && least(c, &beside) >= AUTO_APART;
    if fits(p.mauve) { return p.mauve; }
    if [p.mauve, p.text].iter().any(|c| c.real().is_none()) && fits(C::Ansi(5)) { return C::Ansi(5); }
    let light = p.panel_bg.real().map(is_light).unwrap_or(false);
    let own: Vec<C> = if light { PURPLES[2..].iter().chain(PURPLES.iter()).map(|x| C::Rgb(*x)).collect() } else { PURPLES.iter().map(|x| C::Rgb(*x)).collect() };
    own.iter().copied().find(|c| fits(*c)).unwrap_or_else(|| furthest(&own, &beside))
}

