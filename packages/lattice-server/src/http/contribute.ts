// /contribute: where a builder who cannot publish sends back the types they
// designed (specs/builder-contributions.md). The person pastes their
// schemalattice.json; the page extracts only label, root kind, definition and
// fields IN THE BROWSER, shows exactly that, and sends it on confirmation.

export function contributePage(from: string): string {
  // The pack search that led here, carried as data; escaped for an attribute.
  const fromAttr = from.slice(0, 300).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contribute your types — SchemaLattice</title>
<meta name="description" content="Send the data types your app defines back to the SchemaLattice catalog, so the next builder can share them.">
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
  h1 { font-size:clamp(1.6rem, 5vw, 2.1rem); line-height:1.15; margin:0 0 .75rem; }
  h2 { font-size:1.15rem; margin:2.2rem 0 .5rem; }
  .muted { color:var(--muted); }
  a { color:var(--accent); }
  textarea { width:100%; min-height:14rem; font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:.8rem; }
  input[type=text] { width:100%; font:inherit; background:var(--card); color:var(--fg);
    border:1px solid var(--line); border-radius:6px; padding:.45rem .6rem; }
  button { font:inherit; font-weight:600; background:var(--accent); color:var(--bg); border:0;
    border-radius:6px; padding:.55rem 1.1rem; cursor:pointer; margin-top:.8rem; }
  button.secondary { background:transparent; color:var(--accent); border:1px solid var(--accent); }
  button:disabled { opacity:.5; cursor:default; }
  pre { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:1rem;
    overflow-x:auto; font-size:.8rem; white-space:pre-wrap; word-break:break-word; }
  .note { border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:6px;
    padding:.6rem 1rem; background:var(--card); font-size:.93rem; }
  .bad { color:var(--warn); } .good { color:var(--ok); }
  ul { padding-left:1.2rem; } li { margin:.2rem 0; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <p class="muted"><a href="/">SchemaLattice</a> › contribute</p>
  <h1>Send your new types back to the catalog</h1>
  <p>If your app defines types the catalog doesn't have yet, send them here. When
  several builders describe the same type independently, it becomes a candidate
  for a shared concept, which the next builder can then use.</p>

  <div class="note">
    <p><strong>What is sent:</strong> for each type you made yourself, its name, its root kind
    (<code>broader</code>), its one-sentence definition, and its field names, types and allowed values.</p>
    <p><strong>What is never sent:</strong> your records, project name, file paths, notes, field
    descriptions or field mappings. You see exactly what will be sent before you send it.</p>
  </div>

  <h2>1. Paste your schemalattice.json</h2>
  <p class="muted">Ask your app builder: "Print schemalattice.json, including broader, definition and
  fields for every type you originated."</p>
  <textarea id="manifest" spellcheck="false" placeholder='{ "concepts": { "Appointment": { "status": "originated", "broader": "https://schemalattice.com/c/schemalattice/event@…", "definition": "…", "fields": [ … ] } } }'></textarea>
  <label class="muted" for="from">What were you building? (optional, one line)</label>
  <input type="text" id="from" maxlength="300" value="${fromAttr}">
  <button id="preview">Show what would be sent</button>

  <section id="review" hidden>
    <h2>2. Check it</h2>
    <div id="skipped"></div>
    <pre id="payload"></pre>
    <button id="send">Send these types</button>
  </section>

  <section id="result" hidden>
    <h2>3. Sent</h2>
    <div id="outcome"></div>
  </section>

  <h2>Withdraw a submission</h2>
  <p class="muted">Paste the withdraw token you were given.</p>
  <input type="text" id="token" placeholder="wd_…">
  <button class="secondary" id="withdraw">Withdraw</button>
  <p id="withdrawn"></p>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let payload = null;

  function para(text, cls) {
    const p = document.createElement("p");
    p.textContent = text;
    if (cls) p.className = cls;
    return p;
  }
  function list(items) {
    const ul = document.createElement("ul");
    for (const t of items) { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }
    return ul;
  }

  // Only these keys of each field ever leave the browser.
  function pickField(f) {
    const out = { name: f.name, type: f.type };
    if (f.required === true) out.required = true;
    if (Array.isArray(f.values)) out.values = f.values.filter((v) => typeof v === "string");
    if (typeof f.unit === "string") out.unit = f.unit;
    if (typeof f.itemType === "string") out.itemType = f.itemType;
    return out;
  }

  $("preview").onclick = () => {
    const skipped = $("skipped");
    skipped.replaceChildren();
    let parsed;
    try { parsed = JSON.parse($("manifest").value); }
    catch (e) { skipped.appendChild(para("That is not valid JSON: " + e.message, "bad")); $("review").hidden = false; $("payload").textContent = ""; $("send").disabled = true; return; }
    const concepts = (parsed && typeof parsed.concepts === "object" && parsed.concepts) || {};
    const types = [], notes = [];
    for (const [name, c] of Object.entries(concepts)) {
      if (!c || typeof c !== "object") continue;
      if (c.status !== "originated") { notes.push(name + ": " + (c.status || "no status") + " — already in the catalog, nothing to send"); continue; }
      const missing = ["broader", "definition", "fields"].filter((k) => !c[k]);
      if (missing.length) { notes.push(name + ": skipped, missing " + missing.join(", ")); continue; }
      types.push({ label: name, broader: c.broader, definition: c.definition,
        fields: Array.isArray(c.fields) ? c.fields.filter((f) => f && f.name).map(pickField) : [] });
    }
    if (notes.length) skipped.appendChild(list(notes));
    payload = types.length ? { types, ...($("from").value.trim() ? { sourceQuery: $("from").value.trim() } : {}) } : null;
    $("payload").textContent = payload ? JSON.stringify(payload, null, 2) : "No originated types with broader, definition and fields were found.";
    $("send").disabled = !payload;
    $("review").hidden = false;
    $("result").hidden = true;
  };

  $("send").onclick = async () => {
    if (!payload) return;
    $("send").disabled = true;
    const out = $("outcome");
    out.replaceChildren();
    try {
      const res = await fetch("/api/tools/lattice_contribute", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) { out.appendChild(para(body.error?.message || "Something went wrong.", "bad")); $("send").disabled = false; }
      else {
        if (body.accepted.length) out.appendChild(para("Received " + body.accepted.length + " type(s): " + body.accepted.map((a) => a.label).join(", ") + ". Nothing was published.", "good"));
        if (body.alreadyInCatalog.length) {
          out.appendChild(para("Already in the catalog. Use these concepts instead:"));
          out.appendChild(list(body.alreadyInCatalog.map((a) => a.label + " → " + a.prefLabel + " (" + a.uri + ")")));
        }
        if (body.withdrawToken) {
          out.appendChild(para("Your withdraw token. Keep it if you might want to remove this submission; it is shown only once:"));
          const pre = document.createElement("pre"); pre.textContent = body.withdrawToken; out.appendChild(pre);
        }
      }
    } catch (e) { out.appendChild(para("Could not reach the server: " + e.message, "bad")); $("send").disabled = false; }
    $("result").hidden = false;
  };

  $("withdraw").onclick = async () => {
    const msg = $("withdrawn");
    const res = await fetch("/api/tools/lattice_withdraw_contribution", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: $("token").value }),
    });
    const body = await res.json();
    msg.textContent = res.ok ? "Withdrawn: " + body.removed + " type(s) removed." : (body.error?.message || "Could not withdraw.");
    msg.className = res.ok ? "good" : "bad";
  };
})();
</script>
</body>
</html>
`;
}
