import json, sys, collections
sys.path.insert(0, sys.argv[1]); from corridor import Corridor
c = Corridor(sys.argv[2], sys.argv[3])
obs = json.load(open(sys.argv[4]))
BUF = 300
stats = collections.Counter(); inside = []
for o in obs:
    if not o['coords']: stats['no coords'] += 1; continue
    if o['obscured']: stats['obscured (excluded)'] += 1; continue
    d = c.dist(*o['coords'])
    if d > BUF: stats['outside 300 m'] += 1; continue
    if (o['positional_accuracy'] or 0) > BUF: stats['accuracy > 300 m (excluded)'] += 1; continue
    o['dist_m'] = round(d); inside.append(o); stats['in corridor'] += 1
print(dict(stats), 'total', len(obs))
json.dump(inside, open(sys.argv[5], 'w'))
