import json, sys, collections
def inside(x, y, ring):
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i][:2]; x2, y2 = ring[i-1][:2]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1) + x1: c = not c
    return c
def contains(feat, x, y):  # even-odd over all rings handles holes
    return sum(inside(x, y, r) for r in feat['geometry']['rings']) % 2 == 1
res = json.load(open(sys.argv[1])); obs = json.load(open(sys.argv[2]))
names = {r['inat_name'] for r in res['priority']}
ids = set(res['ct_matched_ids']); inv = [o for o in obs if o['id'] in ids]
ej = json.load(open(sys.argv[3]))['features']; hu = json.load(open(sys.argv[4]))['features']
ejc, huc = collections.Counter(), collections.Counter()
for o in inv:
    x, y = o['coords']
    e = [f['attributes']['GEOID'] for f in ej if contains(f, x, y)]
    h = [f['attributes']['name'] + ' ' + f['attributes']['huc12'] for f in hu if contains(f, x, y)]
    ejc[e[0] if e else None] += 1; huc[h[0] if h else None] += 1
    o['ej'] = e[0] if e else None
print('invasive obs tried', len(inv))
print('in an EJ block group:', len(inv) - ejc[None], 'not EJ:', ejc[None]); print(ejc.most_common(6))
print('HUC12:', dict(huc))
# all corridor obs too
allin = sum(1 for o in obs if any(contains(f, *o['coords']) for f in ej))
print('all corridor plant obs in EJ BG:', allin, 'of', len(obs))
# by guide enemies
for n in ['Reynoutria japonica','Celastrus orbiculatus','Alliaria petiolata','Ailanthus altissima']:
    s = [o for o in inv if o['taxon']['name'].startswith(n)]
    print(n, 'in EJ:', sum(1 for o in s if o['ej']), 'of', len(s))
