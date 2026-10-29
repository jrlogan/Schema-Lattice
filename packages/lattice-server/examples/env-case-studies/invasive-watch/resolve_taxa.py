import json, time, urllib.request, urllib.parse, sys
ct = json.load(open(sys.argv[1])); out = sys.argv[2]
UA = 'InvasiveWatch-test/0.1 (trail stewardship prototype)'
extra = ['Asclepias syriaca', 'Rudbeckia hirta', 'Quercus rubra', 'Fallopia japonica']
names = [x['scientificName'] for x in ct] + extra
res = {}
for n in names:
    q = urllib.parse.urlencode(dict(q=n, is_active='true', per_page=5))
    req = urllib.request.Request('https://api.inaturalist.org/v1/taxa?' + q, headers={'User-Agent': UA})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    cands = [dict(id=t['id'], name=t['name'], rank=t['rank'], matched_term=t.get('matched_term'),
                  iconic=t.get('iconic_taxon_name'), common=t.get('preferred_common_name')) for t in d['results']]
    res[n] = cands
    time.sleep(1.1)
json.dump(res, open(out, 'w'), indent=1)
print(len(res))
