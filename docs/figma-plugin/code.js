/**
 * StudyFlow — Screens builder (local Figma plugin).
 *
 * Rebuilds page "03 Screens" from the shipped app. Run it as a local
 * development plugin; see README.md.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Pages "01 Foundations" and "02 Components" were built through the Figma
 * MCP and are correct, so this script does not touch them. It reads the
 * variables and text styles they created and reuses them, which is why every
 * colour here is a bound variable rather than a hex literal.
 *
 * ── Full-height screens ──────────────────────────────────────────────────
 * Screens are NOT fixed to a viewport. Each frame is 1440 wide and hugs its
 * content vertically, so a page that scrolls in the browser is shown in full
 * rather than clipped at 1080. The sidebar stretches to match via
 * layoutSizingVertical = "FILL", so the shell still reads as one screen.
 *
 * ── Plugin API only ──────────────────────────────────────────────────────
 * figma.createAutoLayout(), node.set() and node.query() are conveniences the
 * MCP's use_figma sandbox adds; they do not exist in the real Plugin API.
 * Everything here uses createFrame() + layoutMode directly.
 */

// ─────────────────────────────────────────────────────────────
// Lookups populated at run time from what already exists
// ─────────────────────────────────────────────────────────────
var V = {};   // colour variables by short name
var S = {};   // text styles by name

var HEX = {
  fg: "#121720", muted: "#626973", inv: "#f9fafb",
  deficit: "#c43d22", surplus: "#0a776b", white: "#ffffff"
};

function rgb(hex) {
  var h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}

/** A paint bound to a StudyFlow colour variable, or a literal if it's a hex. */
function paint(token) {
  if (token && token.charAt(0) === "#") return { type: "SOLID", color: rgb(token) };
  var base = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  if (V[token]) {
    try { return figma.variables.setBoundVariableForPaint(base, "color", V[token]); }
    catch (e) { /* fall through */ }
  }
  return base;
}

/**
 * An auto-layout frame.
 *   dir  "v" | "h"
 *   o    gap, pad/padX/padY, radius, bg, border, align, justify, w, h,
 *        grow (fill main axis), stretch (fill counter axis)
 */
function AL(parent, name, dir, o) {
  o = o || {};
  var f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir === "h" ? "HORIZONTAL" : "VERTICAL";
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  f.itemSpacing = o.gap || 0;
  var p = o.pad || 0;
  f.paddingTop = f.paddingBottom = o.padY != null ? o.padY : p;
  f.paddingLeft = f.paddingRight = o.padX != null ? o.padX : p;
  f.cornerRadius = o.radius || 0;
  f.fills = o.bg ? [paint(o.bg)] : [];
  if (o.border) { f.strokes = [paint(o.border)]; f.strokeWeight = 1; }
  if (o.align) f.counterAxisAlignItems = o.align;
  if (o.justify) f.primaryAxisAlignItems = o.justify;
  if (parent) parent.appendChild(f);
  // resize() resets both axes to FIXED, so it must come before the sizing calls.
  if (o.w || o.h) f.resize(o.w || f.width || 1, o.h || f.height || 1);
  if (o.w) f.layoutSizingHorizontal = "FIXED"; else if (parent) f.layoutSizingHorizontal = "HUG";
  if (o.h) f.layoutSizingVertical = "FIXED"; else f.layoutSizingVertical = "HUG";
  if (parent && o.grow) f.layoutGrow = 1;
  if (parent && o.stretch) f.layoutAlign = "STRETCH";
  return f;
}

/** Edge-only stroke helper — Figma needs every side set explicitly. */
function edge(node, side) {
  node.strokes = [paint("border")];
  node.strokeWeight = 1;
  node.strokeTopWeight = side === "top" ? 1 : 0;
  node.strokeBottomWeight = side === "bottom" ? 1 : 0;
  node.strokeLeftWeight = side === "left" ? 1 : 0;
  node.strokeRightWeight = side === "right" ? 1 : 0;
}

function TXT(parent, chars, styleName, token, o) {
  o = o || {};
  var t = figma.createText();
  t.characters = String(chars);
  if (S[styleName]) t.textStyleId = S[styleName].id;
  if (token) t.fills = [paint(token)];
  if (parent) parent.appendChild(t);
  if (o.w) { t.textAutoResize = "HEIGHT"; t.resize(o.w, t.height); }
  if (o.stretch) { t.textAutoResize = "HEIGHT"; t.layoutAlign = "STRETCH"; }
  if (o.grow) t.layoutGrow = 1;
  if (o.align) t.textAlignHorizontal = o.align;
  return t;
}

var ICON = {
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/>',
  cal: '<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chart: '<path d="M3 3v18h18M7 16l4-5 4 3 5-7"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cap: '<path d="m2 10 10-5 10 5-10 5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chev: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  alert: '<path d="m21.7 18-9-15a1.9 1.9 0 0 0-3.4 0l-9 15A1.9 1.9 0 0 0 2 21h20a1.9 1.9 0 0 0 1.7-3Z"/><path d="M12 9v4m0 4h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6l8-3 8 3Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  filter: '<path d="M3 6h18M7 12h10M11 18h2"/>',
  sort: '<path d="m3 16 4 4 4-4M7 20V4m6 0 4 4 4-4M17 4v16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>'
};

function IC(parent, key, size, hex) {
  var n = figma.createNodeFromSvg(
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' +
    hex + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    (ICON[key] || ICON.grid) + "</svg>");
  n.name = "icon/" + key;
  n.resize(size, size);
  if (parent) parent.appendChild(n);
  return n;
}

function GOOGLE(parent, size) {
  var n = figma.createNodeFromSvg(
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48">' +
    '<path fill="#FFC107" d="M43.6 20H42v-.1H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-4z"/>' +
    '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>' +
    '<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>' +
    '<path fill="#1976D2" d="M43.6 20H42v-.1H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C40 39.2 44 34 44 24c0-1.3-.1-2.7-.4-4z"/></svg>');
  n.name = "icon/google";
  n.resize(size, size);
  if (parent) parent.appendChild(n);
  return n;
}

// ─────────────────────────────────────────────────────────────
// Shared chrome
// ─────────────────────────────────────────────────────────────
var NAV = [
  ["Dashboard", "grid"], ["Tasks", "list"], ["Calendar", "cal"],
  ["Availability", "clock"], ["Progress", "chart"], ["Settings", "cog"]
];
var SCREEN_W = 1440;
var GAP_X = 120;

/**
 * The app shell. Height is driven by the content column and the sidebar
 * stretches to match, so the frame is exactly as tall as the page really is.
 */
function shell(page, active, x) {
  var sh = AL(null, "Screen / " + active, "h", { bg: "background" });
  page.appendChild(sh);
  sh.resize(SCREEN_W, 400);
  sh.layoutSizingHorizontal = "FIXED";
  sh.layoutSizingVertical = "HUG";
  sh.x = x;
  sh.y = 160;
  sh.clipsContent = true;

  var sb = AL(sh, "Sidebar", "v", { bg: "sidebar", justify: "SPACE_BETWEEN", w: 256 });
  sb.layoutSizingVertical = "FILL";
  edge(sb, "right");
  sb.strokes = [paint("sidebar-border")];

  var top = AL(sb, "top", "v", { gap: 4, padX: 12, padY: 16, stretch: true });

  var brand = AL(top, "brand", "h", { gap: 10, padX: 8, padY: 8, align: "CENTER" });
  var mark = AL(brand, "mark", "h", { bg: "primary", radius: 8, align: "CENTER", justify: "CENTER", w: 32, h: 32 });
  IC(mark, "cap", 16, HEX.inv);
  TXT(brand, "StudyFlow", "Display/lg", "foreground");

  AL(top, "sp", "v", { h: 12 });
  TXT(top, "Menu", "Label", "muted-foreground");

  for (var i = 0; i < NAV.length; i++) {
    if (i === 5) {
      AL(top, "sp2", "v", { h: 12 });
      TXT(top, "Account", "Label", "muted-foreground");
    }
    var on = NAV[i][0] === active;
    var row = AL(top, "nav/" + NAV[i][0], "h", {
      gap: 12, padX: 12, padY: 10, radius: 8, align: "CENTER",
      bg: on ? "primary" : null, stretch: true
    });
    IC(row, NAV[i][1], 16, on ? HEX.inv : HEX.muted);
    TXT(row, NAV[i][0], on ? "Body/Base Medium" : "Body/Base",
        on ? "primary-foreground" : "muted-foreground");
  }

  var foot = AL(sb, "account", "h", { gap: 10, pad: 12, align: "CENTER", stretch: true });
  edge(foot, "top");
  foot.strokes = [paint("sidebar-border")];
  var av = AL(foot, "avatar", "h", { bg: "primary", radius: 8, align: "CENTER", justify: "CENTER", w: 32, h: 32 });
  TXT(av, "MH", "Caption", "primary-foreground");
  var who = AL(foot, "who", "v", { gap: 1, grow: true });
  TXT(who, "Meng Heang", "Body/Small", "foreground");
  TXT(who, "demo@studyflow.app", "Caption", "muted-foreground");
  IC(foot, "chev", 14, HEX.muted);

  var main = AL(sh, "main", "v", { grow: true });
  main.layoutSizingVertical = "HUG";

  var header = AL(main, "header", "h", { padX: 24, gap: 12, align: "CENTER", bg: "card", h: 64, stretch: true });
  edge(header, "bottom");
  var finder = AL(header, "finder", "h", {
    gap: 8, padX: 12, radius: 8, bg: "card", border: "input", align: "CENTER", w: 380, h: 36
  });
  IC(finder, "search", 16, HEX.muted);
  TXT(finder, "Find a task", "Body/Small", "muted-foreground");

  var content = AL(main, "content", "v", { gap: 24, pad: 32, stretch: true });
  return content;
}

function pageHead(ct, title, desc, actions) {
  var h = AL(ct, "PageHeader", "h", { gap: 16, stretch: true });
  var l = AL(h, "t", "v", { gap: 4, grow: true });
  TXT(l, title, "Display/2xl", "foreground");
  if (desc) TXT(l, desc, "Body/Base", "muted-foreground", { w: 620 });
  if (actions) {
    var a = AL(h, "a", "h", { gap: 8 });
    for (var i = 0; i < actions.length; i++) {
      var last = i === actions.length - 1;
      var b = AL(a, "btn", "h", {
        padX: 14, padY: 9, radius: 8, align: "CENTER",
        bg: last ? "primary" : "card", border: last ? null : "border"
      });
      TXT(b, actions[i], "Label", last ? "primary-foreground" : "foreground");
    }
  }
  return h;
}

function secHead(ct, title, meta, tone) {
  var h = AL(ct, "SectionHeader", "h", { align: "CENTER", stretch: true });
  h.paddingBottom = 8;
  edge(h, "bottom");
  TXT(h, title, "Display/lg", "foreground", { grow: true });
  if (meta) TXT(h, meta, "Label", tone || "muted-foreground");
  return h;
}

function tiles(ct, arr) {
  var s = AL(ct, "stats", "h", { gap: 12, stretch: true });
  for (var i = 0; i < arr.length; i++) {
    var t = arr[i];
    var tile = AL(s, "StatTile", "v", { gap: 8, pad: 16, radius: 12, bg: "card", border: "border", grow: true });
    var h = AL(tile, "h", "h", { gap: 8, align: "CENTER", stretch: true });
    IC(h, t[0], 16, t[4] === "deficit" ? HEX.deficit : (t[4] === "surplus" ? HEX.surplus : HEX.muted));
    TXT(h, t[1], "Label", "muted-foreground");
    TXT(tile, t[2], "Display/2xl", t[3]);
    if (t[5]) TXT(tile, t[5], "Caption", "muted-foreground");
  }
  return s;
}

function listRow(parent, title, sub, cells) {
  var row = AL(parent, "row", "h", { gap: 16, padY: 12, align: "CENTER", stretch: true });
  edge(row, "bottom");
  var m = AL(row, "m", "v", { gap: 2, grow: true });
  TXT(m, title, "Body/Base Medium", "foreground");
  if (sub) TXT(m, sub, "Body/Small", "muted-foreground");
  for (var i = 0; i < cells.length; i++) {
    TXT(row, cells[i][0], cells[i][2] || "Data", cells[i][1] || "muted-foreground",
        cells[i][3] ? { w: cells[i][3], align: "RIGHT" } : undefined);
  }
  return row;
}

/**
 * A progress track. Pass a number for a fixed width, or "fill" to stretch to
 * the parent — a hardcoded width wider than its container silently overflows,
 * which is easy to miss because Figma just lets it hang outside the frame.
 */
function bar(parent, w, ratio, trackTok, fillTok) {
  var tr;
  if (w === "fill") {
    tr = AL(parent, "bar", "h", { bg: trackTok, radius: 999, stretch: true, h: 6 });
  } else {
    tr = AL(parent, "bar", "h", { bg: trackTok, radius: 999, w: w, h: 6 });
  }
  if (ratio > 0) {
    // The fill is a percentage of the track, so it follows a stretched parent.
    var fillW = w === "fill" ? Math.max(4, tr.width * ratio) : Math.max(4, w * ratio);
    AL(tr, "fill", "h", { bg: fillTok, radius: 999, w: fillW, h: 6 });
  }
  return tr;
}

function btn(parent, label, primary) {
  var b = AL(parent, "btn", "h", {
    padX: 12, padY: 7, radius: 8, align: "CENTER",
    bg: primary ? "primary" : "card", border: primary ? null : "border"
  });
  TXT(b, label, "Label", primary ? "primary-foreground" : "foreground");
  return b;
}

function callout(ct, tone, title, body) {
  var map = {
    info: ["info", HEX.muted, "foreground"],
    warning: ["alert", HEX.deficit, "foreground"],
    danger: ["alert", HEX.deficit, "deficit"],
    success: ["check", HEX.surplus, "foreground"]
  }[tone];
  var c = AL(ct, "Callout", "h", { gap: 12, pad: 16, radius: 12, bg: "card", border: "border", stretch: true });
  IC(c, map[0], 16, map[1]);
  var b = AL(c, "b", "v", { gap: 4, grow: true });
  TXT(b, title, "Body/Base Medium", map[2], { stretch: true });
  if (body) TXT(b, body, "Body/Small", "muted-foreground", { stretch: true });
  return c;
}

// ─────────────────────────────────────────────────────────────
// Screens
// ─────────────────────────────────────────────────────────────
function screenDashboard(page, x) {
  var ct = shell(page, "Dashboard", x);
  pageHead(ct, "Hello, Meng", "Whether your coursework fits the time you have.");

  var up = AL(ct, "Up next", "h", { gap: 24, pad: 20, radius: 12, bg: "card", border: "border", align: "CENTER", stretch: true });
  var ul = AL(up, "l", "v", { gap: 2, grow: true });
  TXT(ul, "Up next", "Label", "muted-foreground");
  TXT(ul, "Calculus II — Problem Set 6", "Display/xl", "foreground");
  TXT(ul, "Today at 19:07 · 1h", "Body/Small", "muted-foreground");
  var ur = AL(up, "r", "v", { gap: 2, align: "MAX" });
  TXT(ur, "Left to study today", "Label", "muted-foreground");
  TXT(ur, "1h 30m", "Display/xl", "foreground");

  var vd = AL(ct, "Capacity", "v", { gap: 14, pad: 24, radius: 12, bg: "card", border: "border", stretch: true });
  var vh = AL(vd, "h", "h", { gap: 12, align: "CENTER", stretch: true });
  TXT(vh, "Capacity over the next", "Body/Small", "muted-foreground", { grow: true });
  var seg = AL(vh, "range", "h", { gap: 2, pad: 2, radius: 8, bg: "muted" });
  ["7 days", "14 days", "30 days"].forEach(function (r, i) {
    var b = AL(seg, "r", "h", { padX: 10, padY: 5, radius: 6, bg: i === 0 ? "card" : null });
    TXT(b, r, "Label", i === 0 ? "foreground" : "muted-foreground");
  });
  TXT(vd, "8h short", "Display/Hero", "deficit");
  TXT(vd, "5 tasks do not fit in the study time you have over the next 7 days.", "Body/Base", "muted-foreground", { stretch: true });
  var cb = AL(vd, "CapacityBar", "h", { stretch: true, h: 34 });
  AL(cb, "track", "h", { bg: "deficit-soft", border: "border", radius: 6, w: 720, h: 34 });
  AL(cb, "overflow", "h", { bg: "deficit", radius: 6, w: 210, h: 34 });
  var lg = AL(vd, "legend", "h", { stretch: true });
  TXT(lg, "24h 30m of work to do", "Label", "muted-foreground", { grow: true });
  TXT(lg, "16h 30m of study time", "Label", "muted-foreground");

  tiles(ct, [
    ["clock", "Free today", "2h 35m", "foreground", "muted"],
    ["cal", "Study time each week", "21h 30m", "foreground", "muted"],
    ["list", "Work still to do", "37h 50m", "foreground", "muted", "13h 24m unplanned"],
    ["alert", "Tasks that don’t fit", "5", "deficit", "deficit"]
  ]);

  // Weekly effort progress (SPEC §13)
  var we = AL(ct, "This week's effort", "v", { gap: 10, pad: 16, radius: 12, bg: "card", border: "border", stretch: true });
  var wh = AL(we, "h", "h", { gap: 12, align: "CENTER", stretch: true });
  TXT(wh, "This week’s effort", "Body/Base Medium", "foreground", { grow: true });
  TXT(wh, "40m worked of 11h 25m planned", "Label", "muted-foreground");
  bar(we, "fill", 0.06, "muted", "foreground");
  TXT(we, "Effort means time put in, not how much of the work is finished.", "Body/Small", "muted-foreground", { stretch: true });

  var cols = AL(ct, "cols", "h", { gap: 28, stretch: true });
  var left = AL(cols, "deadlines", "v", { grow: true });
  secHead(left, "Upcoming deadlines", "next 7 days");
  [["Thermodynamics lab report", "Assignment · PHYS 240", "4h", "Tomorrow", "deficit"],
   ["Calculus II — Problem Set 6", "Assignment · MATH 201", "5h", "2d", "deficit"],
   ["Data Structures midterm", "Exam prep · CS 210", "10h", "4d", null],
   ["Statistics reading, ch. 7–9", "Reading · STAT 130", "2h 30m", "5d", null],
   ["Khmer Literature essay draft", "Assignment · LIT 110", "3h", "6d", null]
  ].forEach(function (r) {
    listRow(left, r[0], r[1], [[r[2]], [r[3], r[4] || "muted-foreground", "Label"]]);
  });

  var right = AL(cols, "overload", "v", { w: 430 });
  secHead(right, "Tasks that don’t fit", "5 of 10", "deficit");
  var stack = AL(right, "stack", "v", { gap: 12, stretch: true });
  stack.paddingTop = 12;
  [["Calculus II — Problem Set 6", "1h 55m short", "Needs 5h · only 3h 5m free before Aug 26", 0.62],
   ["Data Structures midterm", "10h short", "Needs 10h · only 0m free before Aug 28", 0],
   ["Statistics reading, ch. 7–9", "2h 30m short", "Needs 2h 30m · only 0m free before Aug 29", 0]
  ].forEach(function (o) {
    var c = AL(stack, "ShortfallCard", "v", { gap: 8, pad: 16, radius: 12, bg: "card", border: "border", stretch: true });
    var h = AL(c, "h", "h", { gap: 10, align: "CENTER", stretch: true });
    IC(h, "alert", 16, HEX.deficit);
    TXT(h, o[0], "Body/Base Medium", "foreground", { grow: true });
    TXT(h, o[1], "Display/lg", "deficit");
    bar(c, 366, o[3], "deficit-soft", "deficit");
    TXT(c, o[2], "Body/Small", "muted-foreground", { stretch: true });
    var acts = AL(c, "acts", "h", { gap: 8 });
    btn(acts, "Extend deadline"); btn(acts, "Add study time");
  });

  // Unscheduled work (SPEC §5.4)
  secHead(ct, "Work with no slot", "3 to resolve", "deficit");
  var uw = AL(ct, "unscheduled", "v", { gap: 8, stretch: true });
  [["Data Structures midterm", "10h unplaced", "There is not enough free study time before its deadline."],
   ["Statistics reading, ch. 7–9", "2h 30m unplaced", "Blocked by Family trip to Siem Reap."]
  ].forEach(function (u) {
    var c = AL(uw, "item", "v", { gap: 6, pad: 12, radius: 12, bg: "card", border: "border", stretch: true });
    var h = AL(c, "h", "h", { gap: 12, align: "CENTER", stretch: true });
    TXT(h, u[0], "Body/Base Medium", "foreground", { grow: true });
    TXT(h, u[1], "Label", "deficit");
    TXT(c, u[2], "Body/Small", "muted-foreground", { stretch: true });
    var a = AL(c, "a", "h", { gap: 8 });
    btn(a, "Change deadline"); btn(a, "Add study time");
  });
  return ct;
}

function screenTasks(page, x) {
  var ct = shell(page, "Tasks", x);
  pageHead(ct, "Tasks", "Everything you owe, with deadlines and estimates.", ["Add task"]);

  var tb = AL(ct, "toolbar", "h", { gap: 8, align: "CENTER", stretch: true });
  var sr = AL(tb, "search", "h", { gap: 8, padX: 12, radius: 8, bg: "card", border: "input", align: "CENTER", grow: true, h: 40 });
  IC(sr, "search", 16, HEX.muted);
  TXT(sr, "Search tasks", "Body/Base", "muted-foreground");
  [["sort", "Soonest first"], ["filter", "Filters"]].forEach(function (b) {
    var x2 = AL(tb, "b", "h", { gap: 6, padX: 14, radius: 8, bg: "card", border: "border", align: "CENTER", h: 40 });
    IC(x2, b[0], 16, HEX.muted);
    TXT(x2, b[1], "Label", "foreground");
  });

  var tbl = AL(ct, "Ledger", "v", { radius: 12, bg: "card", border: "border", stretch: true });
  var th = AL(tbl, "head", "h", { gap: 16, padX: 24, padY: 10, bg: "muted", stretch: true });
  TXT(th, "Task", "Label", "muted-foreground", { grow: true });
  TXT(th, "Due", "Label", "muted-foreground", { w: 80 });
  TXT(th, "Left", "Label", "muted-foreground", { w: 60 });
  TXT(th, "Status", "Label", "muted-foreground", { w: 100 });
  [["Thermodynamics lab report", "Assignment · PHYS 240", "Tomorrow", "4h", "Not started", "deficit"],
   ["Calculus II — Problem Set 6", "High · Assignment · MATH 201", "2d", "5h", "Not started", "deficit"],
   ["Data Structures midterm", "High · Exam prep · CS 210", "4d", "10h", "Not started", null],
   ["Statistics reading, ch. 7–9", "Reading · STAT 130", "5d", "2h 30m", "Not started", null],
   ["Khmer Literature essay draft", "Assignment · LIT 110", "6d", "3h", "Not started", null],
   ["Linear Algebra quiz revision", "Exam prep · MATH 205", "Sep 2", "2h", "Not started", null],
   ["Group project — API integration", "High · Project · CS 260", "Sep 5", "8h", "Not started", null],
   ["Ethics seminar presentation", "Research · PHIL 150", "Sep 9", "3h 20m", "Not started", null],
   ["Algorithms final revision", "Exam prep · CS 300", "Sep 15", "2h 24m", "Not started", null]
  ].forEach(function (r) {
    var row = AL(tbl, "row", "h", { gap: 16, padX: 24, padY: 12, align: "CENTER", stretch: true });
    edge(row, "bottom");
    var m = AL(row, "m", "v", { gap: 2, grow: true });
    TXT(m, r[0], "Body/Base Medium", "foreground");
    TXT(m, r[1], "Body/Small", "muted-foreground");
    TXT(row, r[2], "Label", r[5] || "muted-foreground", { w: 80 });
    TXT(row, r[3], "Data", "muted-foreground", { w: 60 });
    TXT(row, r[4], "Body/Small", "muted-foreground", { w: 100 });
  });
  return ct;
}

function screenCalendar(page, x) {
  var ct = shell(page, "Calendar", x);
  pageHead(ct, "Aug 24 – Aug 30, 2026",
    "Your sessions and deadlines against the study time each day actually holds.",
    ["This week", "Plan my time"]);
  tiles(ct, [
    ["clock", "Free this week", "16h 30m", "surplus", "surplus"],
    ["cal", "Study planned", "11h 25m", "foreground", "muted"],
    ["cal", "Blocked", "5h", "foreground", "muted", "By your exceptions"],
    ["list", "Deadlines here", "6", "deficit", "deficit"]
  ]);

  var DAYS = ["MON 24", "TUE 25", "WED 26", "THU 27", "FRI 28", "SAT 29", "SUN 30"];
  var grid = AL(ct, "WeekGrid", "v", { radius: 12, bg: "card", border: "border", stretch: true });
  var gh = AL(grid, "head", "h", { stretch: true });
  edge(gh, "bottom");
  AL(gh, "gutter", "v", { w: 56, h: 58 });
  DAYS.forEach(function (d, i) {
    var c = AL(gh, "day", "v", { gap: 2, padY: 10, align: "CENTER", grow: true, bg: i === 0 ? "muted" : null });
    var p = d.split(" ");
    TXT(c, p[0], "Caption", i === 0 ? "foreground" : "muted-foreground");
    var n = AL(c, "n", "h", { radius: 999, align: "CENTER", justify: "CENTER", bg: i === 0 ? "primary" : null, w: 24, h: 24 });
    TXT(n, p[1], "Body/Small", i === 0 ? "primary-foreground" : "foreground");
  });

  var gb = AL(grid, "body", "h", { stretch: true, h: 460 });
  var hrs = AL(gb, "hours", "v", { w: 56 });
  hrs.layoutSizingVertical = "FILL";
  ["8am", "10am", "12pm", "2pm", "4pm", "6pm", "8pm"].forEach(function (h) {
    var c = AL(hrs, "h", "h", { padX: 8, justify: "MAX", stretch: true, h: 65 });
    TXT(c, h, "Data", "muted-foreground");
  });
  var SESS = {
    0: [[260, 58, "Thermodynamics", "18:20"]],
    1: [[260, 58, "Calculus II", "18:00"]],
    5: [[40, 58, "Statistics", "09:00"], [200, 58, "Khmer Lit.", "14:00"]],
    6: [[105, 58, "Linear Algebra", "11:10"]]
  };
  DAYS.forEach(function (d, i) {
    var col = figma.createFrame();
    col.name = "col";
    col.fills = i === 0 ? [paint("muted")] : [];
    edge(col, "left");
    gb.appendChild(col);
    col.layoutGrow = 1;
    col.layoutSizingVertical = "FILL";
    var av = figma.createFrame();
    av.name = "availability";
    av.resize(120, 115); av.x = 6; av.y = i < 5 ? 260 : 40;
    av.cornerRadius = 6;
    av.fills = [paint("surplus-soft")];
    av.strokes = [paint("surplus")]; av.strokeWeight = 1;
    col.appendChild(av);
    (SESS[i] || []).forEach(function (s) {
      var b = figma.createFrame();
      b.name = "session";
      b.layoutMode = "VERTICAL"; b.itemSpacing = 2;
      b.paddingLeft = b.paddingRight = 6; b.paddingTop = 5;
      b.resize(112, s[1]); b.x = 10; b.y = s[0];
      b.cornerRadius = 6;
      b.fills = [paint("card")];
      b.strokes = [paint("foreground")]; b.strokeWeight = 1;
      col.appendChild(b);
      TXT(b, s[2], "Caption", "foreground");
      TXT(b, s[3], "Data", "muted-foreground");
    });
  });

  secHead(ct, "Upcoming deadlines", "7 in the next 14 days");
  [["Tue, 25 Aug · 23:59", "Thermodynamics lab report", "Assignment", "4h", "Tomorrow", "deficit"],
   ["Wed, 26 Aug · 23:59", "Calculus II — Problem Set 6", "Assignment", "5h", "2d", "deficit"],
   ["Fri, 28 Aug · 23:59", "Data Structures midterm", "Exam prep", "10h", "4d", null],
   ["Sat, 29 Aug · 23:59", "Statistics reading, ch. 7–9", "Reading", "2h 30m", "5d", null],
   ["Sun, 30 Aug · 23:59", "Khmer Literature essay draft", "Assignment", "3h", "6d", null]
  ].forEach(function (r) {
    var row = AL(ct, "row", "h", { gap: 16, padY: 12, align: "CENTER", stretch: true });
    edge(row, "bottom");
    TXT(row, r[0], "Data", "muted-foreground", { w: 150 });
    TXT(row, r[1], "Body/Base Medium", "foreground", { grow: true });
    TXT(row, r[2], "Body/Small", "muted-foreground", { w: 90 });
    TXT(row, r[3], "Data", "muted-foreground", { w: 60, align: "RIGHT" });
    TXT(row, r[4], "Label", r[5] || "muted-foreground", { w: 70, align: "RIGHT" });
  });
  return ct;
}

function screenAvailability(page, x) {
  var ct = shell(page, "Availability", x);
  pageHead(ct, "Availability",
    "The hours you are free to study. Everything StudyFlow tells you about your workload is measured against these.",
    ["Add exception", "Add window"]);
  tiles(ct, [
    ["clock", "Weekly study time", "21h 30m", "surplus", "surplus"],
    ["cal", "Weekly windows", "8", "foreground", "muted"],
    ["cal", "Exceptions", "1", "foreground", "muted"]
  ]);

  var cols = AL(ct, "cols", "h", { gap: 24, stretch: true });
  var gcol = AL(cols, "grid", "v", { gap: 12, grow: true });
  TXT(gcol, "Your week", "Display/lg", "foreground");
  TXT(gcol, "The same grid the calendar uses. Hover a window to find it in the list.", "Body/Small", "muted-foreground");
  var ag = AL(gcol, "WeekGrid", "v", { radius: 12, bg: "card", border: "border", stretch: true });
  var agh = AL(ag, "head", "h", { padY: 10, stretch: true });
  edge(agh, "bottom");
  AL(agh, "g", "v", { w: 48, h: 18 });
  ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].forEach(function (d) {
    var c = AL(agh, "d", "h", { justify: "CENTER", grow: true });
    TXT(c, d, "Caption", "muted-foreground");
  });
  var agb = AL(ag, "body", "h", { stretch: true, h: 400 });
  var ahrs = AL(agb, "hours", "v", { w: 48 });
  ahrs.layoutSizingVertical = "FILL";
  ["7am", "9am", "11am", "1pm", "3pm", "5pm", "7pm", "9pm"].forEach(function (h) {
    var c = AL(ahrs, "h", "h", { padX: 6, justify: "MAX", stretch: true, h: 50 });
    TXT(c, h, "Data", "muted-foreground");
  });
  var WIN = { 0: [[220, 60]], 1: [[220, 50]], 2: [[260, 40]], 3: [[220, 60]], 4: [[200, 40]], 5: [[40, 60], [140, 60]], 6: [[60, 60]] };
  [0, 1, 2, 3, 4, 5, 6].forEach(function (i) {
    var col = figma.createFrame();
    col.name = "col"; col.fills = [];
    edge(col, "left");
    agb.appendChild(col);
    col.layoutGrow = 1; col.layoutSizingVertical = "FILL";
    (WIN[i] || []).forEach(function (w) {
      var b = figma.createFrame();
      b.name = "window";
      b.resize(120, w[1]); b.x = 5; b.y = w[0];
      b.cornerRadius = 6;
      b.fills = [paint("surplus-soft")];
      b.strokes = [paint("surplus")]; b.strokeWeight = 1;
      col.appendChild(b);
    });
  });

  var wcol = AL(cols, "windows", "v", { gap: 12, w: 400 });
  var wc = AL(wcol, "Your weekly hours", "v", { radius: 12, bg: "card", border: "border", stretch: true });
  var wh = AL(wc, "h", "h", { padX: 16, padY: 12, align: "CENTER", stretch: true });
  edge(wh, "bottom");
  TXT(wh, "Your weekly hours", "Display/lg", "foreground", { grow: true });
  TXT(wh, "21h 30m a week", "Label", "muted-foreground");
  [["Mon", ["18:00–21:00"], "3h"], ["Tue", ["18:00–20:30"], "2h 30m"],
   ["Wed", ["19:00–21:00"], "2h"], ["Thu", ["18:00–21:00"], "3h"],
   ["Fri", ["17:00–19:00"], "2h"], ["Sat", ["09:00–12:00", "14:00–17:00"], "6h"],
   ["Sun", ["10:00–13:00"], "3h"]
  ].forEach(function (d) {
    var row = AL(wc, "day", "h", { gap: 12, padX: 16, padY: 10, stretch: true });
    edge(row, "bottom");
    TXT(row, d[0], "Label", "foreground", { w: 36 });
    var ch = AL(row, "chips", "h", { gap: 6, grow: true });
    d[1].forEach(function (t) {
      var c = AL(ch, "chip", "h", { padX: 8, padY: 4, radius: 6, bg: "surplus-soft", border: "surplus" });
      TXT(c, t, "Data", "foreground");
    });
    TXT(row, d[2], "Data", "muted-foreground", { w: 56, align: "RIGHT" });
  });

  var ex = AL(wcol, "Exceptions", "v", { gap: 8, pad: 16, radius: 12, bg: "card", border: "border", stretch: true });
  TXT(ex, "Exceptions", "Display/lg", "foreground");
  TXT(ex, "Days you know you cannot study", "Body/Small", "muted-foreground");
  var exr = AL(ex, "row", "h", { gap: 12, pad: 12, radius: 8, bg: "muted", align: "CENTER", stretch: true });
  IC(exr, "cal", 16, HEX.muted);
  var exb = AL(exr, "b", "v", { gap: 2, grow: true });
  TXT(exb, "Family trip to Siem Reap", "Body/Small", "foreground");
  TXT(exb, "Aug 27 – Aug 28", "Caption", "muted-foreground");
  return ct;
}

function screenProgress(page, x) {
  var ct = shell(page, "Progress", x);
  pageHead(ct, "Progress", "How much of your estimated effort you have worked through so far.");
  callout(ct, "info", "What this measures",
    "Effort is the time you have put in against the time you expect to need. It does not say how much of the work is finished, or how good it is.");

  var tot = AL(ct, "totals", "h", { gap: 24, padY: 20, stretch: true });
  tot.strokes = [paint("border")]; tot.strokeWeight = 1;
  tot.strokeTopWeight = 1; tot.strokeBottomWeight = 1;
  tot.strokeLeftWeight = 0; tot.strokeRightWeight = 0;
  [["Tasks", "8"], ["Worked", "40m"], ["Remaining", "34h 25m"],
   ["Sessions done", "0"], ["Sessions to come", "24"]
  ].forEach(function (t) {
    var c = AL(tot, "t", "v", { gap: 4, grow: true });
    TXT(c, t[0], "Label", "muted-foreground");
    TXT(c, t[1], "Display/2xl", "foreground");
  });

  secHead(ct, "By task", "8 total");
  var hdr = AL(ct, "colheads", "h", { gap: 16, padY: 8, stretch: true });
  edge(hdr, "bottom");
  TXT(hdr, "Task", "Label", "muted-foreground", { grow: true });
  TXT(hdr, "Effort", "Label", "muted-foreground", { w: 150 });
  TXT(hdr, "Worked", "Label", "muted-foreground", { w: 60, align: "RIGHT" });
  TXT(hdr, "Left", "Label", "muted-foreground", { w: 60, align: "RIGHT" });
  TXT(hdr, "Sessions", "Label", "muted-foreground", { w: 70, align: "RIGHT" });

  [["Thermodynamics lab report", "Assignment · PHYS 240", 0.53, "53%", "40m", "35m", "0 +4"],
   ["Calculus II — Problem Set 6", "Assignment · MATH 201", 0, "0%", "0m", "5h", "0 +5"],
   ["Data Structures midterm", "Exam prep · CS 210", 0, "0%", "0m", "10h", "0"],
   ["Statistics reading, ch. 7–9", "Reading · STAT 130", 0, "0%", "0m", "2h 30m", "0 +3"],
   ["Khmer Literature essay draft", "Assignment · LIT 110", 0, "0%", "0m", "3h", "0 +3"],
   ["Linear Algebra quiz revision", "Exam prep · MATH 205", 0, "0%", "0m", "2h", "0 +2"],
   ["Group project — API integration", "Project · CS 260", 0, "0%", "0m", "8h", "0 +8"],
   ["Ethics seminar presentation", "Research · PHIL 150", 0, "0%", "0m", "3h 20m", "0 +4"]
  ].forEach(function (r) {
    var row = AL(ct, "row", "h", { gap: 16, padY: 12, align: "CENTER", stretch: true });
    edge(row, "bottom");
    var m = AL(row, "m", "v", { gap: 2, grow: true });
    TXT(m, r[0], "Body/Base Medium", "foreground");
    TXT(m, r[1], "Body/Small", "muted-foreground");
    var bw = AL(row, "bar", "h", { gap: 8, align: "CENTER", w: 150 });
    bar(bw, 100, r[2], "muted", "foreground");
    TXT(bw, r[3], "Data", "muted-foreground");
    TXT(row, r[4], "Data", "muted-foreground", { w: 60, align: "RIGHT" });
    TXT(row, r[5], "Data", "muted-foreground", { w: 60, align: "RIGHT" });
    TXT(row, r[6], "Data", "muted-foreground", { w: 70, align: "RIGHT" });
  });

  secHead(ct, "Session history", "1 recorded");
  var hr = AL(ct, "row", "h", { gap: 16, padY: 12, align: "CENTER", stretch: true });
  edge(hr, "bottom");
  TXT(hr, "Mon 24 Aug · 15:21", "Data", "muted-foreground", { w: 150 });
  TXT(hr, "Thermodynamics lab report", "Body/Base Medium", "foreground", { grow: true });
  var st = AL(hr, "s", "h", { gap: 6, align: "CENTER", w: 110 });
  IC(st, "clock", 14, HEX.muted);
  TXT(st, "Partly done", "Body/Small", "muted-foreground");
  TXT(hr, "40m", "Data", "muted-foreground", { w: 60, align: "RIGHT" });
  return ct;
}

function screenSettings(page, x) {
  var ct = shell(page, "Settings", x);
  pageHead(ct, "Settings", "Your account, and how StudyFlow behaves.");
  var wrap = AL(ct, "wrap", "v", { gap: 24, w: 720 });

  function group(title, ic, rows) {
    var g = AL(wrap, "group", "v", { gap: 8, stretch: true });
    var h = AL(g, "h", "h", { gap: 8, align: "CENTER" });
    IC(h, ic, 16, HEX.muted);
    TXT(h, title, "Body/Small", "muted-foreground");
    var b = AL(g, "rows", "v", { padX: 16, radius: 12, bg: "card", border: "border", stretch: true });
    rows.forEach(function (r, i) {
      var row = AL(b, "row", "h", { gap: 16, padY: 14, align: "CENTER", stretch: true });
      if (i < rows.length - 1) edge(row, "bottom");
      var m = AL(row, "m", "v", { gap: 2, grow: true });
      if (r[4]) {
        var lab = AL(m, "lab", "h", { gap: 8, align: "CENTER" });
        GOOGLE(lab, 20);
        TXT(lab, r[0], "Body/Base Medium", "foreground");
      } else {
        TXT(m, r[0], "Body/Base Medium", "foreground");
      }
      if (r[1]) TXT(m, r[1], "Body/Small", "muted-foreground");
      if (r[2]) {
        var bt = AL(row, "b", "h", {
          gap: 8, padX: r[3] ? 20 : 12, padY: r[3] ? 12 : 7,
          radius: 8, bg: "card", border: "border", align: "CENTER"
        });
        if (r[3]) GOOGLE(bt, 16);
        TXT(bt, r[2], "Label", "foreground");
      }
    });
    return g;
  }

  group("Profile", "user", [
    ["Name", "Meng Heang", "Change"],
    ["Email address", "demo@studyflow.app · Verified"]
  ]);
  group("Signing in", "shield", [
    ["Password", "Last changed when you set it", "Change"],
    ["Google", "Sign in with your Google account", "Connect", true, true]
  ]);
  group("Timezone", "globe", [
    ["Asia/Phnom Penh", "+07:00 · 19:23 right now", "Change"]
  ]);

  var ss = AL(wrap, "study", "v", { gap: 8, stretch: true });
  var ssh = AL(ss, "h", "h", { gap: 8, align: "CENTER" });
  IC(ssh, "clock", 16, HEX.muted);
  TXT(ssh, "Study sessions", "Body/Small", "muted-foreground");
  var ssb = AL(ss, "b", "v", { gap: 20, pad: 16, radius: 12, bg: "card", border: "border", stretch: true });
  [["Longest session", "1h", 0.25, "Work longer than this is split across several sittings."],
   ["Break between sessions", "10m", 0.08, "Set it to zero if you would rather run straight through."]
  ].forEach(function (s) {
    var g2 = AL(ssb, "s", "v", { gap: 8, stretch: true });
    var r = AL(g2, "r", "h", { align: "CENTER", stretch: true });
    TXT(r, s[0], "Body/Base Medium", "foreground", { grow: true });
    TXT(r, s[1], "Display/lg", "foreground");
    bar(g2, 656, s[2], "muted", "foreground");
    TXT(g2, s[3], "Caption", "muted-foreground");
  });

  group("Sign out", "out", [["This device", "Ends your session here only.", "Sign out"]]);
  return ct;
}

function screenSignIn(page, x) {
  var s = AL(null, "Screen / Sign in", "v", { gap: 24, align: "CENTER", justify: "CENTER" });
  page.appendChild(s);
  s.resize(SCREEN_W, 900);
  s.layoutSizingHorizontal = "FIXED";
  s.layoutSizingVertical = "FIXED";
  s.x = x; s.y = 160;
  s.clipsContent = true;
  s.fills = [{
    type: "GRADIENT_LINEAR",
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: 0.467, g: 0.608, b: 0.757, a: 1 } },
      { position: 0.48, color: { r: 0.604, g: 0.749, b: 0.855, a: 1 } },
      { position: 0.8, color: { r: 0.796, g: 0.863, b: 0.925, a: 1 } },
      { position: 1, color: { r: 0.894, g: 0.925, b: 0.953, a: 1 } }
    ]
  }];

  var br = AL(s, "brand", "h", { gap: 10, align: "CENTER" });
  var bm = AL(br, "mark", "h", { radius: 8, align: "CENTER", justify: "CENTER", w: 32, h: 32 });
  bm.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.2 }];
  IC(bm, "cap", 18, HEX.white);
  TXT(br, "StudyFlow", "Display/lg", HEX.white);

  var card = AL(s, "card", "v", { gap: 16, pad: 32, radius: 16, bg: "card", w: 400 });
  TXT(card, "Welcome back", "Display/2xl", "foreground", { stretch: true });
  TXT(card, "Sign in to your StudyFlow account", "Body/Small", "muted-foreground", { stretch: true });
  var gb = AL(card, "google", "h", { gap: 8, radius: 8, bg: "card", border: "border", align: "CENTER", justify: "CENTER", stretch: true, h: 40 });
  GOOGLE(gb, 16);
  TXT(gb, "Continue with Google", "Body/Base Medium", "foreground");
  TXT(card, "or continue with email", "Caption", "muted-foreground", { stretch: true, align: "CENTER" });
  [["Email", "student@university.edu"], ["Password", ""]].forEach(function (f) {
    var fg = AL(card, "field", "v", { gap: 6, stretch: true });
    TXT(fg, f[0], "Label", "muted-foreground");
    var inp = AL(fg, "input", "h", { padX: 12, radius: 8, bg: "card", border: "input", align: "CENTER", stretch: true, h: 40 });
    if (f[1]) TXT(inp, f[1], "Body/Small", "muted-foreground");
  });
  var sub = AL(card, "submit", "h", { radius: 8, bg: "primary", align: "CENTER", justify: "CENTER", stretch: true, h: 40 });
  TXT(sub, "Sign In", "Body/Base Medium", "primary-foreground");
  TXT(card, "Don’t have an account?  Sign up free", "Body/Small", "muted-foreground", { stretch: true, align: "CENTER" });
  TXT(s, "© 2026 StudyFlow. Built for students.", "Caption", "#e4ecf3");
  return s;
}

function screenOverlays(page, x) {
  var ov = AL(null, "Screen / Overlays", "h", { gap: 40, pad: 64, bg: "background" });
  page.appendChild(ov);
  ov.resize(SCREEN_W, 400);
  ov.layoutSizingHorizontal = "FIXED";
  ov.layoutSizingVertical = "HUG";
  ov.counterAxisAlignItems = "MIN";
  ov.x = x; ov.y = 160;

  // Record outcome — SPEC §12
  var d1 = AL(ov, "Dialog / Record outcome", "v", { gap: 14, pad: 24, radius: 16, bg: "card", border: "border", w: 420 });
  TXT(d1, "How did it go?", "Display/xl", "foreground", { stretch: true });
  TXT(d1, "Thermodynamics lab report · 15:21–16:21 · 1h planned", "Body/Small", "muted-foreground", { stretch: true });
  [["Finished it", "The work for this session is done", true],
   ["Partly done", "I worked, but there is more left", false],
   ["Didn’t study", "This session didn’t happen", false]
  ].forEach(function (o) {
    var opt = AL(d1, "option", "h", {
      gap: 12, pad: 12, radius: 12, align: "CENTER", stretch: true,
      bg: o[2] ? "muted" : "card", border: o[2] ? "foreground" : "border"
    });
    IC(opt, o[2] ? "check" : "clock", 16, o[2] ? HEX.fg : HEX.muted);
    var tb = AL(opt, "t", "v", { gap: 2, grow: true });
    TXT(tb, o[0], "Body/Base Medium", "foreground");
    TXT(tb, o[1], "Body/Small", "muted-foreground");
  });
  var fr = AL(d1, "fields", "h", { gap: 12, stretch: true });
  [["Minutes you worked", "40"], ["Minutes still left", "20"]].forEach(function (f) {
    var fg = AL(fr, "f", "v", { gap: 6, grow: true });
    TXT(fg, f[0], "Label", "muted-foreground");
    var i2 = AL(fg, "i", "h", { padX: 12, radius: 8, bg: "card", border: "input", align: "CENTER", stretch: true, h: 36 });
    TXT(i2, f[1], "Body/Small", "foreground");
  });
  var a1 = AL(d1, "acts", "h", { gap: 8, justify: "MAX", stretch: true });
  btn(a1, "Cancel"); btn(a1, "Save", true);

  // Confirm delete — SPEC §7.8
  var d2 = AL(ov, "Dialog / Confirm delete", "v", { gap: 12, pad: 24, radius: 16, bg: "card", border: "border", w: 380 });
  TXT(d2, "Delete “Algorithms final revision”?", "Display/lg", "foreground", { stretch: true });
  TXT(d2, "This also removes its study sessions and the record of time you have already put in. It cannot be undone.", "Body/Small", "muted-foreground", { stretch: true });
  var a2 = AL(d2, "acts", "h", { gap: 8, justify: "MAX", stretch: true });
  btn(a2, "Cancel");
  var del = AL(a2, "b", "h", { padX: 12, padY: 7, radius: 8, bg: "deficit-soft", align: "CENTER" });
  TXT(del, "Delete task", "Label", "deficit");

  // Large adjustment — SPEC §15.4
  var d3 = AL(ov, "Dialog / Large adjustment", "v", { gap: 12, pad: 24, radius: 16, bg: "card", border: "border", w: 420 });
  TXT(d3, "Your exam prep work usually takes much longer", "Display/lg", "foreground", { stretch: true });
  TXT(d3, "This is the first time StudyFlow has suggested a big change for this kind of task, so it is asking before using it.", "Body/Small", "muted-foreground", { stretch: true });
  TXT(d3, "Across 8 finished exam prep tasks, you have taken about 2.4× your own estimate. For this task that means 2h 24m rather than 1h.", "Body/Small", "muted-foreground", { stretch: true });
  var o3 = AL(d3, "opts", "h", { gap: 8, stretch: true });
  [["Use your estimate", "1h", "Schedule exactly what you entered."],
   ["Use the suggestion", "2h 24m", "Based on how these actually go for you."]
  ].forEach(function (o) {
    var c = AL(o3, "o", "v", { gap: 4, pad: 12, radius: 12, bg: "card", border: "border", grow: true });
    TXT(c, o[0], "Label", "muted-foreground", { stretch: true });
    TXT(c, o[1], "Display/lg", "foreground");
    TXT(c, o[2], "Caption", "muted-foreground", { stretch: true });
  });
  var a3 = AL(d3, "acts", "h", { gap: 8, justify: "MAX", stretch: true });
  btn(a3, "Keep 1h"); btn(a3, "Use 2h 24m", true);

  // Schedule preview drawer — SPEC §11.2 / §14.2
  var d4 = AL(ov, "Drawer / Schedule preview", "v", { gap: 14, pad: 24, radius: 16, bg: "card", border: "border", w: 420 });
  TXT(d4, "A new plan for you", "Display/xl", "foreground", { stretch: true });
  callout(d4, "info", "Why this changed",
    "“Thermodynamics lab report” needs 35 more minutes than planned.");
  callout(d4, "warning", "2 tasks still don’t fit",
    "Using this plan is still an improvement, but you will need to move a deadline or add study time.");
  TXT(d4, "Sessions", "Body/Base Medium", "foreground", { stretch: true });
  var sl = AL(d4, "sessions", "v", { radius: 12, border: "border", stretch: true });
  [["Mon 24 · 18:22", "Thermodynamics lab r…", "35m"],
   ["Mon 24 · 19:07", "Calculus II — Problem…", "1h"],
   ["Tue 25 · 18:00", "Calculus II — Problem…", "1h"],
   ["Wed 26 · 19:00", "Statistics reading, ch…", "30m"]
  ].forEach(function (r, i) {
    var row = AL(sl, "row", "h", { gap: 10, padX: 12, padY: 8, align: "CENTER", stretch: true });
    if (i < 3) edge(row, "bottom");
    TXT(row, r[0], "Data", "muted-foreground", { w: 110 });
    TXT(row, r[1], "Body/Small", "foreground", { grow: true });
    TXT(row, r[2], "Data", "muted-foreground");
  });
  var a4 = AL(d4, "acts", "h", { gap: 8, justify: "MAX", stretch: true });
  btn(a4, "Discard"); btn(a4, "Use this plan", true);
  return ov;
}

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────
async function main() {
  // Only valid under documentAccess: "dynamic-page", which this plugin does
  // NOT use — that mode also forbids the synchronous textStyleId setter this
  // script relies on. Guarded so the call is harmless either way.
  try { await figma.loadAllPagesAsync(); } catch (e) { /* pages already loaded */ }

  var fonts = [
    { family: "Bricolage Grotesque", style: "Bold" },
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Semi Bold" },
    { family: "IBM Plex Mono", style: "Regular" }
  ];
  for (var i = 0; i < fonts.length; i++) await figma.loadFontAsync(fonts[i]);

  var colours = await figma.variables.getLocalVariablesAsync("COLOR");
  for (var c = 0; c < colours.length; c++) {
    V[colours[c].name.replace("color/", "")] = colours[c];
  }
  var ts = await figma.getLocalTextStylesAsync();
  for (var t = 0; t < ts.length; t++) S[ts[t].name] = ts[t];

  if (!V["background"] || !S["Display/2xl"]) {
    figma.closePlugin("Missing StudyFlow variables or text styles — run the Foundations build first.");
    return;
  }

  var page = null;
  for (var p = 0; p < figma.root.children.length; p++) {
    if (figma.root.children[p].name === "03 Screens") page = figma.root.children[p];
  }
  if (!page) {
    page = figma.createPage();
    page.name = "03 Screens";
  }
  await figma.setCurrentPageAsync(page);

  // Replace only this script's own output.
  var old = page.children.slice();
  for (var o = 0; o < old.length; o++) {
    if (old[o].name.indexOf("Screen / ") === 0) old[o].remove();
  }

  var x = 0;
  var built = [];
  var makers = [
    screenDashboard, screenTasks, screenCalendar, screenAvailability,
    screenProgress, screenSettings, screenSignIn, screenOverlays
  ];
  for (var m = 0; m < makers.length; m++) {
    var node = makers[m](page, x);
    var frame = node.name && node.name.indexOf("Screen / ") === 0 ? node : node.parent.parent;
    built.push({ name: frame.name, w: Math.round(frame.width), h: Math.round(frame.height) });
    x += SCREEN_W + GAP_X;
  }

  figma.viewport.scrollAndZoomIntoView(page.children);
  figma.closePlugin("Built " + built.length + " screens at full height.");
}

main().catch(function (e) {
  figma.closePlugin("Failed: " + (e && e.message ? e.message : String(e)));
});
