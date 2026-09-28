"""Driver for the civic pilot: the checkpoint protocol over live HTTPS,
exactly as an external developer's AI would run it (plus the operator key
so publishes are allowed and rate limits don't apply)."""
import json, os, urllib.request, urllib.error

BASE = os.environ.get("LATTICE_URL", "https://schemalattice.com")
KEY = os.environ["LATTICE_API_KEY"]

def call(tool, args):
    req = urllib.request.Request(
        f"{BASE}/api/tools/{tool}", data=json.dumps(args).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {KEY}"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

def get(path):
    req = urllib.request.Request(BASE + path, headers={"authorization": f"Bearer {KEY}"})
    return json.load(urllib.request.urlopen(req))

def skeleton():
    """slug -> URI for the root skeleton, resolved from the live catalog."""
    person = get("/discover?description=an+individual+human+being&limit=1")
    scheme = None
    for r in person["results"]:
        rec = get("/c/" + r["uri"].split("/c/")[1])
        scheme = rec["record"]["inScheme"]; break
    listing = get("/s/" + scheme.split("/s/")[1] + "/concepts?limit=100")
    out = {}
    for c in listing["concepts"]:
        slug = c["uri"].split("/c/")[1].split("/")[1].split("@")[0]
        out[slug] = c["uri"]
    return out

def survey(app, session, entities):
    """Checkpoint 1A for every entity; returns rows for the decision table."""
    rows = []
    for name, desc in entities:
        d = call("lattice_discover", {"description": desc, "sessionId": session, "limit": 3})
        top = d["results"][0] if d["results"] else None
        sim = top["similarity"] if top else 0.0
        verdict = ("ADOPT" if sim >= 0.85 else "FORK" if sim >= 0.65
                   else "distant" if sim >= 0.55 else "no-match")
        rows.append({"entity": name, "desc": desc, "top": top["prefLabel"] if top else "-",
                     "topUri": top["uri"] if top else None, "sim": sim, "verdict": verdict})
    return rows

def show(app, rows):
    print(f"\n== {app} — checkpoint 1A survey ==")
    for r in rows:
        print(f"  {r['sim']:.3f}  {r['verdict']:<9} {r['entity']:<22} -> {r['top']}")

def tally(rows):
    t = {"ADOPT": 0, "FORK": 0, "distant": 0, "no-match": 0}
    for r in rows: t[r["verdict"]] += 1
    return t
