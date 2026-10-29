"""Build (never send) an Open311 GeoReport v2 POST /requests body for one observation.

Service codes and attribute codes come from New Haven's SeeClickFix Open311
endpoint (GET services.json and services/<code>.json, saved in dl/).
Run: python3 -I export_open311.py [observationId]
"""
import json, sys, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
DL = HERE / "dl"

# ConditionType (ours, city-neutral) -> New Haven 311 service_code (from services.json)
CROSSWALK = {
    "sidewalk.trip-hazard": 117,       # Sidewalks and Curb damage (metadata false)
    "sidewalk.missing-segment": 117,
    "curb-ramp.missing": 43965,        # Accessibility for Persons with Disabilities (org listed as "Public Health")
    "curb-ramp.noncompliant": 43965,
    "access.obstruction": 43965,
    "streetlight.out": 124,            # Street Lamp (required attrs: pole number, pole location)
    "streetlight.damaged": 124,
    "tree.dead": 1853,                 # Tree Requests
    "tree.hazard-limb": 1853,
    "tree.missing-empty-pit": 1853,    # no "plant a tree" category; nearest fit
}
SEVERITY = {1: "minor", 2: "moderate", 3: "serious", 4: "blocks passage / unsafe"}


def services():
    return {s["service_code"]: s for s in json.loads((DL / "services.json").read_text())}


def definition(code):
    p = DL / f"svc-{code}.json"
    return json.loads(p.read_text()) if p.exists() else None


def build(obs, session):
    code = CROSSWALK[obs["conditionType"]]
    svc = services()[code]
    lines = [f"[Street Audit] {obs['conditionType']} - severity {obs['severity']} ({SEVERITY[obs['severity']]}).",
             obs["detail"],
             f"Observed {obs['observedAt']} during volunteer audit {session['sessionId']} (protocol {session['protocol']})."]
    if obs.get("wardRef"):
        lines.append(f"{obs['wardRef']}, {obs['neighborhoodRef']}.")
    if obs.get("nearestTreeRef") and obs["conditionType"].startswith("tree."):
        t = obs["nearestTreeRef"]
        lines.append(f"Nearest inventoried tree: {t['commonName']} {t['dbh_in']}in DBH at {t['address']} ({t['distanceM']} m; URI inventory id {t['treeId']}).")
    addr = (obs.get("parcelRef") or {}).get("address") or (obs.get("nearestTreeRef") or {}).get("address")
    form = [
        ("service_code", str(code)),
        ("lat", f"{obs['latitude']:.6f}"),
        ("long", f"{obs['longitude']:.6f}"),
        ("address_string", f"near {addr.strip().title()}, New Haven, CT" if addr else ""),
        ("description", "\n".join(lines)[:4000]),
        ("media_url", f"https://example.org/street-audit/media/{obs['observationId']}-redacted.jpg"),
        # Reporter identity deliberately omitted: no email/first_name/last_name/phone/device_id.
        # api_key and jurisdiction_id are endpoint-specific and not known; left out.
    ]
    missing = []
    d = definition(code) if svc.get("metadata") else None
    for a in (d or {}).get("attributes", []):
        if not a.get("variable"):
            continue  # informational text, not a question
        val = None
        if code == 124 and a["code"] == "4334":
            val = obs.get("poleNumber") or "Pole tag unreadable (volunteer could not read it)."
        elif code == 124 and a["code"] == "39":
            val = f"Pole nearest {addr.strip().title()}" if addr else None
        if val is None and a.get("required"):
            missing.append(a["code"])
        if val is not None:
            form.append((f"attribute[{a['code']}]", val))
    return code, svc, form, missing


def main():
    oid = sys.argv[1] if len(sys.argv) > 1 else "sa-0002"
    data = json.loads((HERE / "out" / "observations-joined.json").read_text())
    obs = next(o for o in data["observations"] if o["observationId"] == oid)
    code, svc, form, missing = build(obs, data["session"])
    body = urllib.parse.urlencode(form)
    out = dict(NOT_SUBMITTED=True, method="POST", path="/requests.json",
               endpoint_note="New Haven Open311 base is seeclickfix.com/open311/v2 (from lattice source new-haven-open311-services); POST also needs api_key, not included",
               content_type="application/x-www-form-urlencoded",
               service=dict(code=code, name=svc["service_name"], organization=svc.get("organization")),
               fields=dict(form), missing_required_attributes=missing, body=body)
    (HERE / "out" / f"open311-create-{oid}.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
