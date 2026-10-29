import json, math
LAT0 = 41.32
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def xy(lon, lat): return ((lon + 72.9) * KX, (lat - LAT0) * KY)
def _segdist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx*dx + dy*dy
    t = 0 if L == 0 else max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / L))
    return math.hypot(px - (ax + t*dx), py - (ay + t*dy))
def _inside(p, ring):
    x, y = p; c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i-1]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1) + x1: c = not c
    return c
class Corridor:
    def __init__(self, line_json, area_json, aus=('CT5302-00_01', 'CT-C1_023-SB')):
        self.lines, self.rings = [], []
        for f in json.load(open(line_json))['features'][:1]:
            for p in f['geometry']['paths']: self.lines.append([xy(*q) for q in p])
        for f in json.load(open(area_json))['features'][:1]:
            for r in f['geometry']['rings']: self.rings.append([xy(*q) for q in r])
    def dist(self, lon, lat):
        p = xy(lon, lat)
        if any(_inside(p, r) for r in self.rings):  # holes are islands; treat as on-river
            return 0.0
        d = min(_segdist(p, a, b) for L in self.lines + self.rings for a, b in zip(L, L[1:]))
        return d
