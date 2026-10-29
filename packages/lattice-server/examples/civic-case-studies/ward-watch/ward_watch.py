#!/usr/bin/env python3
"""Ward Watch: address in New Haven -> ward, alder, recent 311 issues, time-to-close.

Run: python3 -I ward_watch.py "165 Church Street" [--days 90] [--max-pages 8]

Sources (found via schemalattice.com/sources):
  new-haven-address-points  geocode (house_number + street_name -> point)
  new-haven-wards           ward polygon + alder fields (lag the official roster)
  new-haven-seeclickfix-issues  311 issues, lat/lng, created_at/closed_at
Standard library only. Responses are cached under ./cache to keep requests few.
"""
import hashlib, json, os, re, sys, time, statistics, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
UA = "WardWatch-prototype/0.1 (civic test; low volume)"
ADDR = "https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Addresses_Authoritative_view/FeatureServer/0/query"
WARDS = "https://gis.newhavenct.gov/server/rest/services/Hosted/Wards_2022/FeatureServer/0/query"
SCF = "https://seeclickfix.com/api/v2/issues"

# Known disagreement recorded in the catalog (new-haven-wards readiness note, 2026-10-29):
# the official roster listed Ward 24 as VACANT while the GIS layer still names an alder.
ROSTER_OVERRIDES = {24: "Roster (2026-10-29, per SchemaLattice note) lists this seat as VACANT; GIS layer may be stale."}

SUFFIX = {"STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "PLACE": "PL",
          "BOULEVARD": "BLVD", "LANE": "LN", "COURT": "CT", "TERRACE": "TER", "PARKWAY": "PKWY",
          "HIGHWAY": "HWY", "SQUARE": "SQ", "CIRCLE": "CIR"}


def get_json(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(full.encode()).hexdigest()[:16] + ".json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(full, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            break
        except (urllib.error.URLError, ConnectionError) as e:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))  # transient resets seen from seeclickfix.com
    with open(path, "w") as f:
        json.dump(data, f)
    time.sleep(0.5)  # be polite
    return data


def parse_address(text):
    t = re.sub(r",.*$", "", text.strip().upper())          # drop ", New Haven CT ..."
    m = re.match(r"^(\d+[A-Z]?)\s+(.+)$", t)
    if not m:
        raise SystemExit(f"Could not read a house number from {text!r}")
    num, street = m.group(1), m.group(2).split()
    if street and street[-1] in SUFFIX:
        street[-1] = SUFFIX[street[-1]]
    return num, " ".join(street)


def geocode(text):
    num, full_street = parse_address(text)
    q = lambda where: get_json(ADDR, {"where": where, "outFields": "house_number,full_street_name,zip",
                                      "outSR": 4326, "resultRecordCount": 5, "f": "json"})
    esc = full_street.replace("'", "''")
    d = q(f"house_number='{num}' AND full_street_name='{esc}'")
    if not d.get("features"):  # fall back: street name without the suffix
        base = esc.rsplit(" ", 1)[0] if " " in esc else esc
        d = q(f"house_number='{num}' AND street_name='{base}'")
    feats = d.get("features") or []
    if not feats:
        raise SystemExit(f"No authoritative address point for {num} {full_street}")
    f = feats[0]
    return {"label": f"{f['attributes']['house_number']} {f['attributes']['full_street_name']}, New Haven CT {f['attributes']['zip']}",
            "lon": f["geometry"]["x"], "lat": f["geometry"]["y"], "matches": len(feats)}


def ward_for(lon, lat):
    d = get_json(WARDS, {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
                         "spatialRel": "esriSpatialRelIntersects",
                         "outFields": "ward,formal_name,alder_name,party,email,phone,address,city,state,zipcode",
                         "returnGeometry": "true", "outSR": 4326, "geometryPrecision": 6, "f": "json"})
    feats = d.get("features") or []
    if len(feats) != 1:
        raise SystemExit(f"Point fell in {len(feats)} wards (boundary or outside city)")
    return feats[0]["attributes"], feats[0]["geometry"]["rings"]


def in_rings(x, y, rings):  # even-odd ray casting across all rings (handles holes)
    inside = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def ts(s):
    return datetime.fromisoformat(s) if s else None


def issues_in_ward(rings, days, max_pages):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    after = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    base = {"place_url": "new-haven", "min_lat": min(ys), "max_lat": max(ys), "min_lng": min(xs),
            "max_lng": max(xs), "after": after, "per_page": 100, "sort": "created_at",
            # default is open+acknowledged only; closed issues move to Archived after a while
            "status": "open,acknowledged,closed,archived"}
    out, page, total = [], 1, None
    while page and page <= max_pages:
        d = get_json(SCF, dict(base, page=page))
        total = d["metadata"]["pagination"]["entries"]
        out += d["issues"]
        page = d["metadata"]["pagination"]["next_page"]
    complete = len(out) >= total
    inside = [i for i in out if i.get("lat") is not None and in_rings(i["lng"], i["lat"], rings)]
    return inside, len(out), total, complete


def summarise(issues):
    cats = {}
    for i in issues:
        c = cats.setdefault(i["request_type"]["title"].strip().rstrip("."), {"n": 0, "open": 0, "closed": [], "no_close_time": 0})
        c["n"] += 1
        created, closed = ts(i["created_at"]), ts(i["closed_at"])
        if i["status"] in ("Open", "Acknowledged"):
            c["open"] += 1
        elif closed:
            c["closed"].append((closed - created).total_seconds() / 86400)
        else:
            c["no_close_time"] += 1  # Archived without a closed_at
    return cats


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 90
    max_pages = int(argv[argv.index("--max-pages") + 1]) if "--max-pages" in argv else 8
    if "--days" in argv: args.remove(str(days))
    if "--max-pages" in argv: args.remove(str(max_pages))
    text = " ".join(args) or "165 Church Street"

    g = geocode(text)
    w, rings = ward_for(g["lon"], g["lat"])
    ward = w["ward"]
    print(f"Address : {g['label']}  ({g['lat']:.5f}, {g['lon']:.5f})")
    print(f"Ward    : {ward} ({w.get('formal_name') or 'no formal name'})")
    print(f"Alder   : {w['alder_name']} ({w['party']})  email {w['email']}  phone {w['phone'] or 'not listed'}")
    print("          source: City GIS Wards_2022 layer; the city's roster page is the authority but blocks scripts (403).")
    if ward in ROSTER_OVERRIDES:
        print("  WARNING:", ROSTER_OVERRIDES[ward])

    issues, fetched, total, complete = issues_in_ward(rings, days, max_pages)
    print(f"\n311 issues (SeeClickFix), last {days} days: {len(issues)} inside ward {ward} "
          f"(fetched {fetched} of {total} in the ward's bounding box{'' if complete else '; TRUNCATED'})")
    issues.sort(key=lambda i: i["created_at"], reverse=True)
    print("\nMost recent:")
    for i in issues[:8]:
        print(f"  {i['created_at'][:10]}  {i['status']:<12} {i['request_type']['title'][:34]:<34} {(i['address'] or '')[:40]}  {i['html_url']}")

    cats = summarise(issues)
    print(f"\n{'Category':<40}{'n':>5}{'open':>6}{'closed':>8}{'median days':>13}{'p75':>7}")
    for name, c in sorted(cats.items(), key=lambda kv: -kv[1]["n"])[:12]:
        cl = sorted(c["closed"])
        med = f"{statistics.median(cl):.1f}" if cl else "-"
        p75 = f"{statistics.quantiles(cl, n=4, method='inclusive')[2]:.1f}" if len(cl) >= 2 else "-"
        print(f"{name[:39]:<40}{c['n']:>5}{c['open']:>6}{len(cl):>8}{med:>13}{p75:>7}")
    allc = [d for c in cats.values() for d in c["closed"]]
    nct = sum(c["no_close_time"] for c in cats.values())
    if allc:
        print(f"{'ALL':<40}{len(issues):>5}{sum(c['open'] for c in cats.values()):>6}{len(allc):>8}{statistics.median(allc):>13.1f}")
    print(f"\nNotes: time-to-close = closed_at - created_at for closed/archived issues; {nct} archived issue(s) had no closed_at and are excluded.")
    print("       Recent-window bias: issues still open are excluded from medians, so long-running categories look faster than they are.")


if __name__ == "__main__":
    main(sys.argv[1:])
