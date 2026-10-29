"""Share of an area in FEMA SFHA, by grid sampling (stdlib only)."""
import json, math, sys, time
sys.path.insert(0, sys.argv[1])
from query import get, POINTS
FEMA="https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
PARKS="https://gis.newhavenct.gov/server/rest/services/Hosted/Comprehensive_Parks_Public_View/FeatureServer/0"

def pip(x,y,rings):
    inside=False
    for r in rings:  # even-odd across all rings handles holes
        n=len(r); j=n-1
        for i in range(n):
            xi,yi=r[i]; xj,yj=r[j]
            if (yi>y)!=(yj>y) and x < (xj-xi)*(y-yi)/(yj-yi)+xi: inside=not inside
            j=i
    return inside

def flood_polys(xmin,ymin,xmax,ymax):
    d=get(FEMA,{"geometry":f"{xmin},{ymin},{xmax},{ymax}","geometryType":"esriGeometryEnvelope","inSR":"4326","outSR":"4326",
               "spatialRel":"esriSpatialRelIntersects","outFields":"FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE","returnGeometry":"true","resultRecordCount":"50","f":"json"})
    return [(f["attributes"],f["geometry"]["rings"]) for f in d["features"]]

def share(area_test, bbox, n=60):
    xmin,ymin,xmax,ymax=bbox
    polys=flood_polys(*bbox)
    tot=0; zones={}
    for i in range(n):
        for j in range(n):
            x=xmin+(i+.5)*(xmax-xmin)/n; y=ymin+(j+.5)*(ymax-ymin)/n
            if not area_test(x,y): continue
            tot+=1; z="none"
            for a,r in polys:
                if pip(x,y,r): z=f'{a["FLD_ZONE"]}{"/"+a["ZONE_SUBTY"] if a["ZONE_SUBTY"] else ""} SFHA={a["SFHA_TF"]} BFE={a["STATIC_BFE"]}'; break
            zones[z]=zones.get(z,0)+1
    return tot,{k:round(100*v/tot,1) for k,v in sorted(zones.items(),key=lambda kv:-kv[1])}, len(polys)

# Criscuolo Park polygon
d=get(PARKS,{"where":"park_name='Criscuolo Park'","outFields":"park_name","returnGeometry":"true","outSR":"4326","f":"json"})
rings=d["features"][0]["geometry"]["rings"]
xs=[p[0] for r in rings for p in r]; ys=[p[1] for r in rings for p in r]
print("Criscuolo Park polygon:", share(lambda x,y: pip(x,y,rings), (min(xs),min(ys),max(xs),max(ys))))
time.sleep(.5)
# 200 m buffers around both given points
for pt,(lat,lon) in POINTS.items():
    R=200; dlat=R/111320; dlon=R/(111320*math.cos(math.radians(lat)))
    test=lambda x,y,lat=lat,lon=lon: ((x-lon)/dlon)**2+((y-lat)/dlat)**2<=1
    print(pt,"200m buffer:", share(test,(lon-dlon,lat-dlat,lon+dlon,lat+dlat)))
    time.sleep(.5)
