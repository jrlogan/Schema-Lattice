#!/usr/bin/env python3
"""Home Check: a New Haven address -> parcel, value, zoning, overlays, BMR/LCI, sales.

Stdlib only. Run: python3 -I home_check.py "165 Church St" "39 Wooster Pl"
Every value carries the source it came from and how current that source is.
Owner names are never requested.

Endpoints and field names come from schemalattice.com/sources/<slug> pages
(read 2026-10-29); the corrections noted inline were found while testing.
"""
import json
import re
import socket
import sys
import time
import urllib.parse
import urllib.request

# Local sandbox DNS stalls on AAAA lookups; resolve IPv4 only (environment workaround).
_gai = socket.getaddrinfo
socket.getaddrinfo = lambda h, p, f=0, *a, **k: _gai(h, p, socket.AF_INET, *a, **k)

UA = "home-check-prototype/0.1 (civic test; low volume)"
NH = "https://gis.newhavenct.gov/server/rest/services/Hosted"
SRC = {
    "parcels": dict(slug="new-haven-parcels", kind="arcgis",
                    url=NH + "/New_Haven_Parcels_Authoritative_5_view/FeatureServer/0"),
    "cama": dict(slug="ct-cama-2026", kind="socrata", url="https://data.ct.gov/resource/ibe8-9i3q.json"),
    "zoning": dict(slug="new-haven-zoning", kind="arcgis", url=NH + "/Zoning_(View)/FeatureServer/0"),
    "historic": dict(slug="new-haven-local-historic-districts", kind="arcgis",
                     url="https://services6.arcgis.com/AWSPcxcHO7OnZlnu/arcgis/rest/services/"
                         "New_Haven_Local_Historic_Districts/FeatureServer/5"),
    "iz": dict(slug="new-haven-inclusionary-zoning", kind="arcgis",
               url=NH + "/Inclusionary_Zoning_Overlay_District_view/FeatureServer/0"),
    "bmr": dict(slug="new-haven-below-market-rate-housing", kind="arcgis", url=NH + "/BMR_View/FeatureServer/0"),
    "lci": dict(slug="new-haven-lci-managed-lots", kind="arcgis", url=NH + "/LCI_Managed_Lots_(View)/FeatureServer/0"),
    "sales": dict(slug="ct-real-estate-sales", kind="socrata", url="https://data.ct.gov/resource/5mzw-sjtu.json"),
}
NH_TOWN_ID = 93  # ct-cama-2026 page: "Connecticut town number, 1-169; New Haven is 93"

SUFFIX = {"STREET": "ST", "AVENUE": "AV", "AVE": "AV", "PLACE": "PL", "ROAD": "RD", "DRIVE": "DR",
          "COURT": "CT", "LANE": "LN", "TERRACE": "TER", "BOULEVARD": "BLVD", "SQUARE": "SQ"}


def get(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2)


def norm_addr(a):
    """Upper-case, collapse spaces, canonical suffix, '#5'/'# 5'/'UNIT 5' -> '#5'."""
    a = re.sub(r"\s+", " ", (a or "").upper().replace(".", "")).strip()
    a = re.sub(r"\s*(?:#|UNIT|APT)\s*(\w+)$", r" #\1", a)
    w = [SUFFIX.get(x, x) for x in a.split(" ")]
    # State sales file sometimes writes the unit bare: '7 WOOSTER PL 5' == '7 WOOSTER PL #5'.
    if len(w) >= 4 and w[-2] in SUFFIX.values() and re.fullmatch(r"\d+[A-Z]?|[A-Z]", w[-1]):
        w[-1] = "#" + w[-1]
    return " ".join(w)


def ts(ms_or_s, ms=True):
    if not ms_or_s:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(ms_or_s / 1000 if ms else ms_or_s))


_meta = {}


def currency(key):
    """How current is a source, read live from the publisher's metadata."""
    if key in _meta:
        return _meta[key]
    s = SRC[key]
    try:
        if s["kind"] == "arcgis":
            m = get(s["url"], {"f": "json"})
            d = ts((m.get("editingInfo") or {}).get("dataLastEditDate") or (m.get("editingInfo") or {}).get("lastEditDate"))
            out = f"layer last edited {d}" if d else "edit date not published"
        else:
            vid = s["url"].rsplit("/", 1)[1].split(".")[0]
            m = get(f"https://data.ct.gov/api/views/{vid}.json")
            out = f"rows updated {ts(m.get('rowsUpdatedAt'), ms=False)}"
    except Exception as e:  # noqa: BLE001
        out = f"metadata unavailable ({e.__class__.__name__})"
    _meta[key] = out
    return out


def cite(key, extra=""):
    return f"[{SRC[key]['slug']}; {currency(key)}{'; ' + extra if extra else ''}]"


def arc_query(key, **p):
    p.setdefault("f", "json")
    p.setdefault("returnGeometry", "false")
    d = get(SRC[key]["url"] + "/query", p)
    if "error" in d:
        raise RuntimeError(f"{key}: {d['error']}")
    return d.get("features", [])


def point_in(key, lon, lat, fields):
    return [f["attributes"] for f in arc_query(
        key, geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", inSR=4326,
        spatialRel="esriSpatialRelIntersects", outFields=fields)]


def find_parcel(address):
    n = norm_addr(address)
    m = re.match(r"(\d+)\s+(.*)", n)
    if not m:
        raise ValueError("address needs a house number")
    num, street = m.groups()
    street_word = street.split(" ")[0].replace("'", "''")
    feats = arc_query("parcels", where=f"address_number='{num}' AND street_name LIKE '{street_word}%'",
                      outFields="parcel_id,account_number,mblu,property_address,zone,use_code,"
                                "total_assessed_parcel_value_x,sale_date,price,units_residential",
                      returnCentroid="true", outSR=4326, resultRecordCount=25)
    # property_address carries trailing spaces ('165 CHURCH ST '); normalise before comparing.
    exact = [f for f in feats if norm_addr(f["attributes"]["property_address"]) == n]
    if not exact:
        raise LookupError(f"no parcel with address {n!r} (candidates: "
                          f"{[f['attributes']['property_address'].strip() for f in feats][:5]})")
    return exact[0]


def home_check(address):
    out = {"query": address, "normalised": norm_addr(address)}
    pf = find_parcel(address)
    a, c = pf["attributes"], pf["centroid"]
    pid, mblu = a["parcel_id"], a["mblu"]
    out["parcel"] = {"parcel_id": pid, "mblu": mblu, "address": a["property_address"].strip(),
                     "source": cite("parcels", "address match on address_number+street_name")}
    lon, lat = c["x"], c["y"]

    # Assessment: CT CAMA 2026, key join pid = parcel_id (+ town_id 93). The city layer's value
    # is also shown because the two disagree for some parcels.
    rows = get(SRC["cama"]["url"], {"$select": "pid,account_number,assessed_total,appraised_total,"
                                    "pre_yr_assessed_total,valuation_year,zone,zone_description,"
                                    "state_use_description,link",
                                    "$where": f"town_id={NH_TOWN_ID} AND pid='{pid}'", "$limit": 2})
    if rows:
        r = rows[0]
        out["assessment"] = {
            "assessed_total": int(float(r["assessed_total"])),
            "appraised_total": int(float(r["appraised_total"])),
            "revaluation_year (CAMA valuation_year)": r["valuation_year"],
            "grand_list": "2025 (CAMA 2026 collection = Oct 1 2025 grand list)",
            "use": r.get("state_use_description"),
            "account_number_matches": r["account_number"] == a["account_number"],
            "source": cite("cama", "key join town_id=93 + pid=parcel_id"),
        }
    city_val = int(a["total_assessed_parcel_value_x"] or 0)
    out["assessment_city_layer"] = {"assessed_total": city_val, "source": cite("parcels")}
    if rows and city_val != out["assessment"]["assessed_total"]:
        out["assessment_city_layer"]["warning"] = "differs from CT CAMA 2026; city layer looks stale"

    # Zoning: spatial (authoritative polygon) and the parcel's cached zone attribute.
    z = point_in("zoning", lon, lat, "zone_code,districts,district_category")
    out["zoning"] = {"district": [x["zone_code"] for x in z],
                     "category": [f"{x['districts']} / {x['district_category']}" for x in z],
                     "parcel_zone_attribute": a["zone"],
                     "agrees": [x["zone_code"] for x in z] == [a["zone"]],
                     "source": cite("zoning", "parcel centroid in polygon")}

    h = point_in("historic", lon, lat, "HistoricDistrict,YearEstablished,Type")
    out["local_historic_district"] = {
        "in_district": bool(h),
        "name": [f"{x['HistoricDistrict']} (est. {x['YearEstablished']})" for x in h],
        "source": cite("historic", "parcel centroid in polygon")}

    iz = point_in("iz", lon, lat, "market_type")
    out["inclusionary_zoning"] = {"in_overlay": bool(iz), "market_type": [x["market_type"] for x in iz],
                                  "source": cite("iz", "parcel centroid in polygon")}

    b = [f["attributes"] for f in arc_query(
        "bmr", where=f"vision_pid={pid} OR mblu='{mblu}'",
        outFields="vision_pid,mblu,property_n,total_bmr_,occupied_b,ami")]
    out["bmr"] = {"is_bmr_property": bool(b),
                  "records": [{"bmr_units": x["total_bmr_"], "occupied": x["occupied_b"], "ami": x["ami"],
                               "matched_on": [k for k, ok in (("vision_pid", x["vision_pid"] == pid),
                                                              ("mblu", x["mblu"] == mblu)) if ok]}
                              for x in b],
                  "source": cite("bmr", "key join vision_pid=parcel_id OR mblu=mblu")}

    lc = [f["attributes"] for f in arc_query("lci", where=f"mbp='{mblu}'", outFields="mbp,status,full_address,sq_ft")]
    out["lci_lot"] = {"is_lci_lot": bool(lc), "records": [{"status": x["status"], "sq_ft": x["sq_ft"]} for x in lc],
                      "source": cite("lci", "key join mbp=mblu")}

    # Sales: no parcel id in the state file; match town + normalised address.
    n = out["parcel"]["address"]
    num, street_word = n.split(" ")[0], n.split(" ")[1]
    cand = get(SRC["sales"]["url"], {
        "$select": "serialnumber,listyear,daterecorded,address,saleamount,assessedvalue,propertytype,residentialtype,nonusecode",
        "$where": f"town='New Haven' AND upper(address) like '{num} {street_word}%'",
        "$order": "daterecorded DESC", "$limit": 50})
    sales = [s for s in cand if norm_addr(s["address"]) == norm_addr(n)]
    out["sales"] = {"matched": [{"recorded": s["daterecorded"][:10], "list_year": s["listyear"],
                                 "sale_amount": int(float(s["saleamount"])), "property_type": s.get("propertytype"),
                                 "non_use_code": s.get("nonusecode", "")} for s in sales],
                    "unmatched_same_building": sorted({s["address"] for s in cand} - {s["address"] for s in sales})[:6],
                    "coverage": "sales recorded Oct 2001 - Sep 30 2025 (list years 2001-2024)",
                    "source": cite("sales", "attribute join town + normalised address")}
    out["assessor_card"] = f"https://gis.vgsi.com/newhavenct/Parcel.aspx?pid={pid}"
    return out


def show(r):
    print("=" * 78)
    print(f"{r['query']}  ->  {r['parcel']['address']}")
    for k, v in r.items():
        if k in ("query",):
            continue
        print(f"  {k}: {json.dumps(v, ensure_ascii=False)}", flush=True)


if __name__ == "__main__":
    addrs = sys.argv[1:] or ["165 Church St", "39 Wooster Place", "33 Stuyvesant Avenue"]
    for ad in addrs:
        try:
            show(home_check(ad))
        except Exception as e:  # noqa: BLE001
            print("=" * 78, f"\n{ad}: FAILED {e.__class__.__name__}: {e}")
