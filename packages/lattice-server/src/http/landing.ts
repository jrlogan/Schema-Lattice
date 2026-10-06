// The human front door. Browsers hitting `/` get this page; API clients
// still get the JSON index (content negotiation in server.ts), and
// `/llms.txt` gives an AI reader the same account in plain markdown.
//
// Two readers, one page. A person has to be able to answer "why would I
// care" and "should I trust it" without asking anybody; an AI fetching the
// page has to find the same facts in text, because it never sees the
// animation. So every claim the animation makes is also a sentence, and the
// animation is labelled as an illustration.
//
// Design constraints: self-contained (no external assets), honest about
// what the catalog records and what is not built yet, and it must hand a
// visitor the exact prompt to paste into their AI — the site's real user is
// somebody's coding assistant, and the human just needs to make the
// introduction.

export interface LandingTotals {
  concepts: number;
  contexts: number;
  apps?: number;
}

function assistantPrompt(host: string): string {
  return `I want to check my app's data models against SchemaLattice, a shared
catalog of data-model concepts. This instance: https://${host}

1. Fetch https://${host}/skill and follow those instructions READ-ONLY.
2. For each entity/table in my app, describe what it means in plain
   English and call GET https://${host}/discover?description=...
   (reuse the sessionId the first response returns).
3. Give me a table: my entity | best match | similarity | verdict
   (adopt >=0.85, fork 0.65-0.85, distant 0.55-0.65, else no match).
4. Do not publish anything and do not change my code.
5. Optionally, when done: POST one short note about what worked and
   what didn't to https://${host}/api/tools/lattice_feedback
   (JSON body: {"message": "...", "rating": 1-5}).`;
}

const EXAMPLE_CONCEPT = "/c/board-governance/motion@bf35863e004c";

export function landingPage(host: string, totals: LandingTotals): string {
  const h = escapeHtml(host);
  const apps = totals.apps !== undefined ? ` and ${totals.apps} registered apps` : "";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "SchemaLattice",
    description:
      "A public, forkable catalog of data-model concepts with content-addressed URIs and recorded lineage, " +
      "built for AI coding assistants so independently built apps can share vocabulary.",
    url: `https://${host}/`,
    isAccessibleForFree: true,
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `https://${host}/api/tools` },
      { "@type": "DataDownload", encodingFormat: "text/markdown", contentUrl: `https://${host}/llms.txt` },
    ],
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchemaLattice — shared meanings for apps that were built apart</title>
<meta name="description" content="A public catalog of data-model concepts with permanent, content-addressed identifiers and recorded lineage, so apps built by different people — or different AIs — can agree on what their fields mean.">
<link rel="alternate" type="text/markdown" href="/llms.txt" title="This page for AI readers">
<link rel="alternate" type="application/json" href="/" title="JSON index (send Accept: application/json)">
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root { color-scheme: light dark;
    --fg:#1a1f24; --bg:#fbfaf8; --muted:#5c6670; --line:#e3ded6;
    --card:#f2efe9; --accent:#0b6e6e; --accent-soft:#d8ecea; --warn:#b4541c; --ok:#2f7a3d; }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#e8e6e1; --bg:#15181b; --muted:#9aa4ad; --line:#2c3238;
    --card:#1d2226; --accent:#4cc0b8; --accent-soft:#16312f; --warn:#e08a55; --ok:#6fc07e; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:46rem; margin:0 auto; padding:3rem 1rem 4rem; }
  h1 { font-size:clamp(1.7rem, 5vw, 2.3rem); line-height:1.15; margin:0 0 .75rem; letter-spacing:-.01em; }
  h2 { font-size:1.2rem; margin:2.8rem 0 .6rem; }
  h3 { font-size:1rem; margin:1.4rem 0 .3rem; }
  .lede { font-size:1.12rem; margin:0 0 1rem; }
  .muted, .stat { color:var(--muted); }
  .stat { font-size:.9rem; }
  pre { background:var(--card); border:1px solid var(--line); border-radius:8px;
    padding:1rem; overflow-x:auto; font-size:.82rem; line-height:1.5;
    white-space:pre-wrap; word-break:break-word; }
  code { background:var(--card); padding:.1em .35em; border-radius:4px; font-size:.9em; overflow-wrap:anywhere; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; font-size:.92rem; }
  td { padding:.45rem .7rem .45rem 0; vertical-align:top; border-top:1px solid var(--line); }
  td:first-child { color:var(--muted); width:9.5rem; }
  a { color:var(--accent); }
  .agent { border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:6px;
    padding:.7rem 1rem; font-size:.92rem; background:var(--card); }
  .agent p { margin:.2rem 0; }
  ol.steps { padding-left:1.3rem; }
  ol.steps li { margin:.35rem 0; }
  .cols { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit, minmax(13rem, 1fr)); }
  .cols > div { border:1px solid var(--line); border-radius:8px; padding:.8rem 1rem; }
  .cols h3 { margin-top:0; }
  .cols p { margin:.3rem 0 0; font-size:.93rem; }
  .built { color:var(--ok); font-weight:600; }
  .notyet { color:var(--warn); font-weight:600; }

  /* ── the illustration ─────────────────────────────────────────────── */
  .stage svg.narrow { display:none; }
  @media (max-width:560px) {
    .stage svg.wide { display:none; } .stage svg.narrow { display:block; }
    .captions { min-height:6.4rem; }
    td { display:block; width:auto !important; padding:.1rem 0; }
    td:first-child { padding-top:.6rem; font-weight:600; }
    td + td { border-top:0; padding-bottom:.6rem; }
  }
  figure { margin:2rem 0 0; }
  .stage { position:relative; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow:hidden; }
  .stage svg { display:block; width:100%; height:auto; }
  .stage text { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; fill:var(--fg); }
  .stage .label { font-family:system-ui, sans-serif; font-size:12px; fill:var(--muted); letter-spacing:.04em; text-transform:uppercase; }
  .stage .title { font-family:system-ui, sans-serif; font-size:15px; font-weight:600; }
  .box { fill:var(--bg); stroke:var(--line); stroke-width:1.5; }
  .node { fill:var(--accent-soft); stroke:var(--accent); stroke-width:2; }
  .bad { stroke:var(--warn); stroke-width:2; stroke-dasharray:6 6; fill:none; }
  .link { stroke:var(--accent); stroke-width:2; fill:none; }
  .pair { stroke:var(--ok); stroke-width:1.5; fill:none; }
  .good { stroke:var(--ok); stroke-width:3; fill:none; }
  .fork-label { fill:var(--accent); font-size:12px !important; }
  .ok-text { fill:var(--ok) !important; font-family:system-ui, sans-serif !important; font-weight:600; }
  .warn-text { fill:var(--warn) !important; font-family:system-ui, sans-serif !important; font-weight:600; }
  .captions { position:relative; min-height:3.4rem; margin:.7rem .2rem 0; }
  .captions p { position:absolute; inset:0; margin:0; font-size:.95rem; opacity:0; }
  .captions b { color:var(--accent); }

  /* Four scenes over a 16s loop. Each layer fades in on its scene and
     everything resets together at the end, so the story reads in order. */
  .s1, .s2, .s3, .s4 { opacity:0; animation:16s infinite both; }
  .s1 { animation-name:scene1; } .s2 { animation-name:scene2; }
  .s3 { animation-name:scene3; } .s4 { animation-name:scene4; }
  .keep { opacity:1; }
  .captions .s1 { animation-name:cap1; } .captions .s2 { animation-name:cap2; }
  .captions .s3 { animation-name:cap3; } .captions .s4 { animation-name:cap4; }
  @keyframes scene1 { 0%,2% {opacity:0} 6%,20% {opacity:1} 25%,100% {opacity:0} }
  @keyframes scene2 { 0%,25% {opacity:0} 30%,96% {opacity:1} 100% {opacity:0} }
  @keyframes scene3 { 0%,50% {opacity:0} 55%,96% {opacity:1} 100% {opacity:0} }
  @keyframes scene4 { 0%,75% {opacity:0} 80%,96% {opacity:1} 100% {opacity:0} }
  @keyframes cap1 { 0%,2% {opacity:0} 5%,22% {opacity:1} 25%,100% {opacity:0} }
  @keyframes cap2 { 0%,25% {opacity:0} 28%,47% {opacity:1} 50%,100% {opacity:0} }
  @keyframes cap3 { 0%,50% {opacity:0} 53%,72% {opacity:1} 75%,100% {opacity:0} }
  @keyframes cap4 { 0%,75% {opacity:0} 78%,96% {opacity:1} 100% {opacity:0} }
  .draw { stroke-dasharray:420; animation:16s infinite both; }
  .s2 .draw { animation-name:draw2; } .s3 .draw { animation-name:draw3; } .s4 .draw { animation-name:draw4; }
  @keyframes draw2 { 0%,25% {stroke-dashoffset:420} 40%,100% {stroke-dashoffset:0} }
  @keyframes draw3 { 0%,50% {stroke-dashoffset:420} 65%,100% {stroke-dashoffset:0} }
  @keyframes draw4 { 0%,75% {stroke-dashoffset:420} 88%,100% {stroke-dashoffset:0} }

  /* Motion off: the finished picture, and every caption as a list. */
  @media (prefers-reduced-motion: reduce) {
    .s1, .s2, .s3, .s4, .draw { animation:none !important; }
    .stage .s2, .stage .s3, .stage .s4 { opacity:1; }
    .stage .s1 { opacity:0; }
    .draw { stroke-dashoffset:0; }
    .captions { min-height:0; }
    .captions p { position:static; opacity:1; margin:.3rem 0; }
  }
</style>
</head>
<body>
<main>
  <h1>Shared meanings for apps that were built apart.</h1>
  <p class="lede">When two apps need to exchange data, they first have to agree
  on what their fields mean. SchemaLattice is a public catalog of those
  meanings — each with a permanent identifier and a record of how it was
  adapted — so that agreement is made once, in the open, instead of in every
  integration.</p>
  <p class="stat">This instance holds ${totals.concepts} concepts in
  ${totals.contexts} contexts${apps}. Reads are public; publishing needs a key.
  Status: <strong>v0.1, experimental.</strong></p>

  <div class="agent" id="for-ai">
    <p><strong>If you are an AI agent:</strong> the working instructions are at
    <a href="/skill">/skill</a> (<a href="/skill/builder">/skill/builder</a> if you
    are building on someone else's backend). Every tool and its schema is at
    <a href="/api/tools">/api/tools</a>, callable over REST or MCP at
    <code>/mcp</code>. A plain-markdown version of this page is at
    <a href="/llms.txt">/llms.txt</a>. Reads need no key. App generators that
    cannot use MCP (Lovable, AI Studio, Bolt, v0) can read a paste-ready
    vocabulary from <a href="/pack">/pack</a>.</p>
  </div>

  <figure aria-describedby="fig-caption">
    <div class="stage">
      ${illustration("wide")}
      ${illustration("narrow")}
    </div>
    <div class="captions" id="fig-caption">
      <p class="s1"><b>1.</b> Two apps, built apart, store the same idea under different names. Neither can tell whether “text” and “motionText” mean the same thing.</p>
      <p class="s2"><b>2.</b> Each app's AI looks the idea up in the lattice instead of inventing it — and both land on the same concept, with a permanent identifier.</p>
      <p class="s3"><b>3.</b> Where an app needed something different, it published a fork, and the fork records exactly what changed: here, one field renamed.</p>
      <p class="s4"><b>4.</b> An integrator's AI reads the lineage and writes the mapping once, in code, at build time. Illustration; field names simplified.</p>
    </div>
  </figure>

  <h2>Why this exists</h2>
  <p>AI assistants are about to generate a great many small, specific apps — a
  club's booking tool, a board's meeting tool, a harbour's berth list. Every one
  defines its data from scratch. The day any two need to share data, somebody
  has to work out, field by field, what the other one meant. That negotiation is
  repeated for every pair of apps, and most of it is rediscovering the same
  distinctions.</p>
  <p>SchemaLattice moves that work to the moment an app is designed: the
  assistant checks whether a concept already exists, reuses it if it does,
  adapts it with a recorded change if it almost does, and only invents one when
  nothing fits — and then publishes it so the next app can reuse it.</p>
  <div class="cols">
    <div><h3>Adopt</h3><p>The concept already exists. Use its identifier; two apps that both adopted it agree by construction.</p></div>
    <div><h3>Fork</h3><p>Nearly right. Publish a variant whose changeset says exactly what differs — renamed, added, nested — so the difference is data, not tribal knowledge.</p></div>
    <div><h3>Originate</h3><p>Genuinely new. Publish it with a definition, an anchor in a small root vocabulary, and a match to an established external one.</p></div>
  </div>

  <h2>How it works</h2>
  <table>
    <tr><td>Identifiers</td><td>Every concept has a URI ending in a hash of its content, e.g.
      <a href="${EXAMPLE_CONCEPT}"><code>${EXAMPLE_CONCEPT}</code></a>. Change a word and it is
      a different concept; nothing is ever edited in place, so a reference means the same thing forever.</td></tr>
    <tr><td>Lineage</td><td>Forks carry a changeset — <code>rename</code>, <code>add</code>,
      <code>remove</code>, <code>retype</code>, <code>nest</code>, <code>hoist</code> — that a tool
      can walk to translate between parent and child (<a href="/specs/changeset-format.md">format</a>).</td></tr>
    <tr><td>Root</td><td>Sixteen abstract concepts (Person, Organization, Event, Record, …) that every
      published concept must trace back to, so the catalog stays one connected graph.</td></tr>
    <tr><td>Search</td><td>Plain-English descriptions matched by a small local embedding model; each
      result comes with a verdict — adopt, fork, distant or no match.</td></tr>
    <tr><td>Quality gates</td><td>Publishing requires a prior search, a real definition, an anchor in the
      root, and a match to an external vocabulary (schema.org, Wikidata, SKOS, PROV…). The same gates apply
      to everyone, the operator included.</td></tr>
    <tr><td>Sensitivity</td><td>Fields can say what they hold — public, internal, personal contact,
      health, a minor's data, a secret — so a portfolio of apps can see where personal data lives
      (<a href="/specs/data-classification.md">classes</a>).</td></tr>
    <tr><td>Standards</td><td>SKOS for concepts, PAV for provenance, JSON-LD on the wire, and the Model
      Context Protocol for AI clients. A composition of existing work, not a new ontology language.</td></tr>
  </table>

  <h2>Two apps that want to integrate</h2>
  <p>This is where the catalog is meant to pay off, and it is worth being exact
  about what exists today.</p>
  <ol class="steps">
    <li>Each app keeps a <code>schemalattice.json</code> manifest mapping its own names to concept URIs.</li>
    <li>Put the two manifests side by side. A <strong>shared URI</strong> is the same meaning, by construction.
      A <strong>fork</strong> relationship comes with its changeset — the mapping is written down already.
      A <strong>common ancestor</strong> means the apps agree at that level. Concepts linked as naming the same
      thing from different perspectives are related but not interchangeable, and concepts with no relation
      are, honestly, not translatable.</li>
    <li>The registry's overlap report scores every pair of registered apps by shared URIs, fork links and
      near-identical meanings (<code>lattice_portfolio_report</code>).</li>
    <li>For any two concepts, <code>lattice_compare</code> lays them side by side: renamed fields, and where
      sensitivity, how evidence was captured, or the states a record moves through differ. It returns a
      table you can put in front of the people negotiating.</li>
    <li>The integrating developer's AI writes the translation as ordinary code in the app, at build time.
      The lattice is never on the request path.</li>
  </ol>
  <p><span class="built">Built:</span> manifests, shared URIs, fork changesets, side-by-side comparison, the overlap report, and the
  instructions an AI follows to compare two manifests.
  <span class="notyet">Not built yet:</span> an automatic reconcile step that proposes the mapping for you, and
  generated translators from changesets — both planned for v0.2. Runtime translation between live apps is
  deliberately out of scope.</p>
  <p class="muted">The benefit is only as good as what both sides publish: two apps that integrate at a
  boundary neither has described look unrelated here, and the report will say so.</p>

  <h2>Check your app against it</h2>
  <p>You don't use this site directly — your AI does. Paste this into your
  coding assistant, in your app's repo:</p>
  <pre><code>${escapeHtml(assistantPrompt(host))}</code></pre>
  <p class="muted">It's read-only and takes a few minutes. You get a table of
  which of your concepts already exist here, which are close, and which are
  genuinely yours. Nothing about your app is uploaded — your AI reads your
  code locally and only sends short plain-English descriptions as search
  queries.</p>

  <h2>How to vet it</h2>
  <ul>
    <li><strong>Read any concept yourself.</strong> Every URI resolves to plain JSON:
      <a href="${EXAMPLE_CONCEPT}">a board's Motion</a>, or the
      <a href="/specs/root-skeleton.md">root vocabulary</a>.</li>
    <li><strong>See what is in it and who put it there.</strong>
      <code>POST /api/tools/lattice_list_context</code> with <code>{}</code> lists every context;
      <code>lattice_portfolio_report</code> lists every registered app and how it scores.</li>
    <li><strong>See what people looked for and didn't find.</strong> <code>lattice_demand_report</code>,
      public, aggregated.</li>
    <li><strong>Read the protocol.</strong> <a href="/specs/ai-checkpoints.md">checkpoints</a>,
      <a href="/specs/uri-scheme.md">URI scheme</a>, <a href="/specs/hashing-rules.md">hashing</a>,
      <a href="/specs/mcp-tools.md">tools</a>.</li>
    <li><strong>Know the limits.</strong> It is young, run as one instance, and small: most domains have
      no concepts yet, and an empty result is the common case.</li>
    <li><strong>Read the code.</strong> The server, the specs and the skills are open source under
      Apache-2.0: <a href="https://github.com/jrlogan/Schema-Lattice">github.com/jrlogan/Schema-Lattice</a>.
      Published concepts carry their own publishers' licenses.</li>
  </ul>

  <h2>What gets recorded, honestly</h2>
  <table>
   <tr><td>Recorded</td><td>The text of search queries, the best match and its
     score, and a random session id. That's it — no account, no name, no code,
     no schemas.</td></tr>
   <tr><td>Shared onward</td><td>Queries that found <em>no</em> match are
     aggregated into a public demand report ("2 sessions asked for a berth
     concept; nothing covers it") so the community can see what vocabulary is
     missing. Your query wording can appear there. If you don't want that, have
     your AI pass <code>"ephemeral": true</code> to discover — the search still
     works and still counts, but the wording is never stored.</td></tr>
   <tr><td>Never recorded</td><td>Your code, your schemas, or anything your AI
     didn't explicitly send. Checking your app publishes nothing.</td></tr>
   <tr><td>Publishing</td><td>Separate, deliberate, key-gated. Anything
     published becomes a permanent, public part of the catalog under the
     license its publisher chose, with attribution — so only do it on purpose.</td></tr>
   <tr><td>Feedback</td><td>Notes sent to <code>lattice_feedback</code> go to
     the maintainers only and are not redistributed.</td></tr>
  </table>

  <p class="muted" style="margin-top:2.5rem">Served from ${h}. If your AI checks
  an app here, the maintainers mostly learn which concepts the world is missing —
  please leave feedback, it's read.</p>
</main>
</body>
</html>
`;
}

/**
 * The same four scenes, laid out twice: side by side for a wide screen, and
 * stacked for a phone, where the wide one would shrink its text to 6px. Only
 * the visible one is in the accessibility tree (display:none removes the
 * other), and each has its own ids.
 */
function illustration(layout: "wide" | "narrow"): string {
  const w = layout === "wide";
  const id = (name: string) => `${name}-${layout}`;
  const A = w ? { x: 16, y: 150, w: 210 } : { x: 8, y: 132, w: 164 };
  const B = w ? { x: 494, y: 150, w: 210 } : { x: 188, y: 132, w: 164 };
  const N = w ? { x: 250, y: 18 } : { x: 70, y: 16 };
  const box = (b: { x: number; y: number; w: number }, label: string, fields: string[]) => `
          <rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="150" rx="10"/>
          <text class="label" x="${b.x + 16}" y="${b.y + 26}">${label}</text>
          <text class="title" x="${b.x + 16}" y="${b.y + 50}">Motion</text>
          ${fields.map((f, i) => `<text x="${b.x + 16}" y="${b.y + 78 + i * 24}">${f}</text>`).join("")}`;
  const row = (b: { y: number }, i: number) => b.y + 74 + i * 24; // mid-height of a field
  const endA = (len: number) => A.x + 16 + len * 7.9 + 6;
  return `<svg class="${layout}" viewBox="0 0 ${w ? "720 330" : "360 384"}" role="img" aria-labelledby="${id("fig-title")} ${id("fig-desc")}">
        <title id="${id("fig-title")}">Two apps reaching one meaning through the lattice</title>
        <desc id="${id("fig-desc")}">App A, a board tool, stores a motion as text, movedBy and yesCount. App B, a council
        tracker, stores it as motionText, mover and counts. Each looks the idea up in the lattice and finds the
        same Motion concept. App B's version is a recorded fork whose changeset renames text to motionText, so
        the fields can be paired, and a mapping between the apps is written once at build time.</desc>
        <g class="keep">${box(A, w ? "App A · board tool" : "App A · board", ["text", "movedBy", "yesCount"])}
          ${box(B, w ? "App B · council tracker" : "App B · council", ["motionText", "mover", "counts"])}
        </g>
        <g class="s1">${w
          ? `<path class="bad" d="M226 225 L494 225"/>
          <text class="warn-text" x="360" y="215" text-anchor="middle">same idea?</text>
          <text class="warn-text" x="360" y="248" text-anchor="middle">different words</text>`
          : `<path class="bad" d="M90 284 C90 318 270 318 270 284"/>
          <text class="warn-text" x="180" y="342" text-anchor="middle">same idea? different words</text>`}
        </g>
        <g class="s2">
          <rect class="node" x="${N.x}" y="${N.y}" width="220" height="76" rx="12"/>
          <text class="label" x="${N.x + 16}" y="${N.y + 24}">lattice concept</text>
          <text class="title" x="${N.x + 16}" y="${N.y + 48}">Motion</text>
          <text x="${N.x + 16}" y="${N.y + 68}" style="font-size:11px">board-governance/motion@bf35…</text>
          ${w
            ? `<path class="link draw" d="M120 150 C120 110 200 70 250 60"/>
          <path class="link draw" d="M600 150 C600 110 520 70 470 60"/>`
            : `<path class="link draw" d="M90 132 C90 112 110 100 130 92"/>
          <path class="link draw" d="M270 132 C270 112 250 100 230 92"/>`}
        </g>
        <g class="s3">
          <text class="fork-label" x="${w ? 548 : 180}" y="${w ? 130 : 312}" text-anchor="${w ? "end" : "middle"}">fork · rename text → motionText</text>
          <path class="pair draw" d="M${endA(4)} ${row(A, 0)} C${A.x + A.w + 20} ${row(A, 0) - 16} ${B.x - 30} ${row(B, 0) - 16} ${B.x + 8} ${row(B, 0)}"/>
          <path class="pair draw" d="M${endA(7)} ${row(A, 1)} C${A.x + A.w + 20} ${row(A, 1) + 16} ${B.x - 30} ${row(B, 1) + 16} ${B.x + 8} ${row(B, 1)}"/>
        </g>
        <g class="s4">${w
          ? `<rect x="250" y="286" width="220" height="30" rx="15" fill="var(--bg)" stroke="var(--ok)" stroke-width="1.5"/>
          <text class="ok-text" x="360" y="306" text-anchor="middle">✓ mapping written once</text>
          <path class="good draw" d="M226 290 L250 301 M470 301 L494 290"/>`
          : `<rect x="70" y="334" width="220" height="30" rx="15" fill="var(--bg)" stroke="var(--ok)" stroke-width="1.5"/>
          <text class="ok-text" x="180" y="354" text-anchor="middle">✓ mapping written once</text>`}
        </g>
      </svg>`;
}

/** The same account for an AI reader, without the markup. */
export function llmsText(host: string, totals: LandingTotals): string {
  const apps = totals.apps !== undefined ? `, ${totals.apps} registered apps` : "";
  return `# SchemaLattice

> A public, forkable catalog of data-model concepts with content-addressed URIs and recorded lineage, built for AI coding assistants so that apps built apart can agree on what their fields mean. v0.1, experimental. ${totals.concepts} concepts in ${totals.contexts} contexts${apps}.

## Use it
- Instructions to follow: https://${host}/skill (building on an existing backend: https://${host}/skill/builder)
- Tools with JSON schemas: https://${host}/api/tools — call with POST /api/tools/{name}, or over MCP at POST /mcp
- Building with a hosted app generator (Lovable, AI Studio, Bolt, v0) that cannot use MCP: paste-ready vocabulary at https://${host}/pack (one domain: /pack/{context}; by description: /pack?q=...)
- Search: GET https://${host}/discover?description=...&ephemeral=true (reads need no key)
- Every context: POST https://${host}/api/tools/lattice_list_context with {}
- Resolve a concept: GET the URI's path on this host, e.g. https://${host}${EXAMPLE_CONCEPT}

## The idea
Before defining a data structure, search the catalog. Adopt an existing concept (>=0.85 similarity), fork it with an explicit changeset (0.65-0.85), and originate a new one only when nothing fits, after refining the search. Publishing is permanent and key-gated; self-registration issues a key immediately (lattice_register_app).

## Integrating two apps
Each app keeps schemalattice.json (local names -> concept URIs). Shared URI = same meaning. Fork = the changeset is the mapping; lattice_compare shows any two concepts side by side (renames, sensitivity, capture provenance, lifecycle states). Common ancestor = agreement at that level. No relation = not translatable. lattice_portfolio_report scores overlap between registered apps. The integrating AI writes the translation as code at build time; the lattice is never on the request path. Not built yet: automatic reconcile and generated translators (v0.2).

## What is recorded
Search query text (unless ephemeral:true), best match and score, a random session id. Never code or schemas. Unmet queries appear aggregated in lattice_demand_report.

## Source
Open source under Apache-2.0: https://github.com/jrlogan/Schema-Lattice (published concepts carry their own publishers' licenses).

## Specs
- https://${host}/specs/ai-checkpoints.md
- https://${host}/specs/changeset-format.md
- https://${host}/specs/uri-scheme.md
- https://${host}/specs/data-classification.md
- https://${host}/specs/mcp-tools.md
`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
