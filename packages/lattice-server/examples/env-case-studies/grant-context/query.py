"""Point-in-polygon queries against the layers the catalog lists, for two trail points."""
import json, sys, time, urllib.parse, urllib.request

POINTS = {"fair_haven": (41.3095, -72.9035), "criscuolo_park": (41.2985, -72.9010)}
UA = {"User-Agent": "grant-context-pack/0.1 (volunteer trail group test)"}

LAYERS = {
    "ej_block_groups": ("https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Environmental_Justice_2025_Set/FeatureServer/0", "GEOID,BlockGroup,PercentPop,PercentMin,PercentLEP,TOWN_NO,Town"),
    "ej_distressed": ("https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Environmental_Justice_2025_Set/FeatureServer/1", "TOWN_NO,TOWN,GRACE_PERIOD"),
    "tract": ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10", "GEOID,NAME,BASENAME,POP100"),
    "huc12": ("https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6", "huc12,name,tohuc,areasqkm,loaddate"),
    "flood": ("https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28", "DFIRM_ID,VERSION_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,SOURCE_CIT"),
    "open_space": ("https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_Open_Space_Parcels/FeatureServer/0", "Location,Town_Name,Parcel_ID,CAMA_Link,FIPS,Land_Acres,State_Use,State_Use_Description,Valuation_Year,Edit_Date"),
    "nh_parks": ("https://services2.arcgis.com/", None),  # filled from catalog page below if needed
    "attains_areas": ("https://gispub.epa.gov/arcgis/rest/services/OW/ATTAINS_Assessment/MapServer/2", "*"),
}


def get(url, params):
    q = url + "/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(q, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def point_query(url, fields, lat, lon, extra=None):
    p = {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
         "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "returnGeometry": "false",
         "resultRecordCount": "10", "f": "json"}
    if extra:
        p.update(extra)
    return get(url, p)


if __name__ == "__main__":
    names = sys.argv[1:] or [k for k in LAYERS if LAYERS[k][1]]
    out = {}
    for n in names:
        url, fields = LAYERS[n]
        out[n] = {}
        for pt, (lat, lon) in POINTS.items():
            try:
                d = point_query(url, fields, lat, lon)
                out[n][pt] = d.get("features", d)
                out[n][pt] = [f.get("attributes", f) for f in d["features"]] if "features" in d else d
            except Exception as e:
                out[n][pt] = {"error": repr(e)}
            time.sleep(0.5)
    print(json.dumps(out, indent=1, default=str))
