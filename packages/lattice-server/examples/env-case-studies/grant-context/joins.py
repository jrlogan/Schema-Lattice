import json, sys, time
sys.path.insert(0, sys.argv[1])
from query import get
BG="https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Environmental_Justice_2025_Set/FeatureServer/0"
DM="https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Environmental_Justice_2025_Set/FeatureServer/1"
TR="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10"
bg=get(BG,{"where":"TOWN_NO=93","outFields":"GEOID,TOWN_NO","returnGeometry":"false","resultRecordCount":"200","f":"json"})["features"]
bg=[f["attributes"] for f in bg]; time.sleep(.5)
dm=[f["attributes"] for f in get(DM,{"where":"1=1","outFields":"TOWN_NO,TOWN","returnGeometry":"false","resultRecordCount":"200","f":"json"})["features"]]; time.sleep(.5)
tr=[f["attributes"] for f in get(TR,{"where":"STATE='09' AND COUNTY='009'","outFields":"GEOID,TRACT","returnGeometry":"false","resultRecordCount":"300","f":"json"})["features"]]
print("NH EJ block groups:",len(bg),"distressed munis:",len(dm),"NH county tracts (TIGERweb 2020):",len(tr))
print("sample BG GEOID prefixes:",sorted({g["GEOID"][:5] for g in bg}),"tract prefixes:",sorted({t["GEOID"][:5] for t in tr}))
# catalog-offered key join: BG.GEOID == DM.TOWN_NO
dmt={str(d["TOWN_NO"]) for d in dm}
print("join GEOID==TOWN_NO:",sum(g["GEOID"] in dmt for g in bg),"/",len(bg))
dmn={d["TOWN_NO"] for d in dm}
print("join TOWN_NO==TOWN_NO:",sum(g["TOWN_NO"] in dmn for g in bg),"/",len(bg))
trg={t["GEOID"] for t in tr}; trc={t["GEOID"][-6:] for t in tr}
print("join BG.GEOID[:11]==tract.GEOID raw:",sum(g["GEOID"][:11] in trg for g in bg),"/",len(bg))
print("join on 6-digit tract code (GEOID[5:11]==TRACT):",sum(g["GEOID"][5:11] in trc for g in bg),"/",len(bg))
