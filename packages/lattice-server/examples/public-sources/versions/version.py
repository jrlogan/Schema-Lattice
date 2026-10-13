"""Publish new versions of live concepts from a spec, in order, re-pointing references.

usage: LATTICE_API_KEY=… python3 version.py <target> <spec.json> <replaced-in.json|-> <replaced-out.json>
spec: { contexts: [{slug,title,definition}], versions: [{ old, context, slug, label, definition,
        addFields?: [field], broader?: [uri or "@<old uri>"] }] }
Every other part of the record (fields, anchors, attribution, lineage) is kept. References to
any concept in the replaced map (earlier runs plus this one) are re-pointed to the new version.
"""
import json, os, sys, urllib.request

T, SPEC, IN, OUT = sys.argv[1:5]
KEY = os.environ["LATTICE_API_KEY"]
spec = json.load(open(SPEC))
replaced = json.load(open(IN)) if IN != "-" else {}

def call(name, args):
    req = urllib.request.Request(f"{T}/api/tools/{name}", data=json.dumps(args).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + KEY})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

def record(uri):
    return json.load(urllib.request.urlopen(T + uri.replace("https://schemalattice.com", "")))["record"]

def repoint(obj):
    s = json.dumps(obj)
    for o, n in replaced.items():
        s = s.replace(o, n)
    return json.loads(s)

session = "version-" + os.path.basename(SPEC)
call("lattice_discover", {"description": "generalizing concepts that were filed too narrowly", "sessionId": session})
ctx_uri = {}
listing = call("lattice_list_context", {})["contexts"]
for c in listing:
    if c["latest"]: ctx_uri[c["slug"]] = c["uri"]
for ctx in spec.get("contexts", []):
    if ctx["slug"] not in ctx_uri:
        r = call("lattice_publish_context", ctx)
        if "error" in r: sys.exit(f"context {ctx['slug']}: {r['error']}")
        ctx_uri[ctx["slug"]] = r["uri"]

for v in spec["versions"]:
    old_uri = v["old"]
    r = record(old_uri)
    alt = [a.strip() for a in (r.get("altLabel") or {}).get("en", "").split(";") if a.strip()]
    if r["prefLabel"]["en"] != v["label"] and r["prefLabel"]["en"] not in alt:
        alt.insert(0, r["prefLabel"]["en"])
    structure = repoint(r.get("structure") or {"kind": "entity", "fields": []})
    have = {f["name"] for f in structure.get("fields", [])}
    for f in repoint(v.get("addFields", [])):
        if f["name"] not in have: structure.setdefault("fields", []).append(f)
    attribution = {k: r[k] for k in ("importedFrom", "sourceLicense", "sourceNotes", "inspiredBySources") if r.get(k)}
    if r.get("createdBy"): attribution["authoredBy"] = r["createdBy"]
    broader = [replaced.get(b, b) for b in (v.get("broader") or r.get("broader") or [])]
    common = {"contextUri": ctx_uri[v["context"]], "conceptSlug": v["slug"], "prefLabel": v["label"], "altLabels": alt,
              "definition": v["definition"], "structure": structure, "sourceAttribution": attribution,
              "sessionId": session, "previousVersion": old_uri}
    if r.get("forkedFrom"):
        res = call("lattice_publish_fork", {**common, "parentUri": replaced.get(r["forkedFrom"], r["forkedFrom"]),
                                            "changeset": {k: x for k, x in r["changeset"].items() if k != "upgradable"},
                                            "coRefersWith": repoint(r.get("coRefersWith", []))})
    else:
        res = call("lattice_publish_concept", {**common, "conceptKind": r.get("conceptKind"), "broader": broader,
                   **({"closeMatch": r["closeMatch"]} if r.get("closeMatch") else {}),
                   **({"broadMatch": r["broadMatch"]} if r.get("broadMatch") else {}),
                   **({"related": repoint(r["related"])} if r.get("related") else {}),
                   "coRefersWith": repoint(r.get("coRefersWith", [])),
                   **({"coRefersRationale": r["coRefersRationale"]} if r.get("coRefersRationale") else {})})
    if "error" in res:
        sys.exit(f"✗ {v['label']}: {json.dumps(res['error'])[:400]}")
    replaced[old_uri] = res["uri"]
    warn = [w.get("message", w.get("kind")) for w in res.get("warnings", [])]
    print(f"  {r['prefLabel']['en']:26} → {res['uri'].split('/c/')[1]}" + (f"\n      warnings: {' | '.join(warn)}" if warn else ""))
json.dump(replaced, open(OUT, "w"), indent=1)
