// The human front door. Browsers hitting `/` get this page; API clients
// still get the JSON index (content negotiation in server.ts).
//
// Design constraints: self-contained (no external assets), honest about
// what the catalog records, and it must hand a visitor the exact prompt
// to paste into their AI — the site's real user is somebody's coding
// assistant, and the human just needs to make the introduction.

export function landingPage(host: string, totals: { concepts: number; contexts: number }): string {
  const h = escapeHtml(host);
  const prompt = `I want to check my app's data models against SchemaLattice, a shared
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SchemaLattice</title>
<style>
  :root { color-scheme: light dark;
    --fg:#1a1f24; --bg:#fbfaf8; --muted:#5c6670; --line:#e3ded6;
    --card:#f2efe9; --accent:#0b6e6e; }
  @media (prefers-color-scheme: dark) { :root {
    --fg:#e8e6e1; --bg:#15181b; --muted:#9aa4ad; --line:#2c3238;
    --card:#1d2226; --accent:#4cc0b8; } }
  body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:44rem; margin:0 auto; padding:3rem 1.25rem 4rem; }
  h1 { font-size:1.7rem; margin:0 0 .25rem; }
  h2 { font-size:1.15rem; margin:2.2rem 0 .5rem; }
  .tag { color:var(--muted); margin:0 0 1.5rem; }
  p, li { color:var(--fg); }
  .muted { color:var(--muted); }
  pre { background:var(--card); border:1px solid var(--line); border-radius:8px;
    padding:1rem; overflow-x:auto; font-size:.82rem; line-height:1.5;
    white-space:pre-wrap; word-break:break-word; }
  code { background:var(--card); padding:.1em .35em; border-radius:4px; font-size:.9em; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; font-size:.9rem; }
  td { padding:.35rem .6rem .35rem 0; vertical-align:top; border-top:1px solid var(--line); }
  td:first-child { white-space:nowrap; color:var(--muted); }
  a { color:var(--accent); }
  .stat { color:var(--muted); font-size:.9rem; }
</style>
</head>
<body>
<main>
  <h1>SchemaLattice</h1>
  <p class="tag">A shared, forkable catalog of data-model concepts — built for AI
  coding assistants, so independently built apps can end up speaking the same
  vocabulary instead of reinventing it.</p>

  <p class="stat">This instance holds ${totals.concepts} concepts in
  ${totals.contexts} contexts. Reads are public; publishing needs a key.</p>

  <h2>Check your app against it</h2>
  <p>You don't use this site directly — your AI does. Paste this into your
  coding assistant, in your app's repo:</p>
  <pre><code>${escapeHtml(prompt)}</code></pre>
  <p class="muted">It's read-only and takes a few minutes. You get a table of
  which of your concepts already exist here, which are close, and which are
  genuinely yours. Nothing about your app is uploaded — your AI reads your
  code locally and only sends short plain-English descriptions as search
  queries.</p>

  <h2>What gets recorded, honestly</h2>
  <table>
   <tr><td>Recorded</td><td>The text of search queries, the best match and its
     score, and a random session id. That's it — no account, no name, no code,
     no schemas.</td></tr>
   <tr><td>Shared onward</td><td>Queries that found <em>no</em> match are
     aggregated into a public <a href="/api/tools">demand report</a> ("2
     sessions asked for a berth concept; nothing covers it") so the community
     can see what vocabulary is missing. Your query wording can appear there.
     If you don't want that, have your AI pass <code>"ephemeral": true</code>
     to discover — the search still works and still counts, but the wording is
     never stored.</td></tr>
   <tr><td>Never recorded</td><td>Your code, your schemas, or anything your AI
     didn't explicitly send. Checking your app publishes nothing.</td></tr>
   <tr><td>Publishing</td><td>Separate, deliberate, key-gated. Anything
     published becomes a permanent, public, openly-licensed part of the
     catalog with attribution fields — that's the point of publishing, so only
     do it on purpose.</td></tr>
   <tr><td>Feedback</td><td>Notes sent to <code>lattice_feedback</code> go to
     the maintainers only and are not redistributed.</td></tr>
  </table>

  <h2>For the curious</h2>
  <table>
   <tr><td><a href="/skill">/skill</a></td><td>the current instructions your AI follows</td></tr>
   <tr><td><a href="/api/tools">/api/tools</a></td><td>every tool, with schemas — same surface over <a href="/specs/mcp-tools.md">MCP</a></td></tr>
   <tr><td><a href="/health">/health</a></td><td>catalog totals</td></tr>
   <tr><td><a href="/specs/ai-checkpoints.md">/specs</a></td><td>the protocol itself (<a href="/specs/ai-checkpoints.md">checkpoints</a>, <a href="/specs/changeset-format.md">changesets</a>, <a href="/specs/data-classification.md">data classes</a>)</td></tr>
   <tr><td><a href="https://github.com/jrlogan/Schema-Lattice">GitHub</a></td><td>source, specs, and decisions log</td></tr>
  </table>

  <p class="muted" style="margin-top:2.5rem">SchemaLattice is young and
  experimental. If your AI checks an app here, the maintainers mostly learn
  which concepts the world is missing — please leave feedback, it's read.</p>
</main>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
