// GET /atlas: the catalog as one picture, and the story of how it grew.
//
// Self-contained like the landing page: no external assets, data from
// /atlas.json, every third-party string inserted as text (never as markup).
//
// Four views of the same marks, moved between with a short animation: Meaning
// (t-SNE, the default), Turn (the first six principal components, one axis
// swapped at a time, which reads as turning the cloud), Lineage (grouped by the
// root each concept descends from), and Time (left to right in story order).
//
// The story is read from the data, never written by hand: creation times are
// split into chapters wherever work paused (a gap of 20 minutes or more), and
// each chapter into beats, one per context that grew, carrying the datasets
// published alongside it. Playback is paced by those beats, not by calendar
// days, so quiet weeks don't stall it and a busy afternoon isn't one flash.
// Positions never move: things arrive in place, so the eye can follow.
//
// Color carries one story, what is new in the chapter shown, because thirty-odd
// contexts are far past what hue can tell apart; contexts are named in place.
// Mark colors: the dataviz reference palette's first three slots, validated
// all-pairs in both modes (blue = new, orange = unmet search, aqua = dataset).

export function atlasPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchemaLattice Atlas</title>
<meta name="description" content="Every concept in the SchemaLattice catalog placed by meaning, the story of how the catalog grew, what people searched for and did not find, and the public datasets mapped onto it.">
<style>
  :root { color-scheme: light dark;
    --fg:#1a1f24; --bg:#fbfaf8; --muted:#5c6670; --line:#e3ded6; --card:#f2efe9; --accent:#0b6e6e;
    --node:#8a939b; --new:#2a78d6; --ask:#eb6834; --src:#1baf7a; --edge:#c9c3b9; --grid:#e8e3db; }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#e8e6e1; --bg:#15181b; --muted:#9aa4ad; --line:#2c3238; --card:#1d2226; --accent:#4cc0b8;
    --node:#6b757e; --new:#3987e5; --ask:#d95926; --src:#199e70; --edge:#3a4249; --grid:#262c31; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:72rem; margin:0 auto; padding:1.5rem 1rem 3rem; }
  h1 { font-size:1.6rem; line-height:1.2; margin:.2rem 0 .4rem; }
  h2 { font-size:1rem; margin:0 0 .5rem; }
  a { color:var(--accent); }
  .muted { color:var(--muted); }
  .lede { max-width:46rem; margin:0 0 1rem; }
  .controls { display:flex; flex-wrap:wrap; gap:.6rem 1.2rem; align-items:center; margin:.6rem 0 .3rem; font-size:.92rem; }
  .controls label { display:inline-flex; gap:.35rem; align-items:center; }
  .time { display:flex; gap:.6rem; align-items:center; flex:1 1 20rem; min-width:0; }
  .time input { flex:1; min-width:0; }
  .time output { font-variant-numeric:tabular-nums; min-width:5.5rem; }
  button { font:inherit; padding:.25rem .9rem; border:1px solid var(--line); border-radius:6px;
    background:var(--card); color:var(--fg); cursor:pointer; min-width:4.6rem; }
  /* Growth chart: one count axis, two step lines, a playhead. */
  .growth { position:relative; margin:.2rem 0 .4rem; }
  .growth svg { display:block; width:100%; height:64px; cursor:pointer; }
  .growth .gl { fill:none; stroke-width:2; }
  .growth .gl.c { stroke:var(--new); } .growth .gl.s { stroke:var(--src); }
  .growth .grid { stroke:var(--grid); stroke-width:1; }
  .growth .head { stroke:var(--fg); stroke-width:1.5; }
  .growth .tick { stroke:var(--muted); stroke-width:1; }
  .growth .gtip { position:absolute; top:-1.6rem; transform:translateX(-50%); white-space:nowrap; font-size:.78rem;
    background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:.05rem .4rem; pointer-events:none; display:none; }
  /* Narration: what is happening at this point in the story. */
  .story { display:flex; flex-wrap:wrap; gap:.3rem 1.5rem; align-items:baseline; justify-content:space-between;
    border-left:3px solid var(--new); padding:.35rem .8rem; margin:.3rem 0 .6rem; background:var(--card); border-radius:0 8px 8px 0; min-height:3.6rem; }
  .story .text { flex:1 1 26rem; min-width:0; transition:opacity .35s ease; }
  .story .text.fade { opacity:0; }
  .story .chapter { font-weight:600; }
  .story .beat { color:var(--muted); }
  .story .counts { font-variant-numeric:tabular-nums; font-size:.9rem; color:var(--muted); white-space:nowrap; }
  .story .counts b { color:var(--fg); font-size:1.05rem; }
  .stage { position:relative; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow-x:auto; overflow-y:hidden; }
  svg.map { display:block; width:100%; min-width:760px; height:auto; touch-action:manipulation; }
  .swipe { display:none; font-size:.8rem; margin:.3rem 0 0; }
  @media (max-width: 760px) { .swipe { display:block; } }
  /* Marks. Things arrive in place: they grow and fade in, lines draw themselves. */
  .n { transition:opacity .6s ease, transform .75s cubic-bezier(.2,.9,.3,1.25); transform-box:fill-box; transform-origin:center; }
  .n.dim, .lbl.dim, .e.dim, .fork.dim, .ctx.dim { opacity:.13; }
  .n.off { opacity:0; transform:scale(.15); pointer-events:none; }
  .e { transition:opacity .5s ease; }
  .e.off { opacity:0; }
  .fork { stroke:var(--edge); stroke-width:1.5; fill:none; stroke-dasharray:1; stroke-dashoffset:0; transition:stroke-dashoffset 1s ease .25s, opacity .3s ease; }
  .fork.off { stroke-dashoffset:1; opacity:0; }
  .coref { stroke:var(--edge); stroke-width:1.5; stroke-dasharray:4 4; fill:none; }
  .kind { stroke:var(--edge); stroke-width:1; fill:none; }
  .axis text { font-size:11px; fill:var(--muted); paint-order:stroke; stroke:var(--card); stroke-width:3px; }
  .axis line { stroke:var(--grid); stroke-width:1; }
  svg.moving .ctx { opacity:0; }
  .lbl.rootlbl { font-weight:700; font-size:12px; }
  .views { display:inline-flex; border:1px solid var(--line); border-radius:7px; overflow:hidden; }
  .views button { border:0; border-radius:0; min-width:0; padding:.25rem .8rem; background:var(--bg); }
  .views button + button { border-left:1px solid var(--line); }
  .views button[aria-pressed="true"] { background:var(--fg); color:var(--bg); }
  .viewbar { display:flex; flex-wrap:wrap; gap:.5rem 1rem; align-items:center; margin:.2rem 0 .5rem; font-size:.92rem; }
  .viewbar .note { color:var(--muted); font-size:.85rem; flex:1 1 20rem; min-width:0; }
  .turn { display:flex; gap:.6rem; align-items:center; flex:1 1 22rem; min-width:0; }
  .turn input { flex:1; min-width:0; }
  .turn output { font-size:.85rem; color:var(--muted); white-space:nowrap; }
  .srcline { stroke:var(--src); stroke-width:1.5; fill:none; display:none; }
  .srcline.on { display:inline; }
  .ctx { font-size:12px; letter-spacing:.06em; text-transform:uppercase; fill:var(--muted); transition:opacity .6s ease, fill .5s ease;
    paint-order:stroke; stroke:var(--card); stroke-width:4px; stroke-linejoin:round; pointer-events:none; }
  .ctx.off { opacity:0; }
  .ctx.hot { fill:var(--new); font-weight:700; }
  .lbl { font-size:11px; fill:var(--fg); paint-order:stroke; stroke:var(--card); stroke-width:3px; pointer-events:none; transition:opacity .5s ease; }
  .lbl.off { opacity:0; }
  .c { fill:var(--node); stroke:var(--card); stroke-width:2; cursor:pointer; }
  .c.root { fill:var(--card); stroke:var(--fg); stroke-width:1.5; }
  .c.new { fill:var(--new); }
  .c.bonly { fill:var(--card); stroke:var(--node); stroke-width:2; }
  .ring { fill:none; stroke:var(--new); stroke-width:2; pointer-events:none; }
  .d { fill:none; stroke:var(--ask); stroke-width:2; stroke-dasharray:3 3; cursor:pointer; }
  .s { fill:var(--src); stroke:var(--card); stroke-width:2; cursor:pointer; }
  .hit { fill:transparent; cursor:pointer; }
  .hit.off { display:none; }
  .sel { stroke:var(--fg) !important; stroke-width:2.5 !important; }
  .ripple { fill:none; stroke:var(--new); stroke-width:2; transform-box:fill-box; transform-origin:center;
    animation:ripple 1.1s ease-out forwards; pointer-events:none; }
  .ripple.src { stroke:var(--src); }
  .ripple.ask { stroke:var(--ask); }
  @keyframes ripple { from { transform:scale(1); opacity:.85; } to { transform:scale(3.4); opacity:0; } }
  .lens { display:flex; flex-wrap:wrap; gap:.5rem 1rem; align-items:center; margin:.2rem 0 .5rem; font-size:.92rem; }
  .lens label { display:inline-flex; gap:.4rem; align-items:center; min-width:0; }
  .lens select, .lens input { font:inherit; padding:.2rem .4rem; border:1px solid var(--line); border-radius:6px;
    background:var(--bg); color:var(--fg); max-width:min(18rem, 100%); }
  .lens input { width:13rem; }
  .lensinfo { border-left:3px solid var(--accent); padding:.35rem .8rem; margin:0 0 .6rem; background:var(--card);
    border-radius:0 8px 8px 0; font-size:.92rem; }
  .lensinfo .keys { display:flex; flex-wrap:wrap; gap:.2rem 1rem; color:var(--muted); font-size:.85rem; margin-top:.2rem; }
  .lensinfo svg { vertical-align:-2px; margin-right:.25rem; }
  .bars button.bar { all:unset; box-sizing:border-box; width:100%; cursor:pointer; display:grid;
    grid-template-columns:minmax(0, 9rem) 1fr 2rem; gap:.5rem; align-items:center; font-size:.85rem; border-radius:4px; }
  .bars button.bar:hover span:first-child { text-decoration:underline; }
  .bars button.bar:focus-visible { outline:2px solid var(--accent); }
  .linkish { all:unset; cursor:pointer; color:var(--accent); text-decoration:underline; }
  .linkish:focus-visible { outline:2px solid var(--accent); border-radius:3px; }
  .tip { position:absolute; pointer-events:none; background:var(--bg); border:1px solid var(--line); border-radius:6px;
    padding:.35rem .55rem; font-size:.82rem; max-width:18rem; box-shadow:0 2px 8px rgba(0,0,0,.12); display:none; }
  .legend { display:flex; flex-wrap:wrap; gap:.4rem 1.1rem; font-size:.85rem; color:var(--muted); margin:.6rem 0 0; padding:0; list-style:none; }
  .legend svg { vertical-align:-3px; margin-right:.3rem; }
  .detail { min-height:3.2rem; margin:.7rem 0 0; padding:.6rem .8rem; border:1px solid var(--line); border-radius:8px; font-size:.92rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(16rem, 1fr)); gap:1rem; margin-top:1.4rem; }
  .card { border:1px solid var(--line); border-radius:8px; padding:.8rem 1rem; }
  .card ol, .card ul { margin:0; padding-left:1.1rem; font-size:.9rem; }
  .card li { margin:.15rem 0; }
  .chapters { list-style:none; padding:0 !important; }
  .chapters li { margin:0 0 .45rem; }
  .chapters button { all:unset; cursor:pointer; display:block; border-radius:6px; padding:.2rem .35rem; margin:0 -.35rem; }
  .chapters button:hover, .chapters button:focus-visible { background:var(--card); outline:none; }
  .chapters button[aria-current="step"] { background:var(--card); box-shadow:inset 3px 0 0 var(--new); }
  .chapters .when { font-variant-numeric:tabular-nums; font-weight:600; }
  .bars { list-style:none; padding:0 !important; }
  .bar { display:grid; grid-template-columns:minmax(0, 9rem) 1fr 2rem; gap:.5rem; align-items:center; font-size:.85rem; }
  .bar span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar i { display:block; height:8px; border-radius:0 4px 4px 0; background:var(--accent); }
  .bar b { font-weight:400; text-align:right; font-variant-numeric:tabular-nums; color:var(--muted); }
  details { margin-top:1.4rem; }
  table { border-collapse:collapse; width:100%; font-size:.85rem; }
  th, td { text-align:left; padding:.3rem .5rem .3rem 0; border-top:1px solid var(--line); vertical-align:top; }
  .tablewrap { overflow-x:auto; }
  @media (prefers-reduced-motion: reduce) {
    svg.moving .ctx { opacity:1; }
    .n, .e, .fork, .ctx, .lbl, .story .text { transition:none !important; }
    .ripple { display:none; }
  }
</style>
</head>
<body>
<main>
  <p class="muted"><a href="/">SchemaLattice</a> / atlas</p>
  <h1>How the catalog grew</h1>
  <p class="lede">Each dot is a concept, placed by the same embeddings search uses, so related ideas sit
  together. Press play to watch it being built, one step at a time.
  <span style="color:var(--new);font-weight:600">Blue</span> is what arrived in the chapter shown,
  <span style="color:var(--src);font-weight:600">green</span> diamonds are public datasets mapped onto concepts, and
  dashed <span style="color:var(--ask);font-weight:600">orange</span> rings are searches that found nothing yet. Focus on an app, a context or a place to see where it sits
  among everything else, or compare two apps to see what they share.</p>

  <div class="controls">
    <div class="time">
      <button id="play" type="button">Play</button>
      <input id="t" type="range" min="0" max="1" step="1" value="1" aria-label="Step through how the catalog grew" aria-describedby="storyText">
      <output id="tl" for="t"></output>
    </div>
    <label><input type="checkbox" id="showAsk" checked> Unmet searches</label>
    <label><input type="checkbox" id="showSrc" checked> Public datasets</label>
    <label><input type="checkbox" id="showLbl"> All labels</label>
  </div>
  <div class="lens" role="search">
    <label>Focus on <select id="lens" aria-label="Focus the map on an app, a context or a place">
      <option value="">the whole catalog</option></select></label>
    <label id="withWrap" hidden>compared with <select id="with" aria-label="Compare with another app">
      <option value="">no other app</option></select></label>
    <label><input id="q" type="search" placeholder="Find a concept or dataset" aria-label="Find a concept or dataset"></label>
    <button id="clear" type="button" hidden>Clear</button>
  </div>
  <div class="lensinfo" id="lensInfo" aria-live="polite" hidden></div>
  <div class="growth" id="growth" aria-hidden="true">
    <svg id="growthSvg" viewBox="0 0 1000 64" preserveAspectRatio="none"></svg>
    <div class="gtip" id="gtip"></div>
  </div>
  <div class="story" aria-live="polite">
    <div class="text" id="storyText"><div class="chapter" id="chapterText">Loading the catalog…</div><div class="beat" id="beatText"></div></div>
    <div class="counts" id="counts"></div>
  </div>

  <div class="viewbar">
    <div class="views" role="group" aria-label="How to lay out the map">
      <button type="button" data-view="meaning" aria-pressed="true">Meaning</button>
      <button type="button" data-view="turn" aria-pressed="false">Turn</button>
      <button type="button" data-view="lineage" aria-pressed="false">Lineage</button>
      <button type="button" data-view="time" aria-pressed="false">Time</button>
    </div>
    <div class="turn" id="turnCtl" hidden>
      <button id="turnPlay" type="button">Turn</button>
      <input id="angle" type="range" min="0" max="6" step="0.01" value="0" aria-label="Angle to look at the catalog from">
      <output id="angleText" for="angle"></output>
    </div>
    <div class="note" id="viewNote" aria-live="polite"></div>
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
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="var(--new)"/><circle cx="7" cy="7" r="6.2" fill="none" stroke="var(--new)" stroke-width="1.5"/></svg>Arrived in the chapter shown</li>
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="var(--card)" stroke="var(--fg)" stroke-width="1.5"/></svg>Root concept</li>
    <li><svg width="22" height="14"><line x1="1" y1="7" x2="21" y2="7" stroke="var(--edge)" stroke-width="2"/></svg>Fork</li>
    <li><svg width="22" height="14"><line x1="1" y1="7" x2="21" y2="7" stroke="var(--edge)" stroke-width="2" stroke-dasharray="4 4"/></svg>Same thing, other perspective</li>
    <li><svg width="14" height="14"><path d="M7 1 L13 7 L7 13 L1 7 Z" fill="var(--src)"/></svg>Public dataset or standard</li>
    <li><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--ask)" stroke-width="2" stroke-dasharray="3 3"/></svg>Searched for, not here yet</li>
    <li><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--new)" stroke-width="2"/></svg>Concepts and <svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="var(--src)" stroke-width="2"/></svg>sources over the story (chart above)</li>
  </ul>
  <div class="detail" id="detail" aria-live="polite"><span class="muted">Select a dot to see what it is. The table below lists everything.</span></div>

  <div class="grid">
    <section class="card"><h2>How it grew</h2><ol class="chapters" id="chapters"></ol></section>
    <section class="card"><h2>Where it is focused</h2><p class="muted" style="font-size:.8rem;margin:-.3rem 0 .4rem">Select a context to focus the map on it.</p><ul class="bars" id="focus"></ul></section>
    <section class="card"><h2>Asked for, not here yet</h2><ol id="asks"></ol>
      <p class="muted" style="font-size:.8rem;margin:.5rem 0 0">Search text from anonymous visitors, shown as data.</p></section>
    <section class="card"><h2>Public data by place</h2><ul id="places"></ul>
      <p class="muted" style="font-size:.8rem;margin:.4rem 0 0">“Show” focuses the map on that place.</p>
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
  mean unrelated. The story is read from creation times: work separated by 20 minutes or more starts a new
  chapter. Data: <a href="/atlas.json">/atlas.json</a>, from ${escapeHtml(host)}.</p>
</main>
<script>
(() => {
  const W = 1000, H = 640, PAD = 46, CHAPTER_GAP = 20 * 60 * 1000;
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const fmtShort = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const path = (uri) => uri.replace(/^https:\\/\\/[^/]+/, "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : (many || one + "s"));
  const listOf = (names, max) => names.length <= max ? names.join(", ") : names.slice(0, max).join(", ") + " and " + (names.length - max) + " more";

  fetch("/atlas.json").then((r) => r.json()).then(draw).catch(() => {
    $("chapterText").textContent = "The atlas data could not be loaded.";
  });

  function draw(data) {
    const titles = new Map(data.contexts.map((c) => [c.slug, c.title]));
    titles.set("schemalattice", "Root vocabulary");
    const byUri = new Map();
    const nodes = [];
    let selected = null;

    // --- marks, placed by meaning ---------------------------------------------
    for (const c of data.concepts) {
      const weight = c.forks + c.usages + c.publicSources;
      const n = { type: "c", d: c, t: Date.parse(c.createdAt), r: c.root ? 5 : 4.5 + 1.6 * Math.sqrt(weight),
        x0: PAD + c.x * (W - 2 * PAD), y0: PAD + c.y * (H - 2 * PAD) };
      byUri.set(c.uri, n);
      nodes.push(n);
    }
    const orbit = new Map();
    for (const s of data.sources) {
      const anchorUri = (s.concepts.find((c) => c.role === "record") || s.concepts[0] || {}).conceptUri;
      const a = byUri.get(anchorUri);
      if (!a) continue;
      const k = orbit.get(a) || 0; orbit.set(a, k + 1);
      const ang = -Math.PI / 2 + k * 0.9, dist = a.r + 16 + 9 * Math.floor(k / 7);
      nodes.push({ type: "s", d: s, t: Date.parse(s.createdAt), r: 5, anchor: a, ang, dist,
        x0: a.x0 + Math.cos(ang) * dist, y0: a.y0 + Math.sin(ang) * dist });
    }
    for (const q of data.demand) {
      nodes.push({ type: "d", d: q, t: Infinity, r: 5 + Math.min(6, Math.sqrt(q.count) * 1.5),
        x0: PAD + q.x * (W - 2 * PAD), y0: PAD + q.y * (H - 2 * PAD) });
    }
    for (const n of nodes) { n.bx = n.x0; n.by = n.y0; }
    relax(nodes);
    for (const n of nodes) { n.x = n.tx; n.y = n.ty; }

    // --- lenses: focus the map on an app, a context, a place, or a search ----------
    const apps = new Map((data.apps || []).map((a) => [a.slug, a]));
    const appsOf = new Map();
    for (const a of data.apps || []) for (const u of a.concepts) appsOf.set(u, (appsOf.get(u) || []).concat(a.name));
    const sourceNodes = nodes.filter((n) => n.type === "s");
    const lensSel = $("lens"), withSel = $("with"), qIn = $("q");
    const group = (label, items) => {
      if (!items.length) return;
      const g = html("optgroup", undefined, lensSel); g.label = label;
      for (const [value, text] of items) { const o = html("option", text, g); o.value = value; }
    };
    group("Apps", (data.apps || []).map((a) => ["app:" + a.slug, a.name + " (" + a.concepts.length + ")"]));
    group("Contexts", data.contexts.filter((c) => c.slug !== "schemalattice")
      .map((c) => ["ctx:" + c.slug, c.title]).sort((a, b) => a[1].localeCompare(b[1])));
    const STATES = { CT: "Connecticut", MA: "Massachusetts", NY: "New York", RI: "Rhode Island" };
    const titleCase = (t) => t.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const placeName = (j) => {
      if (j === "global") return "Worldwide";
      if (j === "US") return "United States";
      const m = /^US-([A-Z]{2})(?:\\/(.+))?$/.exec(j);
      if (m) return m[2] ? titleCase(m[2].split("/").pop()) + ", " + m[1] : STATES[m[1]] || m[1];
      return j;
    };
    const within = (j, place) => j === place || j.startsWith(place + "/");
    const jurisdictions = [...new Set(data.sources.map((s) => s.jurisdiction))].sort();
    group("Places", jurisdictions.map((j) => ["place:" + j, placeName(j)]));
    for (const a of data.apps || []) { const o = html("option", a.name, withSel); o.value = a.slug; }
    let focus = null;
    let view = "meaning";
    function computeFocus() {
      const v = lensSel.value, q = qIn.value.trim().toLowerCase();
      if (!v && !q) return null;
      let concepts = null, sources = null, demand = new Set();
      const f = { kind: v.split(":")[0] || "search", a: null, b: null, q };
      if (f.kind === "app") {
        f.a = apps.get(v.slice(4)) || null;
        f.b = withSel.value && withSel.value !== f.a?.slug ? apps.get(withSel.value) || null : null;
        concepts = new Set((f.a?.concepts || []).concat(f.b?.concepts || []).filter((u) => byUri.has(u)));
      } else if (f.kind === "ctx") {
        f.ctx = v.slice(4);
        concepts = new Set(nodes.filter((n) => n.type === "c" && n.d.context === f.ctx).map((n) => n.d.uri));
      } else if (f.kind === "place") {
        f.place = v.slice(6);
        const here = data.sources.filter((s) => within(s.jurisdiction, f.place));
        sources = new Set(here.map((s) => s.slug));
        concepts = new Set(here.flatMap((s) => s.concepts.map((c) => c.conceptUri)).filter((u) => byUri.has(u)));
      }
      if (concepts && !sources) sources = new Set(sourceNodes.filter((n) => n.d.concepts.some((c) => concepts.has(c.conceptUri))).map((n) => n.d.slug));
      if (q) {
        const hit = (t) => String(t || "").toLowerCase().includes(q);
        const qc = new Set(nodes.filter((n) => n.type === "c" && (hit(n.d.label) || hit(titles.get(n.d.context)))).map((n) => n.d.uri));
        const qs = new Set(sourceNodes.filter((n) => hit(n.d.title) || hit(n.d.jurisdiction)).map((n) => n.d.slug));
        concepts = concepts ? new Set([...concepts].filter((u) => qc.has(u))) : qc;
        sources = sources ? new Set([...sources].filter((u) => qs.has(u))) : qs;
        if (!v) demand = new Set(nodes.filter((n) => n.type === "d" && hit(n.d.text)));
      }
      f.concepts = concepts; f.sources = sources; f.demand = demand;
      if (f.a && f.b) {
        const inB = new Set(f.b.concepts);
        f.shared = new Set(f.a.concepts.filter((u) => inB.has(u) && byUri.has(u)));
        f.bOnly = new Set(f.b.concepts.filter((u) => !f.shared.has(u) && byUri.has(u)));
      }
      f.labels = concepts.size <= 70;
      return f;
    }
    const inFocus = (n) => !focus || (n.type === "c" ? focus.concepts.has(n.d.uri) : n.type === "s" ? focus.sources.has(n.d.slug) : focus.demand.has(n));
    const contextsOf = (uris) => new Set([...uris].map((u) => byUri.get(u)?.d.context).filter(Boolean));
    function glyph(parent, kind) {
      const g = el("svg", { width: 14, height: 14, "aria-hidden": "true" }, parent);
      if (kind === "both") el("circle", { cx: 7, cy: 7, r: 5, fill: "var(--new)" }, g);
      else if (kind === "a") el("circle", { cx: 7, cy: 7, r: 5, fill: "var(--node)" }, g);
      else el("circle", { cx: 7, cy: 7, r: 4.5, fill: "var(--card)", stroke: "var(--node)", "stroke-width": 2 }, g);
    }
    function renderInfo() {
      const box = $("lensInfo");
      box.replaceChildren();
      box.hidden = !focus;
      $("clear").hidden = !focus;
      $("withWrap").hidden = !(focus && focus.kind === "app" && focus.a);
      if (!focus) return;
      const p = html("div", undefined, box);
      const nC = focus.concepts.size, nS = focus.sources.size;
      const ctxCount = contextsOf(focus.concepts).size;
      const datasets = plural(nS, "public dataset");
      if (focus.kind === "app" && focus.a && focus.b) {
        html("strong", focus.a.name, p); p.append(" and "); html("strong", focus.b.name, p);
        p.append(" share " + plural(focus.shared.size, "concept") + ". ");
        const a = html("a", "How well will they mesh?", p);
        a.href = "/mesh?a=app:" + encodeURIComponent(focus.a.slug) + "&b=app:" + encodeURIComponent(focus.b.slug);
        p.append(" (the mesh report also finds forks, co-references and similar concepts, not only the identical ones counted here).");
        const keys = html("div", undefined, box, "keys");
        const aOnly = [...focus.concepts].filter((u) => !focus.shared.has(u) && !focus.bOnly.has(u)).length;
        for (const [k, text] of [["both", "In both (" + focus.shared.size + ")"], ["a", "Only " + focus.a.name + " (" + aOnly + ")"], ["b", "Only " + focus.b.name + " (" + focus.bOnly.size + ")"]]) {
          const s = html("span", undefined, keys); glyph(s, k); s.append(text);
        }
      } else if (focus.kind === "app" && focus.a) {
        html("strong", focus.a.name, p);
        const k = html("span", undefined, html("div", undefined, box, "keys")); glyph(k, "both"); k.append("Used by " + focus.a.name + "; everything else is faded");
        p.append(" uses " + plural(nC, "concept") + " across " + plural(ctxCount, "context") + "; " + datasets + (nS === 1 ? " maps" : " map") + " onto them.");
        const mine = new Set(focus.a.concepts);
        const others = (data.apps || []).filter((o) => o.slug !== focus.a.slug)
          .map((o) => ({ o, n: o.concepts.filter((u) => mine.has(u)).length })).filter((x) => x.n).sort((x, y) => y.n - x.n);
        const line = html("div", others.length ? "Shares concepts with " : "No other registered app uses the same concepts yet.", box, "keys");
        others.slice(0, 8).forEach((x, i) => {
          if (i) line.append(" · ");
          const b = html("button", x.o.name + " (" + x.n + ")", line, "linkish");
          b.type = "button";
          b.addEventListener("click", () => { withSel.value = x.o.slug; refocus(); });
        });
        if (others.length) line.append(". Select one to compare.");
      } else if (focus.kind === "ctx") {
        html("strong", titles.get(focus.ctx) || focus.ctx, p);
        const users = new Set([...focus.concepts].flatMap((u) => appsOf.get(u) || []));
        p.append(": " + plural(nC, "concept") + ", used by " + (users.size ? listOf([...users].sort(), 4) : "no registered app yet") + "; " + datasets + (nS === 1 ? " maps" : " map") + " onto them.");
      } else if (focus.kind === "place") {
        html("strong", placeName(focus.place), p);
        const nested = jurisdictions.some((j) => j !== focus.place && within(j, focus.place));
        p.append((nested ? " (including places within it)" : "") + ": " + datasets + ", mapping onto " + plural(nC, "concept") + " in " + plural(ctxCount, "context") + ". ");
        const a = html("a", "List them", p); a.href = "/sources?jurisdiction=" + encodeURIComponent(focus.place);
      }
      if (focus.kind === "ctx" || focus.kind === "place" || focus.kind === "search") {
        const k = html("div", undefined, box, "keys");
        const c = html("span", undefined, k); glyph(c, "both"); c.append(focus.kind === "place" ? "Concepts its datasets map onto" : "In focus");
        const sd = html("span", undefined, k);
        const g = el("svg", { width: 14, height: 14, "aria-hidden": "true" }, sd); el("path", { d: "M7 1 L13 7 L7 13 L1 7 Z", fill: "var(--src)" }, g);
        sd.append("Datasets; everything else is faded");
      }
      if (focus.q) {
        const m = html("div", plural(nC, "concept") + ", " + plural(nS, "dataset") + (focus.demand.size ? ", " + plural(focus.demand.size, "unmet search", "unmet searches") : "") + " match “", focus.kind === "search" ? p : box, focus.kind === "search" ? "" : "keys");
        m.append(focus.q + "”" + (focus.kind === "search" ? "" : " within this focus") + ".");
      }
    }
    function syncUrl() {
      const u = new URL(location.href);
      for (const [k, v] of [["focus", lensSel.value], ["with", focus && focus.b ? focus.b.slug : ""], ["q", qIn.value.trim()], ["view", view === "meaning" ? "" : view]]) {
        if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
      }
      history.replaceState(null, "", u);
    }
    function refocus() {
      focus = computeFocus();
      renderInfo();
      for (const n of nodes) if (n.row) n.row.hidden = !!focus && !inFocus(n);
      apply(frame, { animate: false, ripple: false });
      syncUrl();
    }

    // --- the story: chapters where work paused, beats per context -------------
    const timed = nodes.filter((n) => n.type !== "d").sort((a, b) => a.t - b.t);
    const chapters = [];
    const beats = [];
    const seenContext = new Set();
    let chapter = null, beat = null, prevT = -Infinity;
    for (const n of timed) {
      if (n.t - prevT >= CHAPTER_GAP) {
        chapter = { index: chapters.length, start: n.t, end: n.t, beats: [], concepts: 0, sources: 0, standards: 0, newContexts: [], grown: [] };
        chapters.push(chapter);
        beat = null;
      }
      prevT = n.t;
      chapter.end = n.t;
      const ctx = n.type === "c" ? n.d.context : null;
      const isRoot = n.type === "c" && n.d.root;
      if (!beat || (ctx && beat.context && ctx !== beat.context) || (beat.root !== isRoot && n.type === "c")) {
        beat = { index: beats.length, chapter, context: ctx, root: isRoot, items: [], concepts: 0, sources: 0, standards: 0, t: n.t, firstOfContext: false };
        beats.push(beat);
        chapter.beats.push(beat);
      }
      if (ctx && !beat.context) beat.context = ctx;
      if (ctx && ctx !== "schemalattice" && !chapter.grown.includes(titles.get(ctx) || ctx)) chapter.grown.push(titles.get(ctx) || ctx);
      if (ctx && !seenContext.has(ctx)) {
        seenContext.add(ctx);
        beat.firstOfContext = true;
        if (ctx !== "schemalattice") chapter.newContexts.push(titles.get(ctx) || ctx);
      }
      beat.items.push(n);
      beat.t = n.t;
      if (n.type === "c") { beat.concepts++; if (!n.d.root) chapter.concepts++; }
      else if (n.d.kind === "standard") { beat.standards++; chapter.standards++; }
      else { beat.sources++; chapter.sources++; }
      n.beat = beat.index;
      n.chapter = chapter.index;
    }
    // The last frame is today: the searches nobody could answer yet.
    const FINAL = beats.length;
    for (const n of nodes) if (n.type === "d") { n.beat = FINAL; n.chapter = chapters.length - 1; }

    function chapterTitle(ch) {
      if (ch.beats.length === 1 && ch.beats[0].root) return fmt(ch.start) + " · The root vocabulary";
      const parts = [];
      if (ch.newContexts.length) parts.push(plural(ch.newContexts.length, "new context"));
      else if (ch.grown.length) parts.push(listOf(ch.grown, 2) + " grows");
      if (ch.concepts) parts.push(plural(ch.concepts, "concept"));
      if (ch.sources) parts.push(plural(ch.sources, "public dataset"));
      if (ch.standards) parts.push(plural(ch.standards, "standard"));
      return fmt(ch.start) + " · " + (parts.join(", ") || "updates");
    }
    function beatText(b) {
      if (b.root) return "Sixteen abstract roots (Person, Event, Location, Record…) that every later concept must trace back to.";
      const extras = [];
      if (b.sources) extras.push(plural(b.sources, "public dataset"));
      if (b.standards) extras.push(plural(b.standards, "published standard"));
      if (b.context) {
        const name = titles.get(b.context) || b.context;
        return name + (b.firstOfContext ? " arrives with " : " grows by ") + plural(b.concepts, "concept") +
          (extras.length ? ", alongside " + extras.join(" and ") + " listed in the same step" : "") + ".";
      }
      const places = [...new Set(b.items.map((n) => n.d.jurisdiction))];
      return extras.join(" and ") + " listed (" + listOf(places, 3) + "), their fields mapped onto existing concepts.";
    }
    function frameText(f) {
      if (f >= FINAL) {
        return { chapter: "Today", beat: data.demand.length
          ? plural(data.demand.length, "search", "searches") + " found nothing close yet. The dashed rings sit near what people were looking for: what to build next."
          : "Every recent search found something to build on." };
      }
      const b = beats[f];
      return { chapter: chapterTitle(b.chapter), beat: beatText(b) };
    }

    // --- draw ---------------------------------------------------------------------
    const gAxis = el("g", {}, svg), gEdges = el("g", {}, svg), gCtx = el("g", {}, svg), gNodes = el("g", {}, svg), gFx = el("g", {}, svg), gLbl = el("g", {}, svg);
    // Every line, with the two marks it joins, so a change of view can move it.
    const allEdges = [];
    const edge = (cls, a, b, extra) => {
      const line = el("line", { class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(extra || {}) }, gEdges);
      allEdges.push({ line, a, b });
      return line;
    };
    for (const n of nodes) {
      if (n.type !== "c") continue;
      if (n.d.forkedFrom && byUri.has(n.d.forkedFrom)) {
        const p = byUri.get(n.d.forkedFrom);
        n.edges = (n.edges || []).concat({ line: edge("fork off", p, n, { pathLength: 1 }), other: p });
      }
      for (const u of n.d.coRefersWith || []) {
        const p = byUri.get(u);
        if (p) n.edges = (n.edges || []).concat({ line: edge("coref e off", n, p), other: p });
      }
      // "A kind of": shown in the lineage view only.
      for (const u of n.d.broader || []) {
        const p = byUri.get(u);
        if (p) n.edges = (n.edges || []).concat({ line: edge("kind e off", n, p), other: p, kind: true });
      }
    }
    for (const n of nodes) {
      if (n.type === "s") {
        n.lines = n.d.concepts.map((c) => byUri.get(c.conceptUri)).filter(Boolean)
          .map((p) => edge("srcline", n, p, { "data-to": p.d.uri }));
        n.el = el("path", { class: "s n off", d: "M" + n.x + " " + (n.y - 6) + " L" + (n.x + 6) + " " + n.y + " L" + n.x + " " + (n.y + 6) + " L" + (n.x - 6) + " " + n.y + " Z" }, gNodes);
      } else if (n.type === "d") {
        n.el = el("circle", { class: "d n off", cx: n.x, cy: n.y, r: n.r }, gNodes);
      } else {
        n.ring = el("circle", { class: "ring n off", cx: n.x, cy: n.y, r: n.r + 3 }, gNodes);
        n.el = el("circle", { class: "c n off" + (n.d.root ? " root" : ""), cx: n.x, cy: n.y, r: n.r }, gNodes);
        const flip = n.x > W - 160;
        n.lbl = el("text", { class: "lbl off", x: flip ? n.x - n.r - 3 : n.x + n.r + 3, y: n.y + 4, "text-anchor": flip ? "end" : "start" }, gLbl);
        n.lbl.textContent = n.d.label;
      }
      const hit = el("circle", { class: "hit off", cx: n.x, cy: n.y, r: Math.max(n.r + 5, 10) }, gNodes);
      n.hit = hit;
      hit.addEventListener("pointerenter", (e) => { showTip(n, e); highlight(n, true); });
      hit.addEventListener("pointermove", (e) => showTip(n, e));
      hit.addEventListener("pointerleave", () => { tip.style.display = "none"; highlight(n, false); });
      hit.addEventListener("click", () => select(n));
    }

    // Context names: placed without collisions by size; a small context is named
    // only while it is the one arriving.
    const groups = new Map();
    for (const n of nodes) if (n.type === "c") {
      const g = groups.get(n.d.context) || []; g.push(n); groups.set(n.d.context, g);
    }
    const ctxLabels = new Map();
    for (const [slug] of groups) {
      const t = el("text", { class: "ctx off", "text-anchor": "middle" }, gCtx);
      t.textContent = titles.get(slug) || slug;
      ctxLabels.set(slug, { el: t, free: false });
    }
    // Named at the middle of their concepts, biggest first, skipping any name that would collide.
    function placeContextNames() {
      const placedBoxes = [];
      for (const [slug, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
        const l = ctxLabels.get(slug), text = l.el.textContent;
        const cx = g.reduce((s, n) => s + n.x, 0) / g.length;
        let cy = g.reduce((s, n) => s + n.y, 0) / g.length - 14;
        const w = text.length * 8 + 8;
        const box = (y) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: y - 12, y1: y + 4 });
        const hits = (b) => placedBoxes.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
        let tries = 0;
        while (hits(box(cy)) && tries < 6) { cy += (tries % 2 ? -1 : 1) * 18 * (tries + 1); tries++; }
        l.free = !hits(box(cy)) && g.length >= 3;
        if (l.free) placedBoxes.push(box(cy));
        l.el.setAttribute("x", Math.min(W - w / 2, Math.max(w / 2, cx)));
        l.el.setAttribute("y", cy);
      }
    }
    placeContextNames();

    // --- growth chart: cumulative concepts and sources, by step -------------------
    const gs = $("growthSvg");
    const steps = FINAL + 1;
    const cum = [];
    let cc = 0, cs = 0;
    for (let f = 0; f < steps; f++) {
      if (f < FINAL) { cc += beats[f].concepts; cs += beats[f].sources + beats[f].standards; }
      cum.push({ c: cc, s: cs });
    }
    const maxY = Math.max(1, cc, cs);
    const gx = (f) => 8 + (f / Math.max(1, steps - 1)) * (1000 - 16);
    const gy = (v) => 56 - (v / maxY) * 48;
    for (const v of [0.5, 1]) el("line", { class: "grid", x1: 0, x2: 1000, y1: gy(maxY * v), y2: gy(maxY * v), "vector-effect": "non-scaling-stroke" }, gs);
    const stepPath = (key) => cum.map((p, f) => (f ? "H" + gx(f) + " V" : "M" + gx(0) + " ") + gy(p[key])).join(" ");
    el("path", { class: "gl s", d: stepPath("s"), "vector-effect": "non-scaling-stroke" }, gs);
    el("path", { class: "gl c", d: stepPath("c"), "vector-effect": "non-scaling-stroke" }, gs);
    for (const ch of chapters) {
      const f = ch.beats[0].index;
      el("line", { class: "tick", x1: gx(f), x2: gx(f), y1: 58, y2: 64, "vector-effect": "non-scaling-stroke" }, gs);
    }
    const head = el("line", { class: "head", x1: 0, x2: 0, y1: 2, y2: 62, "vector-effect": "non-scaling-stroke" }, gs);
    const frameAt = (clientX) => {
      const box = gs.getBoundingClientRect();
      const x = ((clientX - box.left) / box.width) * 1000;
      return Math.max(0, Math.min(steps - 1, Math.round(((x - 8) / (1000 - 16)) * (steps - 1))));
    };
    gs.addEventListener("click", (e) => go(frameAt(e.clientX)));
    gs.addEventListener("mousemove", (e) => {
      const f = frameAt(e.clientX), g = $("gtip");
      g.textContent = (f >= FINAL ? "Today" : fmtShort(beats[f].t)) + " · " + cum[f].c + " concepts, " + cum[f].s + " sources";
      g.style.display = "block";
      g.style.left = ((gx(f) / 1000) * gs.getBoundingClientRect().width) + "px";
    });
    gs.addEventListener("mouseleave", () => { $("gtip").style.display = "none"; });

    // --- one frame of the story -----------------------------------------------------
    const slider = $("t");
    slider.max = String(FINAL);
    const showAsk = $("showAsk"), showSrc = $("showSrc"), showLbl = $("showLbl");
    let frame = FINAL;
    const counts = { c: 0, x: 0, s: 0 };
    let countAnim = null;

    function apply(f, opts) {
      const previous = frame;
      frame = f;
      slider.value = String(f);
      const curChapter = f >= FINAL ? chapters.length - 1 : beats[f].chapter.index;
      const hotContext = f < FINAL ? beats[f].context : null;
      $("tl").textContent = f >= FINAL ? "Today" : fmtShort(beats[f].t) + ", " + fmtTime(beats[f].t);
      const visibleCount = new Map();
      let nConcepts = 0, nSources = 0;
      const contexts = new Set();
      const arriving = [];
      for (const n of nodes) {
        let on = n.beat <= f;
        if (n.type === "d") on = on && showAsk.checked;
        if (n.type === "s") on = on && showSrc.checked;
        const wasOn = !n.el.classList.contains("off");
        const dim = on && !inFocus(n);
        n.el.classList.toggle("off", !on);
        n.el.classList.toggle("dim", dim);
        n.hit.classList.toggle("off", !on);
        for (const l of n.lines || []) if (!on) l.classList.remove("on");
        if (on && !wasOn && opts.ripple) arriving.push(n);
        if (n.type === "s" && n.beat <= f) nSources++;
        if (n.type !== "c") continue;
        // Without a focus, blue is what is new in the chapter; with one, blue is the focus
        // (or, comparing two apps, what they share).
        const isNew = focus
          ? on && !dim && (focus.shared ? focus.shared.has(n.d.uri) : true)
          : on && !n.d.root && n.chapter === curChapter;
        n.el.classList.toggle("new", isNew);
        n.el.classList.toggle("bonly", !!(on && focus && focus.bOnly && focus.bOnly.has(n.d.uri)));
        n.ring.classList.toggle("off", !isNew || !!focus);
        n.lbl.classList.toggle("rootlbl", view === "lineage" && n.d.root);
        n.lbl.classList.toggle("off", !on || dim || !(showLbl.checked || n.r >= 7.5 || n === selected || (focus && focus.labels) || (view === "lineage" && n.d.root) || (!focus && hotContext && n.d.context === hotContext && n.beat === f)));
        for (const e of n.edges || []) {
          e.line.classList.toggle("off", !on || e.other.beat > f || (!!e.kind && view !== "lineage"));
          e.line.classList.toggle("dim", !!focus && !(inFocus(n) && inFocus(e.other)));
        }
        if (on) {
          visibleCount.set(n.d.context, (visibleCount.get(n.d.context) || 0) + 1);
          if (!n.d.root) { nConcepts++; contexts.add(n.d.context); }
        }
      }
      const focusCtx = focus ? contextsOf(focus.concepts) : null;
      for (const [slug, l] of ctxLabels) {
        const hot = !focus && slug === hotContext;
        const seen = visibleCount.get(slug) || 0;
        l.el.classList.toggle("off", view !== "meaning" || !((l.free && seen >= 3) || (hot && seen > 0)));
        l.el.classList.toggle("hot", hot);
        l.el.classList.toggle("dim", !!focusCtx && !focusCtx.has(slug));
      }
      head.setAttribute("x1", gx(f)); head.setAttribute("x2", gx(f));
      for (const b of document.querySelectorAll("#chapters button")) {
        if (Number(b.dataset.chapter) === curChapter) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      }
      // Narration.
      const t = frameText(f), text = $("storyText");
      const swap = () => { $("chapterText").textContent = t.chapter; $("beatText").textContent = t.beat; text.classList.remove("fade"); };
      if (opts.animate && !reduceMotion && previous !== f) { text.classList.add("fade"); setTimeout(swap, 180); } else swap();
      tweenCounts({ c: nConcepts, x: contexts.size, s: nSources }, opts.animate);
      if (!reduceMotion) for (const n of arriving.slice(0, 40)) ripple(n);
      $("mapDesc").textContent = t.chapter + ". " + t.beat + " " + plural(nConcepts, "concept") + " in " + plural(contexts.size, "context") + ", " + plural(nSources, "source") + ".";
    }
    function tweenCounts(to, animate) {
      if (countAnim) cancelAnimationFrame(countAnim);
      const from = { ...counts }, start = performance.now(), dur = animate && !reduceMotion ? 600 : 0;
      const render = () => {
        const out = $("counts");
        out.replaceChildren();
        const c = Math.round(counts.c), x = Math.round(counts.x), s = Math.round(counts.s);
        html("b", String(c), out); out.append(c === 1 ? " concept · " : " concepts · ");
        html("b", String(x), out); out.append(x === 1 ? " context · " : " contexts · ");
        html("b", String(s), out); out.append(s === 1 ? " source" : " sources");
      };
      const step = (now) => {
        const k = dur ? Math.min(1, (now - start) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
        for (const key of ["c", "x", "s"]) counts[key] = from[key] + (to[key] - from[key]) * e;
        render();
        if (k < 1) countAnim = requestAnimationFrame(step);
      };
      step(start);
    }
    function ripple(n) {
      const r = el("circle", { class: "ripple" + (n.type === "s" ? " src" : n.type === "d" ? " ask" : ""), cx: n.x, cy: n.y, r: n.r + 1 }, gFx);
      setTimeout(() => r.remove(), 1200);
    }
    function go(f, animate = true) {
      stop();
      apply(f, { animate, ripple: animate && Math.abs(f - frame) === 1 });
    }

    // --- playback, paced by the story ------------------------------------------------
    let timer = null;
    const playBtn = $("play");
    function hold(f) {
      if (f >= FINAL) return 2600;
      const b = beats[f];
      return (b.chapter.beats[0] === b ? 2000 : 1100) + Math.min(10, b.items.length) * 70;
    }
    function stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      playBtn.textContent = "Play";
    }
    function play() {
      if (timer) return stop();
      if (frame >= FINAL) apply(0, { animate: false, ripple: false });
      playBtn.textContent = "Pause";
      const next = () => {
        if (frame >= FINAL) return stop();
        apply(frame + 1, { animate: true, ripple: true });
        timer = setTimeout(next, hold(frame));
      };
      timer = setTimeout(next, hold(frame));
    }
    playBtn.addEventListener("click", play);
    slider.addEventListener("input", () => go(Number(slider.value)));
    for (const box of [showAsk, showSrc, showLbl]) box.addEventListener("change", () => apply(frame, { animate: false, ripple: false }));
    lensSel.addEventListener("change", () => { if (!lensSel.value.startsWith("app:")) withSel.value = ""; refocus(); });
    withSel.addEventListener("change", refocus);
    let qTimer = null;
    qIn.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(refocus, 150); });
    $("clear").addEventListener("click", () => { lensSel.value = ""; withSel.value = ""; qIn.value = ""; refocus(); });
    const focusOn = (value) => { lensSel.value = value; withSel.value = ""; refocus(); lensSel.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }); };

    // --- chapters card ---------------------------------------------------------------
    for (const ch of chapters) {
      const li = html("li", undefined, $("chapters"));
      const b = html("button", undefined, li);
      b.type = "button";
      b.dataset.chapter = String(ch.index);
      const last = ch.beats[ch.beats.length - 1].index;
      html("span", fmt(ch.start) + ", " + fmtTime(ch.start), b, "when");
      const what = ch.beats.length === 1 && ch.beats[0].root
        ? "The root vocabulary: 16 abstract concepts."
        : [ch.newContexts.length ? listOf(ch.newContexts, 4) : ch.grown.length ? listOf(ch.grown, 4) : null,
           [ch.concepts ? plural(ch.concepts, "concept") : null, ch.sources ? plural(ch.sources, "dataset") : null, ch.standards ? plural(ch.standards, "standard") : null].filter(Boolean).join(", ")]
          .filter(Boolean).join(": ") + ".";
      html("div", what, b, "muted");
      b.addEventListener("click", () => go(last));
    }

    // --- describe, select ----------------------------------------------------------------
    function highlight(n, on) {
      const lines = n.type === "s" ? n.lines : nodes.filter((m) => m.type === "s").flatMap((m) => m.lines.filter((l) => l.dataset.to === (n.d.uri || "")));
      for (const l of lines || []) l.classList.toggle("on", on || selected === n);
    }
    function describe(n) {
      if (n.type === "c") {
        const c = n.d;
        return [c.label, (titles.get(c.context) || c.context) + (c.kind ? " · " + c.kind : "") + (c.root ? " · root" : ""),
          "Added " + fmt(n.t) + " · " + c.forks + " forks · " + c.usages + " apps · " + c.publicSources + " datasets"]
          .concat(appsOf.has(c.uri) ? ["Used by " + listOf(appsOf.get(c.uri), 4)] : []);
      }
      if (n.type === "s") return [n.d.title, (n.d.kind === "standard" ? "Published standard · " : "Public dataset · ") + n.d.jurisdiction, n.d.concepts.length + " concepts mapped"];
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
      apply(frame, { animate: false, ripple: false });
      detail.replaceChildren();
      const [headLine, ...rest] = describe(n);
      html("strong", headLine, detail);
      for (const line of rest) { html("br", undefined, detail); html("span", line, detail, "muted"); }
      html("br", undefined, detail);
      if (n.type === "d") {
        html("span", "Nearest concept: " + (n.d.nearest && byUri.get(n.d.nearest) ? byUri.get(n.d.nearest).d.label : "none"), detail, "muted");
      } else {
        const a = html("a", n.type === "c" ? "Open the record" : "Open the source page", detail);
        a.href = n.type === "c" ? path(n.d.uri) : "/sources/" + encodeURIComponent(n.d.slug);
      }
    }

    // --- the other cards and the table ------------------------------------------------
    const max = Math.max(...data.contexts.map((c) => c.concepts));
    for (const c of data.contexts.filter((c) => c.slug !== "schemalattice").slice(0, 10)) {
      const bar = html("button", undefined, html("li", undefined, $("focus")), "bar");
      bar.type = "button";
      bar.setAttribute("aria-label", "Focus the map on " + c.title + ", " + plural(c.concepts, "concept"));
      html("span", c.title, bar).title = c.title;
      const track = html("span", undefined, bar);
      html("i", undefined, track).style.width = (100 * c.concepts / max) + "%";
      html("b", String(c.concepts), bar);
      bar.addEventListener("click", () => focusOn("ctx:" + c.slug));
    }
    for (const q of data.demand.slice(0, 6)) {
      const li = html("li", "“" + q.text + "”", $("asks"));
      html("span", " ×" + q.count, li, "muted");
    }
    if (!data.demand.length) html("li", "No unmet searches.", $("asks"), "muted");
    const places = new Map();
    for (const s of data.sources) if (s.kind !== "standard") places.set(s.jurisdiction, (places.get(s.jurisdiction) || 0) + 1);
    for (const [j, n] of [...places].sort()) {
      const li = html("li", undefined, $("places"));
      const a = html("a", placeName(j), li); a.href = "/sources?jurisdiction=" + encodeURIComponent(j);
      html("span", " · " + plural(n, "dataset") + " · ", li, "muted");
      const b = html("button", "Show", li, "linkish"); b.type = "button";
      b.setAttribute("aria-label", "Show " + j + " on the map");
      b.addEventListener("click", () => focusOn("place:" + j));
    }
    if (!places.size) html("li", "No public datasets yet.", $("places"), "muted");
    for (const n of nodes.filter((n) => n.type === "c").sort((a, b) => b.t - a.t)) {
      const tr = html("tr", undefined, $("rows"));
      n.row = tr;
      const a = html("a", n.d.label, html("td", undefined, tr)); a.href = path(n.d.uri);
      html("td", titles.get(n.d.context) || n.d.context, tr);
      html("td", fmt(n.t), tr);
      html("td", String(n.d.forks), tr);
      html("td", String(n.d.usages), tr);
      html("td", String(n.d.publicSources), tr);
    }


    // --- views: the same marks, laid out four ways ---------------------------------
    const pcCount = Math.min(...data.concepts.map((c) => (c.pc || []).length).concat([6]));
    const TOUR = [[0, 1], [2, 1], [2, 3], [4, 3], [4, 5], [0, 5], [0, 1]].filter(([a, b]) => a < pcCount && b < pcCount);
    let tourPos = 0;
    const angle = $("angle");
    angle.max = String(Math.max(0, TOUR.length - 1));
    const at = (u, v) => [PAD + u * (W - 2 * PAD), PAD + v * (H - 2 * PAD)];
    function tourAxes(sPos) {
      const k = Math.min(TOUR.length - 2, Math.floor(sPos)), t = sPos - k, th = t * Math.PI / 2;
      const [ax, ay] = TOUR[k], [bx, by] = TOUR[k + 1];
      return {
        x: ax === bx ? [[ax, 1]] : [[ax, Math.cos(th)], [bx, Math.sin(th)]],
        y: ay === by ? [[ay, 1]] : [[ay, Math.cos(th)], [by, Math.sin(th)]],
      };
    }
    const proj = (pc, terms) => 0.5 + terms.reduce((t, [c, w]) => t + w * (((pc || [])[c] ?? 0.5) - 0.5), 0);
    const conceptNodes = nodes.filter((n) => n.type === "c");
    // The concepts at each end of each direction, to name what a direction means.
    const ends = Array.from({ length: pcCount }, (_, c) => {
      const sorted = conceptNodes.filter((n) => !n.d.root).sort((a, b) => a.d.pc[c] - b.d.pc[c]);
      return { low: sorted.slice(0, 3).map((n) => n.d.label), high: sorted.slice(-3).reverse().map((n) => n.d.label) };
    });

    function lineagePlaces() {
      const level = new Map();
      const lv = (n, seen) => {
        if (n.d.root) return 0;
        if (level.has(n)) return level.get(n);
        if (seen.has(n)) return 1;
        seen.add(n);
        const parents = (n.d.broader || []).concat(n.d.forkedFrom ? [n.d.forkedFrom] : []).map((u) => byUri.get(u)).filter(Boolean);
        const v = 1 + Math.max(0, ...parents.map((p) => lv(p, seen)));
        level.set(n, v);
        return v;
      };
      const families = new Map();
      for (const n of conceptNodes) {
        const key = n.d.root ? n.d.uri : n.d.rootAncestor || "none";
        if (!families.has(key)) families.set(key, []);
        families.get(key).push(n);
      }
      const SP = 15;
      const fams = [...families].map(([key, members]) => {
        const head = members.find((m) => m.d.uri === key) || null;
        const rest = members.filter((m) => m !== head).sort((a, b) => lv(a, new Set()) - lv(b, new Set()) ||
          a.d.context.localeCompare(b.d.context) || a.d.label.localeCompare(b.d.label));
        return { head, rest, radius: SP * Math.sqrt(rest.length + 1) + 18 };
      }).sort((a, b) => b.rest.length - a.rest.length);
      // Shelf-pack the families into rows shaped like the map.
      const area = fams.reduce((t, f) => t + (2 * f.radius) ** 2, 0);
      const rowWidth = Math.sqrt(area * (W - 2 * PAD) / (H - 2 * PAD)) * 1.05;
      let x = 0, y = 0, rowH = 0, maxX = 0;
      for (const f of fams) {
        const d = 2 * f.radius;
        if (x > 0 && x + d > rowWidth) { y += rowH; x = 0; rowH = 0; }
        f.cx = x + f.radius; f.cy = y + f.radius;
        x += d; rowH = Math.max(rowH, d); maxX = Math.max(maxX, x);
      }
      const totalH = y + rowH;
      const scale = Math.min((W - 2 * PAD) / (maxX || 1), (H - 2 * PAD) / (totalH || 1));
      const offX = (W - maxX * scale) / 2, offY = (H - totalH * scale) / 2;
      for (const f of fams) {
        const cx = offX + f.cx * scale, cy = offY + f.cy * scale;
        if (f.head) { f.head.bx = cx; f.head.by = cy; }
        // Golden-angle spiral around the root: the nearest ring is the root's direct kinds.
        f.rest.forEach((n, i) => {
          const rad = SP * scale * Math.sqrt(i + 1.6), ang = i * 2.39996;
          n.bx = cx + Math.cos(ang) * rad; n.by = cy + Math.sin(ang) * rad;
        });
      }
    }

    function basePositions(mode) {
      if (mode === "meaning") {
        for (const n of nodes) if (n.type !== "s") { n.bx = n.x0; n.by = n.y0; }
      } else if (mode === "turn") {
        const ax = tourAxes(tourPos);
        for (const n of nodes) if (n.type !== "s") [n.bx, n.by] = at(proj(n.d.pc, ax.x), proj(n.d.pc, ax.y));
      } else if (mode === "lineage") {
        lineagePlaces();
      } else if (mode === "time") {
        for (const n of conceptNodes) [n.bx, n.by] = [PAD + (n.beat / Math.max(1, FINAL)) * (W - 2 * PAD), n.y0];
      }
      if (mode === "lineage" || mode === "time") {
        // An unmet search sits beside the concept it came closest to.
        for (const n of nodes) if (n.type === "d") {
          const m = n.d.nearest && byUri.get(n.d.nearest);
          if (mode === "time") [n.bx, n.by] = [W - PAD / 2, n.y0];
          else if (m) [n.bx, n.by] = [m.bx + 16, m.by - 16];
          else [n.bx, n.by] = [W - PAD / 2, PAD];
        }
      }
      for (const n of nodes) if (n.type === "s") {
        n.bx = n.anchor.bx + Math.cos(n.ang) * n.dist; n.by = n.anchor.by + Math.sin(n.ang) * n.dist;
      }
    }

    const diamond = (x, y) => "M" + x + " " + (y - 6) + " L" + (x + 6) + " " + y + " L" + x + " " + (y + 6) + " L" + (x - 6) + " " + y + " Z";
    function render() {
      for (const n of nodes) {
        if (n.type === "s") n.el.setAttribute("d", diamond(n.x, n.y));
        else { n.el.setAttribute("cx", n.x); n.el.setAttribute("cy", n.y); }
        if (n.ring) { n.ring.setAttribute("cx", n.x); n.ring.setAttribute("cy", n.y); }
        n.hit.setAttribute("cx", n.x); n.hit.setAttribute("cy", n.y);
        if (n.lbl) {
          const flip = n.x > W - 160;
          n.lbl.setAttribute("x", flip ? n.x - n.r - 3 : n.x + n.r + 3);
          n.lbl.setAttribute("y", n.y + 4);
          n.lbl.setAttribute("text-anchor", flip ? "end" : "start");
        }
      }
      for (const e of allEdges) {
        e.line.setAttribute("x1", e.a.x); e.line.setAttribute("y1", e.a.y);
        e.line.setAttribute("x2", e.b.x); e.line.setAttribute("y2", e.b.y);
      }
    }

    // Axis notes: what each edge of the map means in this view.
    function drawAxis() {
      gAxis.replaceChildren();
      const text = (x, y, s, anchor) => { const t = el("text", { x, y, "text-anchor": anchor || "start" }, gAxis); t.textContent = s; return t; };
      if (view === "turn") {
        const ax = tourAxes(tourPos);
        const dominant = (terms) => terms.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
        const [cx] = dominant(ax.x), [cy] = dominant(ax.y);
        text(8, H - 10, "← " + ends[cx].low.join(", "));
        text(W - 8, H - 10, ends[cx].high.join(", ") + " →", "end");
        text(8, 16, "↑ " + ends[cy].low.join(", "));
        text(8, H - 28, "↓ " + ends[cy].high.join(", "));
        const name = (terms) => terms.filter(([, w]) => Math.abs(w) > 0.02).map(([c]) => c + 1).join(" turning to ");
        $("angleText").textContent = "direction " + name(ax.x) + " across, " + name(ax.y) + " down";
      } else if (view === "time") {
        let lastX = -Infinity, lastDay = "";
        for (const ch of chapters) {
          const x = PAD + (ch.beats[0].index / Math.max(1, FINAL)) * (W - 2 * PAD);
          el("line", { x1: x, x2: x, y1: 8, y2: H - 24 }, gAxis);
          if (x - lastX < 64) continue;
          lastX = x;
          const day = fmtShort(ch.start);
          text(x + 3, H - 8, day === lastDay ? fmtTime(ch.start) : day);
          lastDay = day;
        }
        text(W - 8, 16, "Today →", "end");
      }
    }

    let moveAnim = null;
    function moveTo(animate) {
      basePositions(view);
      if (view === "turn") for (const n of nodes) { n.tx = n.bx; n.ty = n.by; }
      else relax(nodes);
      if (moveAnim) cancelAnimationFrame(moveAnim);
      const from = nodes.map((n) => [n.x, n.y]);
      const done = () => {
        svg.classList.remove("moving");
        if (view === "meaning") placeContextNames();
        drawAxis();
        apply(frame, { animate: false, ripple: false });
      };
      if (!animate || reduceMotion) {
        for (const n of nodes) { n.x = n.tx; n.y = n.ty; }
        render(); done(); return;
      }
      svg.classList.add("moving");
      gAxis.replaceChildren();
      const start = performance.now(), dur = 950;
      const step = (now) => {
        const k = Math.min(1, (now - start) / dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        nodes.forEach((n, i) => { n.x = from[i][0] + (n.tx - from[i][0]) * e; n.y = from[i][1] + (n.ty - from[i][1]) * e; });
        render();
        if (k < 1) moveAnim = requestAnimationFrame(step); else { moveAnim = null; done(); }
      };
      moveAnim = requestAnimationFrame(step);
    }

    // Turning: follow the angle exactly, no settling, so the cloud reads as one solid thing.
    function turnTo(sPos) {
      tourPos = Math.max(0, Math.min(TOUR.length - 1, sPos));
      angle.value = String(tourPos);
      basePositions("turn");
      for (const n of nodes) { n.x = n.tx = n.bx; n.y = n.ty = n.by; }
      render();
      drawAxis();
    }
    let turnTimer = null;
    const turnBtn = $("turnPlay");
    function stopTurn() { if (turnTimer) cancelAnimationFrame(turnTimer); turnTimer = null; turnBtn.textContent = "Turn"; }
    turnBtn.addEventListener("click", () => {
      if (turnTimer) return stopTurn();
      if (reduceMotion) { turnTo((Math.floor(tourPos) + 1) % TOUR.length); return; }
      turnBtn.textContent = "Stop";
      let last = performance.now();
      const step = (now) => {
        const next = tourPos + ((now - last) / 4000);
        last = now;
        turnTo(next >= TOUR.length - 1 ? 0 : next);
        turnTimer = requestAnimationFrame(step);
      };
      turnTimer = requestAnimationFrame(step);
    });
    angle.addEventListener("input", () => { stopTurn(); turnTo(Number(angle.value)); });

    const quality = data.layoutQuality;
    const NOTES = {
      meaning: "Placed by meaning" + (quality ? ": about " + Math.round(quality.meaning * 100) + "% of each concept's " + quality.neighbours +
        " nearest neighbours in meaning are among its nearest here (a straight projection keeps " + Math.round(quality.pca * 100) + "%)." : "."),
      turn: "Meaning has hundreds of directions; this turns through the six that spread the catalog most, one swap at a time. The words at the edges name the concepts furthest out each way.",
      lineage: "Grouped around the root each concept descends from. Lines show what each is a kind of, and forks.",
      time: "Left to right in the order things arrived, a column per step of the story; up and down still follows meaning.",
    };
    function setView(v, animate) {
      if (!NOTES[v] || (v === "turn" && TOUR.length < 2)) v = "meaning";
      stopTurn();
      view = v;
      for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-pressed", String(b.dataset.view === v));
      $("turnCtl").hidden = v !== "turn";
      $("viewNote").textContent = NOTES[v];
      moveTo(animate);
    }
    for (const b of document.querySelectorAll(".views button")) b.addEventListener("click", () => { setView(b.dataset.view, true); syncUrl(); });

    // A shared link opens on its focus: /atlas?focus=app:<slug>&with=<slug>&q=<text>.
    const params = new URLSearchParams(location.search);
    const wanted = params.get("focus") || "";
    if ([...lensSel.options].some((o) => o.value === wanted)) lensSel.value = wanted;
    if (params.get("with") && apps.has(params.get("with"))) withSel.value = params.get("with");
    qIn.value = (params.get("q") || "").slice(0, 80);
    focus = computeFocus();
    renderInfo();
    for (const n of nodes) if (n.row) n.row.hidden = !!focus && !inFocus(n);

    // Open on today, fully built; play tells the story from the start.
    frame = FINAL;
    setView(params.get("view") || "meaning", false);
    $("beatText").textContent += " Press Play to watch the catalog being built, chapter by chapter.";
  }

  // Push overlapping marks apart while pulling each back toward where meaning put it.
  // Reads each mark's wanted place (bx, by), writes where it can sit (tx, ty).
  function relax(nodes) {
    for (const n of nodes) { n.x0s = n.x; n.y0s = n.y; n.x = n.bx; n.y = n.by; }
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
        n.x += (n.bx - n.x) * 0.03; n.y += (n.by - n.y) * 0.03;
        n.x = Math.min(W - 12, Math.max(12, n.x)); n.y = Math.min(H - 12, Math.max(12, n.y));
      }
    }
    for (const n of nodes) {
      n.tx = Math.round(n.x * 10) / 10; n.ty = Math.round(n.y * 10) / 10;
      n.x = n.x0s; n.y = n.y0s;
    }
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
