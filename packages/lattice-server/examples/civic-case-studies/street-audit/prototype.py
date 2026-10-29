"""Street Audit prototype: 5 fake observations, joined to real New Haven layers.

Endpoints and field names come from lattice_resolve_source (SchemaLattice).
Read-only GETs, small result limits. Nothing is submitted anywhere.
Run: python3 -I prototype.py
"""
import json, math, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = {"User-Agent": "street-audit-prototype/0.1 (civic test; read-only)"}

LAYERS = {  # from lattice_resolve_source accessUrl / mapped fields
    "ward": ("https://gis.newhavenct.gov/server/rest/services/Hosted/Wards_2022/FeatureServer/0",
             "ward,formal_name,alder_name"),
    "neighborhood": ("https://gis.newhavenct.gov/server/rest/services/Hosted/Neighborhoods_(View)/FeatureServer/0",
                     "neighborhood"),
    "parcel": ("https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_5_view/FeatureServer/0",
               "parcel_id,mblu,property_address"),  # never ownerName / mailing address
}
TREES = "https://services1.arcgis.com/7uJv7I3kgh2y7Pe0/arcgis/rest/services/New_Haven_Street_Trees_02/FeatureServer/0"
TREE_FIELDS = "GlobalID,SiteID,COMM_NAME,Species,DBH,Address,INV_DATE"

# Five fake observations at real places (coordinates picked by hand from a map).
OBS = [
    dict(observationId="sa-0001", observedAt="2026-10-25T14:05:00-04:00", latitude=41.30835, longitude=-72.93085,
         conditionType="sidewalk.trip-hazard", severity=3, detail="Slab heaved ~5 cm by tree roots, full sidewalk width.",
         photo="photos/sa-0001.jpg"),
    dict(observationId="sa-0002", observedAt="2026-10-25T14:22:00-04:00", latitude=41.31790, longitude=-72.94540,
         conditionType="streetlight.out", severity=2, detail="Cobra-head light dark two nights running; pole tag unreadable.",
         photo="photos/sa-0002.jpg"),
    dict(observationId="sa-0003", observedAt="2026-10-25T15:01:00-04:00", latitude=41.32470, longitude=-72.91640,
         conditionType="tree.dead", severity=3, detail="Street tree with no leaves, bark sloughing; leaning toward road.",
         photo="photos/sa-0003.jpg"),
    dict(observationId="sa-0004", observedAt="2026-10-26T10:12:00-04:00", latitude=41.30760, longitude=-72.89770,
         conditionType="curb-ramp.missing", severity=4, detail="No curb ramp on NE corner; wheelchair users must use driveway.",
         photo="photos/sa-0004.jpg"),
    dict(observationId="sa-0005", observedAt="2026-10-26T10:40:00-04:00", latitude=41.31240, longitude=-72.92470,
         conditionType="tree.missing-empty-pit", severity=1, detail="Empty tree pit, stump ground out, filled with litter.",
         photo="photos/sa-0005.jpg"),
]
SESSION = dict(sessionId="sess-2026-10-25-dwntwn", date="2026-10-25", protocol="street-audit/0.1",
               organizer="org:example-block-watch", volunteerCount=4)


def get(url, params):
    full = url + "/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        status = r.status
        body = json.load(r)
    time.sleep(0.5)  # be polite
    if "error" in body:
        raise RuntimeError(f"{url}: {body['error']}")
    return status, body


def point_in(layer, lat, lon):
    url, fields = LAYERS[layer]
    _, body = get(url, dict(geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
                            spatialRel="esriSpatialRelIntersects", outFields=fields,
                            returnGeometry="false", resultRecordCount=2, f="json"))
    feats = [f["attributes"] for f in body.get("features", [])]
    return feats  # 0 = outside, >1 = boundary/overlap; caller decides


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_tree(lat, lon, radius_m=40):
    _, body = get(TREES, dict(geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
                              spatialRel="esriSpatialRelIntersects", distance=radius_m, units="esriSRUnit_Meter",
                              outFields=TREE_FIELDS, returnGeometry="true", outSR=4326,
                              resultRecordCount=25, f="json"))
    best = None
    for f in body.get("features", []):
        g = f.get("geometry") or {}
        if "x" not in g:
            continue
        d = haversine_m(lat, lon, g["y"], g["x"])
        if best is None or d < best[0]:
            best = (d, f["attributes"], g)
    n = len(body.get("features", []))
    if not best:
        return None, n
    d, a, g = best
    return dict(treeId=a.get("GlobalID"), siteId=a.get("SiteID"), commonName=a.get("COMM_NAME"),
                scientificName=a.get("Species"), dbh_in=a.get("DBH"), address=a.get("Address"),
                inventoryDate=(time.strftime("%Y-%m-%d", time.gmtime(a["INV_DATE"] / 1000)) if a.get("INV_DATE") else None),
                distanceM=round(d, 1), lat=round(g["y"], 6), lon=round(g["x"], 6)), n


def main():
    joined = []
    for o in OBS:
        lat, lon = o["latitude"], o["longitude"]
        w = point_in("ward", lat, lon)
        nb = point_in("neighborhood", lat, lon)
        pc = point_in("parcel", lat, lon)
        tree, ntrees = nearest_tree(lat, lon)
        rec = dict(o, auditSession=SESSION["sessionId"],
                   wardRef=(f"Ward {w[0]['ward']}" if w else None), wardAlder=(w[0]["alder_name"] if w else None),
                   neighborhoodRef=(nb[0]["neighborhood"] if nb else None),
                   parcelRef=(dict(pin=pc[0]["parcel_id"], mblu=pc[0]["mblu"], address=pc[0]["property_address"]) if pc else None),
                   parcelNote=(None if pc else "point is in the right-of-way (no parcel polygon contains it)"),
                   nearestTreeRef=tree, treesWithin40m=ntrees,
                   joinMatches=dict(ward=len(w), neighborhood=len(nb), parcel=len(pc)))
        joined.append(rec)
        print(json.dumps({k: rec[k] for k in ("observationId", "conditionType", "wardRef", "neighborhoodRef",
                                               "parcelRef", "parcelNote", "treesWithin40m", "nearestTreeRef", "joinMatches")}))
    (OUT / "observations-joined.json").write_text(json.dumps(dict(session=SESSION, observations=joined), indent=1))


if __name__ == "__main__":
    main()
