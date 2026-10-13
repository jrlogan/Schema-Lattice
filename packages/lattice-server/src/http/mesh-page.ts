// GET /mesh: how well two apps (or an app and a public dataset) will exchange
// data, as a picture a person can follow, with the field-level detail behind it.
//
// Each connection is one row: side A, a connector graded by how much work it
// takes (status colors from the dataviz reference palette, always paired with
// an icon and a word), side B. A row opens to its field table. Pasted manifests
// go to the tool for the computation only; nothing is stored.

export interface MeshOptions {
  apps: Array<{ slug: string; name: string }>;
  sources: Array<{ slug: string; title: string }>;
}

export function meshPage(host: string, options: MeshOptions): string {
  const opts = JSON.stringify(options).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchemaLattice Mesh</title>
<meta name="description" content="How well two apps, or an app and a public dataset, will exchange data: concept by concept and field by field, with the work each connection needs.">
<style>
  :root { color-scheme: light dark;
    --fg:#1a1f24; --bg:#fbfaf8; --muted:#5c6670; --line:#e3ded6; --card:#f2efe9; --accent:#0b6e6e;
    --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b; }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#e8e6e1; --bg:#15181b; --muted:#9aa4ad; --line:#2c3238; --card:#1d2226; --accent:#4cc0b8; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:64rem; margin:0 auto; padding:1.5rem 1rem 3rem; }
  h1 { font-size:1.6rem; line-height:1.2; margin:.2rem 0 .4rem; }
  h2 { font-size:1.05rem; margin:1.6rem 0 .5rem; }
  a { color:var(--accent); }
  .muted { color:var(--muted); }
  .pick { display:grid; grid-template-columns:1fr auto 1fr; gap:.6rem; align-items:end; margin:1rem 0; }
  .pick label { display:block; font-size:.85rem; color:var(--muted); margin-bottom:.2rem; }
  select, textarea, button { font:inherit; color:var(--fg); background:var(--card); border:1px solid var(--line); border-radius:6px; }
  select { width:100%; padding:.35rem .4rem; }
  textarea { width:100%; min-height:9rem; padding:.5rem; font:12px/1.4 ui-monospace, monospace; }
  button { padding:.4rem 1rem; cursor:pointer; }
  .vs { padding-bottom:.4rem; color:var(--muted); }
  details.paste { margin:.4rem 0 1rem; }
  .pastegrid { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; margin-top:.5rem; }
  @media (max-width: 640px) { .pick, .pastegrid { grid-template-columns:1fr; } .vs { display:none; } }
  .summary { display:flex; flex-wrap:wrap; gap:1rem; align-items:stretch; margin:1rem 0; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:.6rem .9rem; min-width:7.5rem; }
  .tile .n { font-size:1.6rem; font-weight:650; font-variant-numeric:tabular-nums; line-height:1.1; }
  .tile .l { font-size:.85rem; color:var(--muted); }
  .tile.score .n { font-size:2.2rem; }
  .badge { display:inline-flex; gap:.3rem; align-items:center; font-size:.85rem; white-space:nowrap; }
  .ico { display:inline-block; width:1.1em; text-align:center; font-weight:700; }
  /* Status color marks the icon only; words stay in text colors. */
  .g-direct .ico, span.g-direct:not(.badge) { color:var(--good); } .g-translate .ico, span.g-translate:not(.badge) { color:var(--warning); }
  .g-manual .ico, span.g-manual:not(.badge) { color:var(--serious); } .g-gap .ico, span.g-gap:not(.badge) { color:var(--critical); }
  .challenges { margin:.4rem 0 0; padding-left:1.2rem; }
  .challenges li { margin:.3rem 0; }
  .rows { margin-top:.5rem; border-top:1px solid var(--line); }
  .row { border-bottom:1px solid var(--line); }
  .row > summary { list-style:none; cursor:pointer; display:grid; grid-template-columns:1fr 9.5rem 1fr; gap:.6rem; align-items:center; padding:.45rem .2rem; }
  .row > summary::-webkit-details-marker { display:none; }
  .row > summary:hover, .row > summary:focus-visible { background:var(--card); outline:none; }
  .side { min-width:0; }
  .side .c { font-weight:600; }
  .side .l { font-size:.82rem; color:var(--muted); overflow-wrap:anywhere; }
  .side.right { text-align:right; }
  .conn { display:flex; flex-direction:column; align-items:center; gap:.1rem; }
  .conn svg { width:100%; height:14px; }
  .conn line { stroke-width:3; stroke-linecap:round; }
  .empty { color:var(--muted); font-style:italic; font-size:.9rem; }
  .detail { padding:.3rem .2rem .9rem; font-size:.9rem; }
  table { border-collapse:collapse; width:100%; font-size:.85rem; margin-top:.4rem; }
  th, td { text-align:left; padding:.25rem .5rem .25rem 0; border-top:1px solid var(--line); vertical-align:top; }
  .lock { font-size:.78rem; color:var(--critical); }
  .err { color:var(--critical); }
  @media (max-width: 640px) { .row > summary { grid-template-columns:1fr 5.5rem 1fr; } .conn .badge span:last-child { display:none; } }
</style>
</head>
<body>
<main>
  <p class="muted"><a href="/">SchemaLattice</a> / <a href="/atlas">atlas</a> / mesh</p>
  <h1>How well will they mesh?</h1>
  <p>Pick two apps, or an app and a public dataset, to see how their data lines up: what connects directly, what needs
  translation, what needs a person to decide, and what has no counterpart, down to individual fields and where personal data would cross.</p>

  <div class="pick">
    <div><label for="a">Side A</label><select id="a"></select></div>
    <div class="vs">and</div>
    <div><label for="b">Side B</label><select id="b"></select></div>
  </div>
  <details class="paste"><summary>Or paste two schemalattice.json manifests (not stored)</summary>
    <div class="pastegrid">
      <textarea id="pa" aria-label="Manifest A" placeholder='{"project":{"name":"my-app"},"concepts":{...},"fieldMaps":{...}}'></textarea>
      <textarea id="pb" aria-label="Manifest B" placeholder='{"project":{"name":"friends-app"},"concepts":{...}}'></textarea>
    </div>
    <p><button type="button" id="go">Compare the pasted manifests</button>
      <span class="muted" style="font-size:.85rem">Only concept URIs and field-map targets are read. Nothing is kept.</span></p>
  </details>

  <div id="out" aria-live="polite"><p class="muted">Choose two sides to compare.</p></div>

  <p class="muted" style="margin-top:2rem;font-size:.85rem">Grades: <span class="badge g-direct"><span class="ico">●</span>direct</span> same concept ·
  <span class="badge g-translate"><span class="ico">◐</span>translate</span> fork, version or declared co-reference ·
  <span class="badge g-manual"><span class="ico">○</span>manual</span> only similar ·
  <span class="badge g-gap"><span class="ico">✕</span>gap</span> no counterpart. For AI clients: <code>lattice_mesh_report</code> returns the same
  report as data. Served from ${escapeHtml(host)}.</p>
</main>
<script>
(() => {
  const OPTIONS = ${opts};
  const $ = (id) => document.getElementById(id);
  const html = (tag, text, parent, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  };
  const GRADE = {
    direct: { ico: "●", word: "direct", color: "var(--good)" },
    translate: { ico: "◐", word: "translate", color: "var(--warning)" },
    manual: { ico: "○", word: "manual", color: "var(--serious)" },
    gap: { ico: "✕", word: "gap", color: "var(--critical)" },
  };

  // Selectors: apps first, then public datasets.
  for (const id of ["a", "b"]) {
    const sel = $(id);
    html("option", "Choose…", sel).value = "";
    const ga = html("optgroup", undefined, sel); ga.label = "Registered apps";
    for (const a of OPTIONS.apps) { const o = html("option", a.name, ga); o.value = "app:" + a.slug; }
    const gs = html("optgroup", undefined, sel); gs.label = "Public data sources";
    for (const s of OPTIONS.sources) { const o = html("option", s.title, gs); o.value = "source:" + s.slug; }
  }
  const params = new URLSearchParams(location.search);
  if (params.get("a")) $("a").value = params.get("a");
  if (params.get("b")) $("b").value = params.get("b");
  const pick = () => {
    const a = $("a").value, b = $("b").value;
    if (!a || !b) return;
    history.replaceState(null, "", "?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b));
    run({ a, b });
  };
  $("a").addEventListener("change", pick);
  $("b").addEventListener("change", pick);
  $("go").addEventListener("click", () => {
    let a, b;
    try { a = JSON.parse($("pa").value); b = JSON.parse($("pb").value); }
    catch { return showError("Both boxes need valid JSON (a schemalattice.json file)."); }
    run({ a: { manifest: a }, b: { manifest: b } });
  });
  if (params.get("a") && params.get("b")) pick();

  function showError(msg) { $("out").replaceChildren(); html("p", msg, $("out"), "err"); }

  async function run(body) {
    $("out").replaceChildren(); html("p", "Comparing…", $("out"), "muted");
    let r;
    try {
      r = await (await fetch("/api/tools/lattice_mesh_report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    } catch { return showError("The comparison could not be loaded."); }
    if (r.error) return showError(r.error.message);
    render(r);
  }

  function render(r) {
    const out = $("out");
    out.replaceChildren();
    const sum = html("div", undefined, out, "summary");
    const tile = (n, l, cls) => { const t = html("div", undefined, sum, "tile " + (cls || "")); html("div", String(n), t, "n"); html("div", l, t, "l"); };
    tile(r.score, "mesh score of 100", "score");
    for (const g of ["direct", "translate", "manual", "gap"]) {
      const t = html("div", undefined, sum, "tile");
      const n = html("div", undefined, t, "n");
      html("span", GRADE[g].ico + " ", n, "g-" + g);
      n.append(String(r.counts[g]));
      html("div", GRADE[g].word, t, "l");
    }
    html("p", r.a.name + " (" + r.a.concepts + " concepts) and " + r.b.name + " (" + r.b.concepts + " concepts).", out, "muted");

    if (r.challenges.length) {
      html("h2", "What connecting them involves", out);
      const ul = html("ul", undefined, out, "challenges");
      for (const c of r.challenges) html("li", c, ul);
    }
    for (const n of r.notes || []) html("p", n, out, "muted");

    html("h2", "Connection by connection", out);
    const rows = html("div", undefined, out, "rows");
    for (const p of r.pairs) {
      const d = html("details", undefined, rows, "row");
      const s = html("summary", undefined, d);
      side(s, p.a, false);
      const c = html("div", undefined, s, "conn");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 14"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", p.a ? "4" : "50"); line.setAttribute("x2", p.b ? "96" : "50"); line.setAttribute("y1", "7"); line.setAttribute("y2", "7");
      line.setAttribute("stroke", GRADE[p.grade].color);
      if (p.grade === "manual") line.setAttribute("stroke-dasharray", "4 4");
      svg.appendChild(line); c.appendChild(svg);
      const badge = html("span", undefined, c, "badge g-" + p.grade);
      html("span", GRADE[p.grade].ico, badge, "ico"); html("span", GRADE[p.grade].word, badge);
      side(s, p.b, true);
      const det = html("div", undefined, d, "detail");
      html("p", p.how, det);
      if (p.fields && p.fields.length) {
        const t = html("table", undefined, det);
        const hr = html("tr", undefined, html("thead", undefined, t));
        for (const h of [r.a.name, "", r.b.name, "Note"]) html("th", h, hr);
        const tb = html("tbody", undefined, t);
        for (const f of p.fields) {
          const tr = html("tr", undefined, tb);
          html("td", f.a || "—", tr);
          const st = { direct: ["●", "direct", "g-direct"], convert: ["◐", "convert", "g-translate"], "a-only": ["→", "only A", "g-gap"], "b-only": ["←", "only B", "g-gap"] }[f.status];
          const td = html("td", undefined, tr); const fb = html("span", undefined, td, "badge " + st[2]); html("span", st[0], fb, "ico"); html("span", st[1], fb);
          html("td", f.b || "—", tr);
          const note = html("td", f.why || "", tr);
          if (f.personal) html("div", "personal data: " + f.personal, note, "lock");
        }
      }
      if (p.a && p.b) {
        const a = html("a", "Compare the two concepts in full", html("p", undefined, det));
        a.href = "/api/tools";
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          const cmp = await (await fetch("/api/tools/lattice_compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: p.a.uri, b: p.b.uri }) })).json();
          const pre = html("pre", cmp.table || (cmp.error && cmp.error.message), det);
          pre.style.whiteSpace = "pre-wrap"; pre.style.fontSize = ".8rem";
          a.remove();
        });
      }
    }
  }

  function side(parent, s, right) {
    const el = html("div", undefined, parent, "side" + (right ? " right" : ""));
    if (!s) { html("div", "nothing here", el, "empty"); return; }
    html("div", s.label, el, "c");
    if (s.locals && s.locals.length) html("div", s.locals.join(" · "), el, "l");
  }
})();
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
