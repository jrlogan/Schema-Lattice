"""Garden BioBlitz prototype. Python 3 stdlib only. Run: python3 -I bioblitz.py
Reads: dl/parks/orchard.json (NH parks polygon), dl/cipwg/list.html (CT invasive list).
Calls (read-only, small): GBIF species/match + synonyms, iNaturalist /v1/taxa.
Posts nothing anywhere.
"""
import html, json, os, random, re, time, uuid, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "garden-bioblitz-prototype/0.1 (one-off evaluation; low volume)"}
CACHE = os.path.join(HERE, "dl", "api-cache")
os.makedirs(CACHE, exist_ok=True)


def get_json(url):
    key = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9]+", "_", url)[-180:] + ".json")
    if os.path.exists(key):
        return json.load(open(key))
    time.sleep(1.1)  # polite
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as f:
        data = json.load(f)
    json.dump(data, open(key, "w"))
    return data


# ---------- the site: Orchard Street Mini-Park (NH parks id_text 62) ----------
park = json.load(open(os.path.join(HERE, "dl/parks/orchard.json")))["features"][0]
ring = park["geometry"]["rings"][0]


def inside(x, y, poly):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


# ---------- ten fake records (real taxa, fake people) ----------
# observer pseudonyms only; age band drives the sharing rules
OBSERVERS = {"v-oak": "adult", "v-fern": "adult", "s-wren": "13-17", "s-moth": "under-13"}
RAW = [
    ("Reynoutria japonica", "Japanese knotweed", "v-oak", "species"),
    ("Celastrus orbiculatus", "Oriental bittersweet", "v-fern", "species"),
    ("Alliaria petiolata", "garlic mustard", "s-wren", "species"),
    ("Ailanthus altissima", "tree-of-heaven", "v-oak", "species"),
    ("Acer platanoides", "Norway maple", "s-moth", "species"),
    ("Asclepias syriaca", "common milkweed", "s-wren", "species"),
    ("Symphyotrichum novae-angliae", "New England aster", "v-fern", "species"),
    ("Solidago", "goldenrod (unsure which)", "s-moth", "genus"),
    ("Bombus impatiens", "common eastern bumble bee", "s-wren", "species"),
    ("Danaus plexippus", "monarch", "v-oak", "species"),
]
random.seed(62)
xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
records = []
for i, (name, common, obs, rank) in enumerate(RAW):
    while True:
        x = random.uniform(min(xs), max(xs)); y = random.uniform(min(ys), max(ys))
        if inside(x, y, ring):
            break
    records.append({
        "occurrenceId": "urn:uuid:" + str(uuid.UUID(int=random.getrandbits(128))),
        "surveyId": "nh-bioblitz-2026-orchard-st",
        "verbatimIdentification": name, "vernacularName": common, "idRank": rank,
        "eventDate": "2026-09-12T%02d:%02d:00-04:00" % (10 + i // 4, (i * 7) % 60),
        "latitude": round(y, 6), "longitude": round(x, 6), "coordinateUncertaintyMeters": 8,
        "recordedBy": obs, "observerAgeBand": OBSERVERS[obs],
        "photo": "local://photos/%02d.jpg" % i, "photoLicense": "CC-BY-4.0",
        "basisOfRecord": "human-observation", "identificationQuality": "volunteer-unverified",
        "parkId": park["attributes"]["id_text"], "parkName": park["attributes"]["park_name"],
    })
assert all(inside(r["longitude"], r["latitude"], ring) for r in records)

# ---------- CT invasive list (CIPWG page, parsed) ----------
page = open(os.path.join(HERE, "dl/cipwg/list.html"), encoding="utf-8").read()
GENUS_FIRST = {"Aralia", "Elymus", "Wisteria", "Pyrus"}  # entries found (by eye) with common name first
ct = []
for m in re.finditer(r"<div class='uc-accordion'>(.*?)</div></h3><div class=\"textwidget\">(.*?)</div>", page, re.S):
    title = html.unescape(re.sub("<[^>]+>", "", m.group(1))).strip()
    body = html.unescape(re.sub("<[^>]+>", " ", m.group(2)))
    title = re.sub(r"^[A-Z][a-z]+ \d{4}:\s*", "", title)   # e.g. "October 2027: Callery pear – Pyrus calleryana"
    left, _, right = title.partition(" – ")
    p = "(P)" in title
    left, right = [re.sub(r"\(P\)|\*", "", x).strip() for x in (left, right)]
    syns = re.findall(r"(?:syn\.|and|\()\s*([A-Z][a-z]+ [a-z-]+)", title)
    sci, com = left, right
    if right.split() and right.split()[0] in GENUS_FIRST: sci, com = right, left   # first entries put common name first
    stat = re.search(r"Prohibited by statute\?\s*([^\n]*?)\s{2,}|Prohibited by statute\?\s*(.*)", body)
    st = (stat.group(1) or stat.group(2) or "").strip() if stat else ""
    ct.append({"scientificName": sci, "commonName": com.strip(), "potentiallyInvasive": p, "synonymsInText": syns,
               "prohibitedByStatute": st[:60]})
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"\b(var|ssp|subsp)\.", r"\1", s.lower())).strip()
ct_by = {}
ct_syn = {}
for e in ct:
    ct_by.setdefault(" ".join(norm(e["scientificName"]).split()[:2]), e)
    for sy in e["synonymsInText"]:
        ct_syn.setdefault(norm(sy), e)

# ---------- taxonomy lookups: GBIF backbone + iNaturalist ----------
for r in records:
    q = r["verbatimIdentification"]
    g = get_json("https://api.gbif.org/v1/species/match?" + urllib.parse.urlencode({"name": q, "strict": "true"}))
    accepted_key = g.get("acceptedUsageKey") or g.get("usageKey")
    syn = get_json("https://api.gbif.org/v1/species/%s/synonyms?limit=100" % accepted_key) if accepted_key else {"results": []}
    it = get_json("https://api.inaturalist.org/v1/taxa?" + urllib.parse.urlencode({"q": q, "rank": r["idRank"], "per_page": 3}))
    inat = next((t for t in it["results"] if norm(t["name"]) == norm(q) or norm(q) in [norm(n.get("name", "")) for n in t.get("names", [])]), (it["results"] or [None])[0])
    r["gbif"] = {"usageKey": g.get("usageKey"), "acceptedUsageKey": accepted_key, "scientificName": g.get("scientificName"),
                 "canonicalName": g.get("canonicalName"), "status": g.get("status"), "matchType": g.get("matchType"),
                 "rank": g.get("rank"), "kingdom": g.get("kingdom"), "family": g.get("family")}
    r["inat"] = {"id": inat["id"], "name": inat["name"], "rank": inat["rank"], "common": inat.get("preferred_common_name")} if inat else None
    names = {norm(q), norm(g.get("canonicalName") or "")} | {norm(s.get("canonicalName") or "") for s in syn.get("results", [])}
    if inat: names.add(norm(inat["name"]))
    exact = ct_by.get(" ".join(norm(q).split()[:2])) if r["idRank"] == "species" else None
    via_txt = ct_syn.get(norm(q)) if r["idRank"] == "species" else None
    via = next((ct_by[n] for n in names if n and n in ct_by), None) if r["idRank"] == "species" else None
    r["ctExactNameHit"] = bool(exact)
    hit = exact or via_txt or via
    r["ctInvasive"] = None if not hit else {
        "status": "potentially-invasive" if hit["potentiallyInvasive"] else "invasive",
        "listName": hit["scientificName"], "prohibitedByStatute": hit["prohibitedByStatute"],
        "matchedVia": "exact name" if exact else ("syn. in list text" if via_txt else "GBIF synonym"),
        "alsoViaGbifSynonym": bool(via)}

# ---------- outputs ----------
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
json.dump(records, open(os.path.join(HERE, "out/records.json"), "w"), indent=1)
print("Site: %s (NH parks id %s, %s)  CT list entries parsed: %d" % (
    park["attributes"]["park_name"], park["attributes"]["id_text"], park["attributes"]["category"], len(ct)))
print("%-30s %-6s %-9s %-26s %-9s %-26s %s" % ("volunteer ID", "rank", "GBIFkey", "GBIF accepted", "iNat id", "iNat name", "CT invasive?"))
for r in records:
    g, i, c = r["gbif"], r["inat"] or {}, r["ctInvasive"]
    print("%-30s %-6s %-9s %-26s %-9s %-26s %s" % (r["verbatimIdentification"], r["idRank"], g["acceptedUsageKey"],
          (g["canonicalName"] or "")[:26], i.get("id"), (i.get("name") or "")[:26],
          "-" if not c else "%s [%s; list name %s; statute: %s]" % (c["status"], c["matchedVia"], c["listName"], c["prohibitedByStatute"] or "no")))

# join stats for the catalog's claimed joins (counts only)
n = len(records)
same_id = sum(1 for r in records if r["inat"] and r["inat"]["id"] == r["gbif"]["usageKey"])
sp = [r for r in records if r["idRank"] == "species"]
inat_name_in_ct = sum(1 for r in sp if r["inat"] and " ".join(norm(r["inat"]["name"]).split()[:2]) in ct_by)
inat_name_or_syn_in_ct = sum(1 for r in sp if r["ctInvasive"])
stats = {"tried": n, "inat_taxon_id_equals_gbif_taxonKey": same_id,
         "species_records": len(sp), "inat_name_exact_in_ct_list": inat_name_in_ct,
         "ct_hit_with_gbif_synonyms": inat_name_or_syn_in_ct}
json.dump(stats, open(os.path.join(HERE, "out/join_stats.json"), "w"), indent=1)
print("join stats:", stats)
