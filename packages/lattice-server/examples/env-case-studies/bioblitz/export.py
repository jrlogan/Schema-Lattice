"""Draft (never send) what Garden BioBlitz would share onward. Reads out/records.json.
Writes out/dwc_occurrence.tsv (GBIF/IPT-style rows, all records) and out/inat_draft.json (one record).
Privacy rules applied: coordinates rounded to 0.001 deg (~100 m; the park is ~50 m across so this
keeps the park, not the spot); minors (age band != adult) get no recordedBy and a date-only eventDate;
records without consent are not exported at all.
"""
import csv, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
recs = json.load(open(os.path.join(HERE, "out/records.json")))
# Fake consent ledger, shaped like governance/forwarding-consent (consent of guardian for minors).
CONSENT = {  # observer pseudonym -> (recipient set, identityShared, grantedBy)
    "v-oak": ({"gbif", "inaturalist"}, True, "self"),
    "v-fern": ({"gbif"}, False, "self"),
    "s-wren": ({"gbif"}, False, "guardian"),
    "s-moth": (set(), False, None),       # no guardian form returned -> stays local
}
LIC = {"CC0": "http://creativecommons.org/publicdomain/zero/1.0/legalcode",
       "CC-BY-4.0": "http://creativecommons.org/licenses/by/4.0/legalcode"}

def dwc(r):
    minor = r["observerAgeBand"] != "adult"
    to, ident, _ = CONSENT[r["recordedBy"]]
    return {
        "occurrenceID": r["occurrenceId"],
        "basisOfRecord": "HumanObservation",
        "eventID": r["surveyId"],
        "eventDate": r["eventDate"][:10] if minor else r["eventDate"],
        "scientificName": r["gbif"]["scientificName"],
        "taxonID": "https://www.gbif.org/species/%s" % r["gbif"]["acceptedUsageKey"],
        "taxonRank": r["idRank"],
        "verbatimIdentification": r["verbatimIdentification"],
        "vernacularName": r["vernacularName"],
        "kingdom": r["gbif"]["kingdom"], "family": r["gbif"]["family"] or "",
        "decimalLatitude": round(r["latitude"], 3), "decimalLongitude": round(r["longitude"], 3),
        "geodeticDatum": "EPSG:4326",
        "coordinateUncertaintyInMeters": 150,
        "dataGeneralizations": "Coordinates rounded to 0.001 degrees to protect volunteers",
        "informationWithheld": "observer identity and exact time withheld (minor)" if minor else ("observer identity withheld" if not ident else ""),
        "locality": "%s, New Haven, Connecticut" % r["parkName"],
        "country": "United States", "countryCode": "US", "stateProvince": "Connecticut",
        "recordedBy": r["recordedBy"] if (ident and not minor) else "",
        "identifiedBy": "",
        "identificationVerificationStatus": "unverified",
        "occurrenceStatus": "present",
        "license": LIC[r["photoLicense"]],
        "rightsHolder": "Garden BioBlitz volunteers",
        "establishmentMeans": "introduced" if r["ctInvasive"] else "",
        "occurrenceRemarks": ("CT invasive list: %s" % r["ctInvasive"]["status"]) if r["ctInvasive"] else "",
    }

rows = [dwc(r) for r in recs if "gbif" in CONSENT[r["recordedBy"]][0]]
with open(os.path.join(HERE, "out/dwc_occurrence.tsv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter="\t"); w.writeheader(); w.writerows(rows)
print("DwC rows exported: %d of %d (withheld for no consent: %d)" % (len(rows), len(recs), len(recs) - len(rows)))

# iNaturalist: draft body for POST /v1/observations (NOT sent). Only the adult who consented to iNat.
r = next(r for r in recs if "inaturalist" in CONSENT[r["recordedBy"]][0])
draft = {"_NOT_SENT": "draft only; would be POST https://api.inaturalist.org/v1/observations with the observer's own OAuth token",
         "observation": {
             "species_guess": r["vernacularName"], "taxon_id": r["inat"]["id"],
             "observed_on_string": r["eventDate"], "time_zone": "Eastern Time (US & Canada)",
             "latitude": r["latitude"], "longitude": r["longitude"], "positional_accuracy": r["coordinateUncertaintyMeters"],
             "geoprivacy": "obscured", "captive_flag": False,
             "description": "Garden BioBlitz 2026, %s" % r["parkName"],
             "observation_field_values_attributes": []},
         "_then": "POST /v1/observation_photos with observation_id and the photo file; photo license comes from the observer's account settings"}
json.dump(draft, open(os.path.join(HERE, "out/inat_draft.json"), "w"), indent=1)
print(json.dumps(draft, indent=1))
print("\nDwC row for the same record:"); print(json.dumps(next(x for x in rows if x["occurrenceID"] == r["occurrenceId"]), indent=1))
