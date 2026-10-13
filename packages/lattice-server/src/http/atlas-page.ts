// GET /atlas: the catalog as one picture, and how it grew.
//
// Self-contained like the landing page: no external assets, data from
// /atlas.json, every third-party string inserted as text (never as markup).
// Color carries one story, what is new, because nineteen-odd contexts are far
// past what hue can tell apart; contexts are named in place instead.
// Mark colors: the dataviz reference palette's first three slots, validated
// all-pairs in both modes (blue = new, orange = unmet search, aqua = dataset).

export function atlasPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchemaLattice Atlas</title>
<meta name="description" content="Every concept in the SchemaLattice catalog placed by meaning, how the catalog grew, what people searched for and did not find, and the public datasets mapped onto it.">
<style>
  :root { color-scheme: light dark;
    --fg:#1a1f24; --bg:#fbfaf8; --muted:#5c6670; --line:#e3ded6; --card:#f2efe9; --accent:#0b6e6e;
    --node:#8a939b; --new:#2a78d6; --ask:#eb6834; --src:#1baf7a; --edge:#c9c3b9; }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#e8e6e1; --bg:#15181b; --muted:#9aa4ad; --line:#2c3238; --card:#1d2226; --accent:#4cc0b8;
    --node:#6b757e; --new:#3987e5; --ask:#d95926; --src:#199e70; --edge:#3a4249; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:72rem; margin:0 auto; padding:1.5rem 1rem 3rem; }
  h1 { font-size:1.6rem; line-height:1.2; margin:.2rem 0 .4rem; }
  h2 { font-size:1rem; margin:0 0 .5rem; }
  a { color:var(--accent); }
  .muted { color:var(--muted); }
  .lede { max-width:46rem; margin:0 0 1rem; }
  .controls { display:flex; flex-wrap:wrap; gap:.6rem 1.2rem; align-items:center; margin:.6rem 0; font-size:.92rem; }
  .controls label { display:inline-flex; gap:.35rem; align-items:center; }
  .time { display:flex; gap:.6rem; align-items:center; flex:1 1 18rem; min-width:0; }
  .time input { flex:1; min-width:0; }
  .time output { font-variant-numeric:tabular-nums; min-width:6.5rem; }
  button { font:inherit; padding:.25rem .8rem; border:1px solid var(--line); border-radius:6px;
    background:var(--card); color:var(--fg); cursor:pointer; }
  .stage { position:relative; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow-x:auto; overflow-y:hidden; }
  svg.map { display:block; width:100%; min-width:760px; height:auto; touch-action:manipulation; }
  .swipe { display:none; font-size:.8rem; margin:.3rem 0 0; }
  @media (max-width: 760px) { .swipe { display:block; } }
  .ctx { font-size:12px; letter-spacing:.06em; text-transform:uppercase; fill:var(--muted);
    paint-order:stroke; stroke:var(--card); stroke-width:4px; stroke-linejoin:round; pointer-events:none; }
  .lbl { font-size:11px; fill:var(--fg); paint-order:stroke; stroke:var(--card); stroke-width:3px; pointer-events:none; }
  .fork { stroke:var(--edge); stroke-width:1.5; fill:none; }
  .coref { stroke:var(--edge); stroke-width:1.5; stroke-dasharray:4 4; fill:none; }
  .srcline { stroke:var(--src); stroke-width:1.5; fill:none; display:none; }
  .srcline.on { display:inline; }
  .c { fill:var(--node); stroke:var(--card); stroke-width:2; cursor:pointer; }
  .c.root { fill:var(--card); stroke:var(--fg); stroke-width:1.5; }
  .c.new { fill:var(--new); }
  .ring { fill:none; stroke:var(--new); stroke-width:2; pointer-events:none; }
  .d { fill:none; stroke:var(--ask); stroke-width:2; stroke-dasharray:3 3; cursor:pointer; }
  .s { fill:var(--src); stroke:var(--card); stroke-width:2; cursor:pointer; }
  .hit { fill:transparent; cursor:pointer; }
  .sel { stroke:var(--fg) !important; stroke-width:2.5 !important; }
  .hide { display:none; }
  .tip { position:absolute; pointer-events:none; background:var(--bg); border:1px solid var(--line); border-radius:6px;
    padding:.35rem .55rem; font-size:.82rem; max-width:18rem; box-shadow:0 2px 8px rgba(0,0,0,.12); display:none; }
  .legend { display:flex; flex-wrap:wrap; gap:.4rem 1.1rem; font-size:.85rem; color:var(--muted); margin:.6rem 0 0; padding:0; list-style:none; }
  .legend svg { vertical-align:-3px; margin-right:.3rem; }
  .detail { min-height:3.2rem; margin:.7rem 0 0; padding:.6rem .8rem; border:1px solid var(--line); border-radius:8px; font-size:.92rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(16rem, 1fr)); gap:1rem; margin-top:1.4rem; }
  .card { border:1px solid var(--line); border-radius:8px; padding:.8rem 1rem; }
  .card ol, .card ul { margin:0; padding-left:1.1rem; font-size:.9rem; }
  .card li { margin:.15rem 0; }
  .bars { list-style:none; padding:0 !important; }
  .bar { display:grid; grid-template-columns:minmax(0, 9rem) 1fr 2rem; gap:.5rem; align-items:center; font-size:.85rem; }
  .bar span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar i { display:block; height:8px; border-radius:0 4px 4px 0; background:var(--accent); }
  .bar b { font-weight:400; text-align:right; font-variant-numeric:tabular-nums; color:var(--muted); }
  details { margin-top:1.4rem; }
  table { border-collapse:collapse; width:100%; font-size:.85rem; }
  th, td { text-align:left; padding:.3rem .5rem .3rem 0; border-top:1px solid var(--line); vertical-align:top; }
  .tablewrap { overflow-x:auto; }
  @media (prefers-reduced-motion: reduce) { #play { display:none; } }
</style>
</head>
<body>
<main>
  <p class="muted"><a href="/">SchemaLattice</a> / atlas</p>
  <h1>The catalog, placed by meaning</h1>
  <p class="lede">Each dot is a concept, placed by the same embeddings search uses, so related ideas sit
  together. Drag the timeline to watch it grow. <span style="color:var(--new);font-weight:600">Blue</span> marks what is new,
  dashed <span style="color:var(--ask);font-weight:600">orange</span> rings are searches that found nothing yet, and
  <span style="color:var(--src);font-weight:600">green</span> diamonds are public datasets mapped onto concepts.</p>

  <div class="controls">
    <div class="time">
      <button id="play" type="button">Play</button>
      <input id="t" type="range" min="0" max="1" step="1" value="1" aria-label="Show the catalog as of this date">
      <output id="tl" for="t"></output>
    </div>
    <label><input type="checkbox" id="showAsk" checked> Unmet searches</label>
    <label><input type="checkbox" id="showSrc" checked> Public datasets</label>
    <label><input type="checkbox" id="showLbl"> All labels</label>
  </div>

  <div class="stage">
    <svg class="map" id="map" viewBox="0 0 1000 640" role="img" aria-labelledby="mapTitle mapDesc">
      <title id="mapTitle">Map of the SchemaLattice catalog</title>
      <desc id="mapDesc">Loading.</desc>
    </svg>
    <div class="tip" id="tip" role="status"></div>
  </div>
  <p class="swipe muted">Swipe the map sideways to see all of it.</p>
  <ul class="legend" aria-label="Legend">
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="var(--node)"/></svg>Concept (bigger: more forks, apps and datasets)</li>
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="var(--new)"/><circle cx="7" cy="7" r="6.2" fill="none" stroke="var(--new)" stroke-width="1.5"/></svg>Added in the 14 days before the date shown</li>
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="var(--card)" stroke="var(--fg)" stroke-width="1.5"/></svg>Root concept</li>
    <li><svg width="22" height="14"><line x1="1" y1="7" x2="21" y2="7" stroke="var(--edge)" stroke-width="2"/></svg>Fork</li>
    <li><svg width="22" height="14"><line x1="1" y1="7" x2="21" y2="7" stroke="var(--edge)" stroke-width="2" stroke-dasharray="4 4"/></svg>Same thing, other perspective</li>
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--ask)" stroke-width="2" stroke-dasharray="3 3"/></svg>Searched for, not here yet (today)</li>
    <li><svg width="14" height="14"><path d="M7 1 L13 7 L7 13 L1 7 Z" fill="var(--src)"/></svg>Public dataset</li>
  </ul>
  <div class="detail" id="detail" aria-live="polite"><span class="muted">Select a dot to see what it is. The table below lists everything.</span></div>

  <div class="grid">
    <section class="card"><h2>Where it is focused</h2><ul class="bars" id="focus"></ul></section>
    <section class="card"><h2>Built in the last 14 days</h2><p class="muted" id="newCount" style="margin:.2rem 0 .4rem;font-size:.9rem"></p><ol id="newest"></ol></section>
    <section class="card"><h2>Asked for, not here yet</h2><ol id="asks"></ol>
      <p class="muted" style="font-size:.8rem;margin:.5rem 0 0">Search text from anonymous visitors, shown as data.</p></section>
    <section class="card"><h2>Public data by place</h2><ul id="places"></ul>
      <p style="font-size:.85rem;margin:.5rem 0 0"><a href="/sources">Every source</a></p></section>
  </div>

  <details>
    <summary>All concepts as a table</summary>
    <div class="tablewrap"><table>
      <thead><tr><th>Concept</th><th>Context</th><th>Added</th><th>Forks</th><th>Apps</th><th>Datasets</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </details>

  <p class="muted" style="margin-top:2rem;font-size:.85rem">Placement is a two-dimensional projection of
  384-dimensional meaning, so distances are approximate: close usually means related, far does not always
  mean unrelated. Data: <a href="/atlas.json">/atlas.json</a>, from ${escapeHtml(host)}.</p>
</main>
<script>
(() => {
  const W = 1000, H = 640, PAD = 46, DAY = 86400000, NEW_DAYS = 14;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const svg = $("map"), tip = $("tip"), detail = $("detail");
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const html = (tag, text, parent, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const path = (uri) => uri.replace(/^https:\\/\\/[^/]+/, "");

  fetch("/atlas.json").then((r) => r.json()).then(draw).catch(() => {
    detail.textContent = "The atlas data could not be loaded.";
  });

  function draw(data) {
    const byUri = new Map();
    const nodes = [];
    let selected = null;
    for (const c of data.concepts) {
      const weight = c.forks + c.usages + c.publicSources;
      const n = { type: "c", d: c, t: Date.parse(c.createdAt), r: c.root ? 5 : 4.5 + 1.6 * Math.sqrt(weight),
        x0: PAD + c.x * (W - 2 * PAD), y0: PAD + c.y * (H - 2 * PAD) };
      byUri.set(c.uri, n);
      nodes.push(n);
    }
    // Datasets orbit the concept their rows are; unmet searches sit where their wording projects.
    const orbit = new Map();
    for (const s of data.sources) {
      const anchorUri = (s.concepts.find((c) => c.role === "record") || s.concepts[0] || {}).conceptUri;
      const a = byUri.get(anchorUri);
      if (!a) continue;
      const k = orbit.get(a) || 0; orbit.set(a, k + 1);
      const ang = -Math.PI / 2 + k * 0.9, dist = a.r + 16 + 9 * Math.floor(k / 7);
      nodes.push({ type: "s", d: s, t: Date.parse(s.createdAt), r: 5, anchor: a,
        x0: a.x0 + Math.cos(ang) * dist, y0: a.y0 + Math.sin(ang) * dist });
    }
    for (const q of data.demand) {
      nodes.push({ type: "d", d: q, t: Infinity, r: 5 + Math.min(6, Math.sqrt(q.count) * 1.5),
        x0: PAD + q.x * (W - 2 * PAD), y0: PAD + q.y * (H - 2 * PAD) });
    }
    relax(nodes);

    const gEdges = el("g", {}, svg), gCtx = el("g", {}, svg), gNodes = el("g", {}, svg), gLbl = el("g", {}, svg);
    for (const n of nodes) {
      if (n.type !== "c") continue;
      if (n.d.forkedFrom && byUri.has(n.d.forkedFrom)) {
        const p = byUri.get(n.d.forkedFrom);
        n.edges = (n.edges || []).concat({ line: el("line", { class: "fork", x1: n.x, y1: n.y, x2: p.x, y2: p.y }, gEdges), other: p });
      }
      for (const u of n.d.coRefersWith || []) {
        const p = byUri.get(u);
        if (p) n.edges = (n.edges || []).concat({ line: el("line", { class: "coref", x1: n.x, y1: n.y, x2: p.x, y2: p.y }, gEdges), other: p });
      }
    }
    for (const n of nodes) {
      if (n.type === "s") {
        n.lines = n.d.concepts.map((c) => byUri.get(c.conceptUri)).filter(Boolean)
          .map((p) => el("line", { class: "srcline", x1: n.x, y1: n.y, x2: p.x, y2: p.y, "data-to": p.d.uri }, gEdges));
        n.el = el("path", { class: "s", d: "M" + n.x + " " + (n.y - 6) + " L" + (n.x + 6) + " " + n.y + " L" + n.x + " " + (n.y + 6) + " L" + (n.x - 6) + " " + n.y + " Z" }, gNodes);
      } else if (n.type === "d") {
        n.el = el("circle", { class: "d", cx: n.x, cy: n.y, r: n.r }, gNodes);
      } else {
        n.ring = el("circle", { class: "ring hide", cx: n.x, cy: n.y, r: n.r + 3 }, gNodes);
        n.el = el("circle", { class: "c" + (n.d.root ? " root" : ""), cx: n.x, cy: n.y, r: n.r }, gNodes);
        const flip = n.x > W - 160;
        n.lbl = el("text", { class: "lbl hide", x: flip ? n.x - n.r - 3 : n.x + n.r + 3, y: n.y + 4, "text-anchor": flip ? "end" : "start" }, gLbl);
        n.lbl.textContent = n.d.label;
      }
      // A hit target bigger than the mark.
      const hit = el("circle", { class: "hit", cx: n.x, cy: n.y, r: Math.max(n.r + 5, 10) }, gNodes);
      n.hit = hit;
      hit.addEventListener("pointerenter", (e) => { showTip(n, e); highlight(n, true); });
      hit.addEventListener("pointermove", (e) => showTip(n, e));
      hit.addEventListener("pointerleave", () => { tip.style.display = "none"; highlight(n, false); });
      hit.addEventListener("click", () => select(n));
    }

    function highlight(n, on) {
      const lines = n.type === "s" ? n.lines : nodes.filter((m) => m.type === "s" && m.lines.some((l) => l.dataset.to === n.d.uri)).flatMap((m) => m.lines.filter((l) => l.dataset.to === n.d.uri));
      for (const l of lines || []) l.classList.toggle("on", on || (selected && (selected === n)));
    }

    // Context names at the centre of their concepts (contexts with three or more),
    // skipped when they would sit on top of a name already placed.
    const groups = new Map();
    for (const n of nodes) if (n.type === "c" && !n.d.root) {
      const g = groups.get(n.d.context) || []; g.push(n); groups.set(n.d.context, g);
    }
    const titles = new Map(data.contexts.map((c) => [c.slug, c.title]));
    const ctxLabels = [];
    const rootGroup = nodes.filter((n) => n.type === "c" && n.d.root);
    titles.set("(roots)", "Root vocabulary");
    if (rootGroup.length) groups.set("(roots)", rootGroup);
    const placedBoxes = [];
    for (const [slug, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      if (g.length < 3) continue;
      const text = titles.get(slug) || slug;
      const cx = g.reduce((s, n) => s + n.x, 0) / g.length;
      let cy = g.reduce((s, n) => s + n.y, 0) / g.length - 14;
      const w = text.length * 8 + 8;
      const box = (y) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: y - 12, y1: y + 4 });
      const hits = (b) => placedBoxes.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
      let tries = 0;
      while (hits(box(cy)) && tries < 6) { cy += (tries % 2 ? -1 : 1) * 18 * (tries + 1); tries++; }
      if (hits(box(cy))) continue;
      placedBoxes.push(box(cy));
      const t = el("text", { class: "ctx", "text-anchor": "middle", x: Math.min(W - w / 2, Math.max(w / 2, cx)), y: cy }, gCtx);
      t.textContent = text;
      ctxLabels.push({ el: t, members: g });
    }

    // Timeline: every day from the first concept to today.
    const first = Math.min(...nodes.filter((n) => n.type !== "d").map((n) => n.t));
    const start = Math.floor(first / DAY) * DAY, end = Date.now();
    const days = Math.max(1, Math.ceil((end - start) / DAY));
    const slider = $("t");
    slider.max = String(days); slider.value = String(days);
    let current = end;
    const showAsk = $("showAsk"), showSrc = $("showSrc"), showLbl = $("showLbl");

    function update() {
      const atEnd = Number(slider.value) >= days;
      current = atEnd ? end : start + Number(slider.value) * DAY;
      $("tl").textContent = atEnd ? "Today" : fmt(current);
      let visible = 0, fresh = 0;
      for (const n of nodes) {
        let on = n.type === "d" ? atEnd && showAsk.checked : n.t <= current;
        if (n.type === "s") on = on && showSrc.checked;
        for (const part of [n.el, n.hit, n.ring, n.lbl, ...(n.lines || [])]) if (part) part.classList.toggle("hide", !on);
        // An edge shows only when both ends exist at this date.
        for (const e of n.edges || []) e.line.classList.toggle("hide", !on || e.other.t > current);
        if (n.type !== "c") continue;
        const isNew = on && !n.d.root && current - n.t <= NEW_DAYS * DAY;
        n.el.classList.toggle("new", isNew);
        n.ring.classList.toggle("hide", !isNew);
        n.lbl.classList.toggle("hide", !on || !(showLbl.checked || n.r >= 7.5 || n === selected));
        if (on && !n.d.root) visible++;
        if (isNew) fresh++;
      }
      for (const c of ctxLabels) c.el.classList.toggle("hide", c.members.filter((n) => n.t <= current).length < 3);
      $("mapDesc").textContent = visible + " concepts as of " + (atEnd ? "today" : fmt(current)) + ", " + fresh +
        " added in the 14 days before. " + data.demand.length + " unmet searches and " + data.sources.length + " public datasets today.";
    }
    slider.addEventListener("input", update);
    for (const box of [showAsk, showSrc, showLbl]) box.addEventListener("change", update);
    let timer = null;
    $("play").addEventListener("click", () => {
      if (timer) { clearInterval(timer); timer = null; $("play").textContent = "Play"; return; }
      if (Number(slider.value) >= days) slider.value = "0";
      $("play").textContent = "Pause";
      const step = Math.max(1, Math.round(days / 120));
      timer = setInterval(() => {
        slider.value = String(Math.min(days, Number(slider.value) + step));
        update();
        if (Number(slider.value) >= days) { clearInterval(timer); timer = null; $("play").textContent = "Play"; }
      }, 80);
    });
    update();

    function describe(n) {
      if (n.type === "c") {
        const c = n.d;
        return [c.label, (titles.get(c.context) || c.context) + (c.kind ? " · " + c.kind : "") + (c.root ? " · root" : ""),
          "Added " + fmt(n.t) + " · " + c.forks + " forks · " + c.usages + " apps · " + c.publicSources + " datasets"];
      }
      if (n.type === "s") return [n.d.title, "Public dataset · " + n.d.jurisdiction, n.d.concepts.length + " concepts mapped"];
      return ["“" + n.d.text + "”", "Searched " + n.d.count + "×, nothing close enough yet", "Last asked " + fmt(Date.parse(n.d.lastAsked))];
    }
    function showTip(n, e) {
      tip.replaceChildren();
      describe(n).forEach((line, i) => html("div", line, tip, i ? "muted" : ""));
      const box = svg.parentNode.getBoundingClientRect();
      tip.style.display = "block";
      const scroll = svg.parentNode.scrollLeft;
      const x = e.clientX - box.left + 12, y = e.clientY - box.top + 12;
      tip.style.left = scroll + Math.min(x, box.width - tip.offsetWidth - 4) + "px";
      tip.style.top = Math.min(y, box.height - tip.offsetHeight - 4) + "px";
    }
    function select(n) {
      const prev = selected;
      if (prev) prev.el.classList.remove("sel");
      selected = n; n.el.classList.add("sel");
      if (prev) highlight(prev, false);
      highlight(n, true);
      update();
      detail.replaceChildren();
      const [head, ...rest] = describe(n);
      html("strong", head, detail);
      for (const line of rest) { html("br", undefined, detail); html("span", line, detail, "muted"); }
      html("br", undefined, detail);
      const a = html("a", n.type === "c" ? "Open the record" : n.type === "s" ? "Open the dataset page" : "See the demand report", detail);
      a.href = n.type === "c" ? path(n.d.uri) : n.type === "s" ? "/sources/" + encodeURIComponent(n.d.slug) : "/api/tools";
      if (n.type === "d") a.replaceWith(html("span", "Nearest concept: " + (n.d.nearest && byUri.get(n.d.nearest) ? byUri.get(n.d.nearest).d.label : "none"), null, "muted"));
    }

    // Cards.
    const max = Math.max(...data.contexts.map((c) => c.concepts));
    for (const c of data.contexts.filter((c) => c.slug !== "schemalattice").slice(0, 10)) {
      const li = html("li", undefined, $("focus"), "bar");
      html("span", c.title, li).title = c.title;
      const track = html("span", undefined, li);
      html("i", undefined, track).style.width = (100 * c.concepts / max) + "%";
      html("b", String(c.concepts), li);
    }
    const recent = nodes.filter((n) => n.type === "c" && !n.d.root && end - n.t <= NEW_DAYS * DAY).sort((a, b) => b.t - a.t);
    $("newCount").textContent = recent.length + " concepts and " + data.sources.filter((s) => end - Date.parse(s.createdAt) <= NEW_DAYS * DAY).length + " datasets";
    for (const n of recent.slice(0, 8)) {
      const li = html("li", undefined, $("newest"));
      const a = html("a", n.d.label, li); a.href = path(n.d.uri);
      html("span", " · " + (titles.get(n.d.context) || n.d.context), li, "muted");
    }
    if (!recent.length) html("li", "Nothing in the last 30 days.", $("newest"), "muted");
    for (const q of data.demand.slice(0, 6)) {
      const li = html("li", "“" + q.text + "”", $("asks"));
      html("span", " ×" + q.count, li, "muted");
    }
    if (!data.demand.length) html("li", "No unmet searches.", $("asks"), "muted");
    const places = new Map();
    for (const s of data.sources) places.set(s.jurisdiction, (places.get(s.jurisdiction) || 0) + 1);
    for (const [j, n] of [...places].sort()) {
      const li = html("li", undefined, $("places"));
      const a = html("a", j, li); a.href = "/sources?jurisdiction=" + encodeURIComponent(j);
      html("span", " · " + n + " dataset" + (n === 1 ? "" : "s"), li, "muted");
    }
    if (!places.size) html("li", "No public datasets yet.", $("places"), "muted");

    // Table view.
    for (const n of nodes.filter((n) => n.type === "c").sort((a, b) => b.t - a.t)) {
      const tr = html("tr", undefined, $("rows"));
      const a = html("a", n.d.label, html("td", undefined, tr)); a.href = path(n.d.uri);
      html("td", titles.get(n.d.context) || n.d.context, tr);
      html("td", fmt(n.t), tr);
      html("td", String(n.d.forks), tr);
      html("td", String(n.d.usages), tr);
      html("td", String(n.d.publicSources), tr);
    }
  }

  // Push overlapping marks apart while pulling each back toward where meaning put it.
  function relax(nodes) {
    for (const n of nodes) { n.x = n.x0; n.y = n.y0; }
    for (let iter = 0; iter < 220; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r + 3;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 0.01, push = (min - d) / 2;
          const ux = d2 ? dx / d : Math.cos(i + j), uy = d2 ? dy / d : Math.sin(i + j);
          a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        }
      }
      for (const n of nodes) {
        n.x += (n.x0 - n.x) * 0.03; n.y += (n.y0 - n.y) * 0.03;
        n.x = Math.min(W - 12, Math.max(12, n.x)); n.y = Math.min(H - 12, Math.max(12, n.y));
      }
    }
    for (const n of nodes) { n.x = Math.round(n.x * 10) / 10; n.y = Math.round(n.y * 10) / 10; }
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
