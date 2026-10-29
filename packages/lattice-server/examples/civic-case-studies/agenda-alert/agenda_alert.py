#!/usr/bin/env python3
"""Agenda Alert prototype: New Haven Board of Alders meetings and legislation
that concern one ward or one neighborhood.

Sources (endpoints and field names from schemalattice.com/sources/...):
  new-haven-legistar-events, new-haven-legistar-matters  (Legistar OData)
  new-haven-wards, new-haven-neighborhoods, new-haven-address-points,
  new-haven-comprehensive-parks                         (city ArcGIS)
Not in the catalog, worked out by hand: /events/{id}/eventitems (agenda items),
Gateway.aspx?M=L&ID=<MatterId> (web link to a matter).

Run: python3 -I agenda_alert.py [--since 2026-07-01] [--events-since 2026-10-01]
Stdlib only. Responses are cached in ./cache so reruns make no requests.
"""
import json, os, re, sys, time, hashlib, urllib.parse, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "out")
LEG = "https://webapi.legistar.com/v1/newhaven-ct"
LEG_WEB = "https://newhaven-ct.legistar.com"
GIS = "https://gis.newhavenct.gov/server/rest/services/Hosted"
WARDS = GIS + "/Wards_2022/FeatureServer/0/query"
NBHD = GIS + "/Neighborhoods_(View)/FeatureServer/0/query"
ADDR = GIS + "/New_Haven_Addresses_Authoritative_view/FeatureServer/0/query"
PARKS = GIS + "/Comprehensive_Parks_Public_View/FeatureServer/0/query"
UA = "agenda-alert-prototype/0.1 (civic test; low volume)"

AREAS = [
    {"key": "ward-7", "kind": "ward", "ward": 7, "label": "Ward 7"},
    {"key": "fair-haven", "kind": "neighborhood", "code": "FAIR-HAVEN", "label": "Fair Haven"},
]

REQUESTS = {"network": 0, "cached": 0}


def get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        REQUESTS["cached"] += 1
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    REQUESTS["network"] += 1
    with open(path, "w") as f:
        json.dump(data, f)
    time.sleep(0.4)  # be polite
    return data


# ---------------------------------------------------------------- geometry
def ring_contains(ring, x, y):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def poly_contains(rings, x, y):
    # Esri rings: even-odd across all rings handles holes well enough here.
    return sum(ring_contains(r, x, y) for r in rings) % 2 == 1


def bbox(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def centroid(rings):
    r = max(rings, key=len)
    return sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)


# ---------------------------------------------------------------- text
SUFFIX = {"STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "PLACE": "PL", "DRIVE": "DR",
          "LANE": "LN", "COURT": "CT", "TERRACE": "TER", "BOULEVARD": "BLVD",
          "PARKWAY": "PKWY", "SQUARE": "SQ", "HIGHWAY": "HWY", "CIRCLE": "CIR",
          "AVE.": "AVE", "ST.": "ST", "RD.": "RD"}
DIRS = {"EAST": "E", "WEST": "W", "NORTH": "N", "SOUTH": "S"}


def norm(text):
    t = (text or "").upper().replace("’", "'")
    t = t.replace(",", " , ")
    t = re.sub(r"[^A-Z0-9'&#\-/, ]+", " ", t)
    words = [SUFFIX.get(w, w) for w in t.split()]
    sfx = set(SUFFIX.values())
    for i in range(1, len(words)):
        if words[i] in DIRS and words[i - 1] in sfx:
            words[i] = DIRS[words[i]]
    return " " + " ".join(words) + " "


def street_variants(full):
    """'E GRAND AVE' -> {'E GRAND AVE', 'EAST GRAND AVE'}"""
    v = {full}
    parts = full.split()
    if parts and parts[0] in DIRS.values():
        inv = {b: a for a, b in DIRS.items()}
        v.add(" ".join([inv[parts[0]]] + parts[1:]))
    return v


# ---------------------------------------------------------------- geography
def load_geography():
    wards = get_json(WARDS, {"where": "1=1", "outFields": "ward,alder_name", "outSR": 4326,
                             "maxAllowableOffset": 0.00005, "f": "json"})["features"]
    nbhds = get_json(NBHD, {"where": "1=1", "outFields": "neighborhood,neighborhood_label",
                            "outSR": 4326, "maxAllowableOffset": 0.00005, "f": "json"})["features"]
    parks = get_json(PARKS, {"where": "1=1", "outFields": "park_name,category", "outSR": 4326,
                             "maxAllowableOffset": 0.0002, "f": "json"})["features"]
    return wards, nbhds, parks


def locate(x, y, wards, nbhds):
    w = next((f["attributes"]["ward"] for f in wards if poly_contains(f["geometry"]["rings"], x, y)), None)
    n = next((f["attributes"]["neighborhood"] for f in nbhds
              if poly_contains(f["geometry"]["rings"], x, y)), None)
    return w, n


def area_polygon(area, wards, nbhds):
    if area["kind"] == "ward":
        return next(f for f in wards if f["attributes"]["ward"] == area["ward"])["geometry"]["rings"]
    return next(f for f in nbhds if f["attributes"]["neighborhood"] == area["code"])["geometry"]["rings"]


def address_points_in(rings):
    """All address points inside the area's bounding box (paged), then filtered locally."""
    x0, y0, x1, y1 = bbox(rings)
    pts, offset = [], 0
    while True:
        d = get_json(ADDR, {"where": "1=1", "geometry": f"{x0},{y0},{x1},{y1}",
                            "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                            "spatialRel": "esriSpatialRelIntersects",
                            "outFields": "house_number,full_street_name", "outSR": 4326,
                            "resultOffset": offset, "resultRecordCount": 2000,
                            "orderByFields": "objectid", "f": "json"})
        feats = d.get("features", [])
        pts += feats
        if not d.get("exceededTransferLimit") or not feats:
            break
        offset += len(feats)
    return [p for p in pts if poly_contains(rings, p["geometry"]["x"], p["geometry"]["y"])], pts


def street_totals():
    d = get_json(ADDR, {"where": "1=1", "groupByFieldsForStatistics": "full_street_name",
                        "outStatistics": json.dumps([{"statisticType": "count",
                                                      "onStatisticField": "objectid",
                                                      "outStatisticFieldName": "n"}]),
                        "f": "json"})
    out = {}
    for f in d["features"]:
        nm = (f["attributes"]["full_street_name"] or "").upper().strip()
        if nm:
            out[nm] = out.get(nm, 0) + f["attributes"]["n"]
    return out


def geocode(house, street, wards, nbhds):
    d = get_json(ADDR, {"where": f"house_number='{house}' AND UPPER(full_street_name) IN ('{street}','{street} ')",
                        "outFields": "house_number,full_street_name", "outSR": 4326,
                        "resultRecordCount": 1, "f": "json"})
    if not d.get("features"):
        return None
    g = d["features"][0]["geometry"]
    w, n = locate(g["x"], g["y"], wards, nbhds)
    return {"x": round(g["x"], 6), "y": round(g["y"], 6), "ward": w, "neighborhood": n}


# ---------------------------------------------------------------- legistar
def legistar(path, **odata):
    params = {"$" + k: v for k, v in odata.items()}
    return get_json(LEG + path, params)


def fetch_matters(since):
    rows, skip = [], 0
    while True:
        page = legistar("/matters", filter=f"MatterIntroDate ge datetime'{since}'",
                        orderby="MatterIntroDate desc", top=200, skip=skip)
        rows += page
        if len(page) < 200:
            return rows
        skip += 200


def fetch_events(since):
    ev = legistar("/events", filter=f"EventDate ge datetime'{since}'", orderby="EventDate", top=60)
    for e in ev:
        e["_items"] = get_json(f"{LEG}/events/{e['EventId']}/eventitems")
    return ev


# City Hall / meeting venue: named in every notice, never what an item is about.
VENUE = {("165", "CHURCH ST"), ("200", "ORANGE ST")}
# "Jane Doe, 196 Crown Street, testified" -> a speaker's home, not the item's place.
SPEAKER = re.compile(r"[A-Z][A-Z'\-]+ [A-Z][A-Z'\-]+ , $")
SPEAKER_AFTER = re.compile(r"^ ?, (?:A |AN |THE |WHO |TESTIF|SPOKE|ASKED|SAID|STATED|URGED)")

PERSONAL = re.compile(r"TAXES OF |ASSISTANCE FOR |TAX ACCOUNTS? |MOTOR VEHICLE", re.I)


# ---------------------------------------------------------------- matching
class Matcher:
    def __init__(self, wards, nbhds, parks, totals):
        self.wards, self.nbhds = wards, nbhds
        self.totals = totals
        # longest first so 'FAIR HAVEN HEIGHTS' wins over 'FAIR HAVEN'
        self.streets = sorted({v: s for s in totals for v in street_variants(s)}.items(),
                              key=lambda kv: -len(kv[0]))
        names = {}
        for f in nbhds:
            code, label = f["attributes"]["neighborhood"], (f["attributes"]["neighborhood_label"] or "").strip()
            if not label:
                continue  # RIVERA / RIVERB are not neighborhoods
            for n in {label.upper(), code.replace("-", " ").replace("_", " ")}:
                names[n] = code
        names.pop("HILL", None)
        names["THE HILL"] = "HILL"
        names["HILL NEIGHBORHOOD"] = "HILL"
        self.nbhd_names = sorted(names.items(), key=lambda kv: -len(kv[0]))
        self.parks = []
        for p in parks:
            nm = (p["attributes"]["park_name"] or "").upper().strip()
            if len(nm.split()) < 2 or not p.get("geometry"):
                continue
            x, y = centroid(p["geometry"]["rings"])
            w, n = locate(x, y, wards, nbhds)
            self.parks.append((norm(nm).strip(), nm, w, n))
        self.geocache = {}

    def extract(self, text):
        t = norm(text)
        found = {"addresses": [], "streets": [], "neighborhoods": [], "wards": [],
                 "sponsor_wards": [], "parks": [], "speaker_addresses": 0, "venue": 0, "skipped_lookalike": 0}
        masked = t
        for name, code in self.nbhd_names:
            if f" {name} " in masked:
                found["neighborhoods"].append(code)
                masked = masked.replace(f" {name} ", " # ")
        for m in re.finditer(r"(SUBMITTED BY|ALDER)[^.;]{0,60}? WARD (\d{1,2}) ", t):
            found["sponsor_wards"].append(int(m.group(2)))
        for m in re.finditer(r" WARDS? ((?:\d{1,2}(?: AND | & | |/)?)+)", t):
            for n in re.findall(r"\d{1,2}", m.group(1)):
                if 1 <= int(n) <= 30 and int(n) not in found["sponsor_wards"]:
                    found["wards"].append(int(n))
        for _, nm, w, n in self.parks:
            if f" {norm(nm).strip()} " in t:
                found["parks"].append({"name": nm, "ward": w, "neighborhood": n})
        smask = t
        for variant, street in self.streets:
            key = f" {variant} "
            while key in smask:
                i = smask.index(key)
                prev = smask[:i + 1].split()[-1:] or [""]
                nxt = smask[i + len(key):].split()[:1] or [""]
                if prev[0] in ("NEW", "EAST", "WEST", "NORTH", "SOUTH", "E", "W", "N", "S", "OLD") \
                        or nxt[0] in ("N", "S", "E", "W", "EXT", "EXTENSION"):
                    smask = smask[:i] + " ~ " + smask[i + len(key):]
                    found["skipped_lookalike"] += 1
                    continue
                before = smask[max(0, i - 40):i + 1]
                nums = re.search(r"((?:\d{1,5}[A-Z]?(?:-\d{1,5})?(?: AND | & | |, |,)?)+) $", before)
                if nums:
                    lead = smask[max(0, i - 40 - len(nums.group(0))):i + 1 - len(nums.group(0))]
                    after = smask[i + len(key) - 1:i + len(key) + 40]
                    speaker = bool(SPEAKER.search(lead) and SPEAKER_AFTER.search(after))
                    if speaker:
                        found["speaker_addresses"] += 1
                    for h in re.findall(r"\d{1,5}", nums.group(1)):
                        if (h, street) in VENUE:
                            found["venue"] += 1
                        elif not speaker:
                            found["addresses"].append((h, street))
                else:
                    found["streets"].append(street)
                smask = smask[:i] + " ~ " + smask[i + len(key):]
        return found

    def geocode(self, h, s):
        if (h, s) not in self.geocache:
            self.geocache[(h, s)] = geocode(h, s, self.wards, self.nbhds)
        return self.geocache[(h, s)]

    def intersections(self, streets, area):
        """Approximate street intersections from address points near the area:
        closest pair of points on two named streets, if within ~70 m."""
        pts = area["_points_by_street"]
        out = []
        for i, a in enumerate(streets):
            for b in streets[i + 1:]:
                pa, pb = pts.get(a, []), pts.get(b, [])
                if not pa or not pb:
                    continue
                best_d, mid = 1e9, None
                for x1, y1 in pa:
                    for x2, y2 in pb:
                        d = ((x1 - x2) * 83000) ** 2 + ((y1 - y2) * 111000) ** 2
                        if d < best_d:
                            best_d, mid = d, ((x1 + x2) / 2, (y1 + y2) / 2)
                if best_d < 70 ** 2:
                    out.append((a, b, poly_contains(area["_rings"], *mid)))
        return out

    def score(self, found, area, area_street_counts):
        """Return list of (strength, reason) for one area."""
        hits = []
        in_area = (lambda w, n: w == area["ward"]) if area["kind"] == "ward" else \
                  (lambda w, n: n == area["code"])
        for h, s in found["addresses"]:
            g = self.geocode(h, s)
            if g and in_area(g["ward"], g["neighborhood"]):
                hits.append(("strong", f"address {h} {s} is in {area['label']}"))
            elif g is None and area_street_counts.get(s):
                hits.append(("weak", f"address {h} {s} not found in address points; street runs through {area['label']}"))
        if area["kind"] == "neighborhood" and area["code"] in found["neighborhoods"]:
            hits.append(("strong", f"names the neighborhood {area['label']}"))
        if area["kind"] == "ward" and area["ward"] in found["wards"]:
            hits.append(("strong", f"names Ward {area['ward']}"))
        if area["kind"] == "ward" and area["ward"] in found["sponsor_wards"]:
            hits.append(("medium", f"submitted by the Ward {area['ward']} alder (sponsor, not necessarily place)"))
        for p in found["parks"]:
            if in_area(p["ward"], p["neighborhood"]):
                hits.append(("medium", f"names {p['name'].title()}, which lies in {area['label']}"))
        named = list(dict.fromkeys(found["streets"]))
        present = [s for s in named if area_street_counts.get(s)]
        # "X St between A St and B St": a segment. If several streets are named
        # but only one of them reaches this area, the segment is elsewhere.
        if len(named) >= 2 and len(present) < 2:
            present = []
        if len(present) >= 2:
            xs = self.intersections(present[:8], area)
            inside = [(a, b) for a, b, ok in xs if ok]
            if inside:
                hits.append(("strong", "intersection " + "; ".join(f"{a} & {b}" for a, b in inside[:3])
                             + f" lies in {area['label']}"))
                present = []
            elif xs:
                present = []  # the named corners/segment are just outside the area
        for s in present:
            n_in, n_all = area_street_counts.get(s, 0), self.totals.get(s, 0)
            if n_in:
                share = n_in / n_all if n_all else 0
                strength = "medium" if share >= 0.5 else "weak"
                hits.append((strength, f"names {s} ({n_in} of its {n_all} addresses are in {area['label']})"))
        return hits


RANK = {"strong": 3, "medium": 2, "weak": 1}


def best(hits):
    return max((RANK[h[0]] for h in hits), default=0)


def matter_link(mid):
    return f"{LEG_WEB}/Gateway.aspx?M=L&ID={mid}"


def main(argv):
    since = "2026-07-01"
    ev_since = "2026-10-01"
    if "--since" in argv:
        since = argv[argv.index("--since") + 1]
    if "--events-since" in argv:
        ev_since = argv[argv.index("--events-since") + 1]
    today = datetime.date.today().isoformat()

    wards, nbhds, parks = load_geography()
    totals = street_totals()
    m = Matcher(wards, nbhds, parks, totals)

    area_counts = {}
    for a in AREAS:
        pts, a["_bbox_points"] = address_points_in(area_polygon(a, wards, nbhds))
        c, by = {}, {}
        rings = area_polygon(a, wards, nbhds)
        x0, y0, x1, y1 = bbox(rings)
        for p in pts:
            s = (p["attributes"]["full_street_name"] or "").upper().strip()
            c[s] = c.get(s, 0) + 1
        for p in a.pop("_bbox_points"):
            s = (p["attributes"]["full_street_name"] or "").upper().strip()
            by.setdefault(s, []).append((p["geometry"]["x"], p["geometry"]["y"]))
        a["_points_by_street"], a["_rings"] = by, rings
        area_counts[a["key"]] = c
        a["n_addresses"], a["n_streets"] = len(pts), len(c)
        if a["kind"] == "ward":
            a["alder_gis"] = next(f["attributes"]["alder_name"] for f in wards
                                  if f["attributes"]["ward"] == a["ward"])

    matters = fetch_matters(since)
    events = fetch_events(ev_since)

    # Matters reachable through event items, so recent agenda items get scored too.
    by_id = {x["MatterId"]: x for x in matters}
    results = {a["key"]: {"matters": [], "events": []} for a in AREAS}
    stats = {"matters_total": len(matters), "matters_personal_tax_orders": 0,
             "matters_with_any_place_signal": 0, "events_total": len(events),
             "events_upcoming": sum(1 for e in events if e["EventDate"][:10] >= today),
             "event_items_total": sum(len(e["_items"]) for e in events),
             "event_items_with_matter": sum(1 for e in events for i in e["_items"] if i["EventItemMatterId"]),
             "event_items_unlinked_over_5k_chars": sum(1 for e in events for i in e["_items"]
                 if not i["EventItemMatterId"] and len(i["EventItemTitle"] or "") > 5000),
             "addresses_extracted": 0, "addresses_geocoded": 0, "speaker_addresses_suppressed": 0,
             "venue_addresses_suppressed": 0}

    for x in matters:
        title = x["MatterTitle"] or ""
        if PERSONAL.search(title) and not re.search(r"PROPERTY LOCATED|\d+ [A-Z]+ (ST|AVE)", norm(title)):
            stats["matters_personal_tax_orders"] += 1
        f = m.extract(title)
        x["_found"] = f
        if any(v for k, v in f.items() if k not in ("speaker_addresses", "venue", "skipped_lookalike")):
            stats["matters_with_any_place_signal"] += 1
        stats["addresses_extracted"] += len(f["addresses"])
        stats["speaker_addresses_suppressed"] += f["speaker_addresses"]
        stats["venue_addresses_suppressed"] += f["venue"]
        for a in AREAS:
            hits = m.score(f, a, area_counts[a["key"]])
            if hits:
                results[a["key"]]["matters"].append({
                    "file": x["MatterFile"], "id": x["MatterId"], "type": x["MatterTypeName"],
                    "status": x["MatterStatusName"], "intro": (x["MatterIntroDate"] or "")[:10],
                    "title": title, "link": matter_link(x["MatterId"]),
                    "hits": hits, "best": best(hits)})
    stats["addresses_geocoded"] = sum(1 for v in m.geocache.values() if v)
    stats["addresses_unique"] = len(m.geocache)
    stats["geocodes"] = {f"{h} {st}": g for (h, st), g in m.geocache.items()}

    for e in events:
        for a in AREAS:
            item_hits = []
            for it in e["_items"]:
                if not it["EventItemMatterId"]:
                    continue  # notices, boilerplate, minutes pasted into the title
                f = m.extract(it["EventItemTitle"] or "")
                hits = m.score(f, a, area_counts[a["key"]])
                if hits:
                    item_hits.append({"file": it["EventItemMatterFile"], "matter_id": it["EventItemMatterId"],
                                      "title": (it["EventItemTitle"] or "")[:300], "hits": hits,
                                      "best": best(hits),
                                      "link": matter_link(it["EventItemMatterId"]) if it["EventItemMatterId"] else None})
            if item_hits:
                results[a["key"]]["events"].append({
                    "id": e["EventId"], "date": e["EventDate"][:10], "time": e["EventTime"],
                    "body": e["EventBodyName"], "location": e["EventLocation"],
                    "agenda": e["EventAgendaFile"], "link": e["EventInSiteURL"],
                    "upcoming": e["EventDate"][:10] >= today, "items": item_hits})

    os.makedirs(OUT, exist_ok=True)
    for a in AREAS:
        r = results[a["key"]]
        r["matters"].sort(key=lambda z: (-z["best"], z["intro"]), reverse=False)
        a["counts"] = {lvl: sum(1 for z in r["matters"] if z["best"] == RANK[lvl]) for lvl in RANK}
        a["event_counts"] = {"meetings": len(r["events"]),
                             "upcoming": sum(1 for e in r["events"] if e["upcoming"]),
                             "items": sum(len(e["items"]) for e in r["events"])}
        with open(os.path.join(OUT, f"digest-{a['key']}.md"), "w") as fh:
            fh.write(render(a, r, since, ev_since, today))
    with open(os.path.join(OUT, "results.json"), "w") as fh:
        for a in AREAS:
            a.pop("_points_by_street", None); a.pop("_rings", None)
        json.dump({"areas": AREAS, "stats": stats, "requests": REQUESTS, "results": results},
                  fh, indent=1, default=str)
    print(json.dumps({"stats": stats, "requests": REQUESTS,
                      "areas": [{k: a.get(k) for k in ("label", "n_addresses", "n_streets", "alder_gis",
                                                        "counts", "event_counts")} for a in AREAS]}, indent=1))


def render(a, r, since, ev_since, today):
    L = [f"# Agenda Alert: {a['label']}", "",
         f"_Generated {today}. Legislation introduced since {since}; meetings since {ev_since}._", ""]
    if a.get("alder_gis"):
        L += [f"Alder (city GIS ward layer, may lag the official roster): {a['alder_gis']}", ""]
    up = [e for e in r["events"] if e["upcoming"]]
    L += ["## Upcoming meetings with items about this area", ""]
    if not up:
        L += ["None on the published calendar.", ""]
    for e in up + [None] + [e for e in r["events"] if not e["upcoming"]]:
        if e is None:
            L += ["## Recent meetings with items about this area", ""]
            continue
        L += [f"### {e['date']} {e['time']}: {e['body']} ({e['location']})",
              f"[Meeting page]({e['link']}) · [Agenda PDF]({e['agenda']})", ""]
        for it in sorted(e["items"], key=lambda z: -z["best"]):
            lvl = [k for k, v in RANK.items() if v == it["best"]][0]
            ref = f"[{it['file']}]({it['link']})" if it["link"] else "(no matter)"
            L += [f"- **{lvl}** {ref}: {it['title'][:220]}",
                  "  - " + "; ".join(h[1] for h in it["hits"])]
        L.append("")
    L += ["## Legislation", ""]
    for lvl in ("strong", "medium", "weak"):
        rows = [z for z in r["matters"] if z["best"] == RANK[lvl]]
        L += [f"### {lvl.title()} match ({len(rows)})", ""]
        for z in sorted(rows, key=lambda z: z["intro"], reverse=True):
            L += [f"- [{z['file']}]({z['link']}) {z['type']}, {z['status']}, introduced {z['intro']}: {z['title'][:220]}",
                  "  - " + "; ".join(h[1] for h in z["hits"])]
        L.append("")
    return "\n".join(L)


if __name__ == "__main__":
    main(sys.argv[1:])
