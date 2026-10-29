import json, time, urllib.request, urllib.parse, sys
out = sys.argv[1]
UA = 'InvasiveWatch-test/0.1 (trail stewardship prototype)'
base = 'https://api.inaturalist.org/v1/observations'
params = dict(iconic_taxa='Plantae', captive='false', d1='2023-10-29', quality_grade='research,needs_id',
              swlat=41.300, swlng=-72.915, nelat=41.340, nelng=-72.899, per_page=200, order_by='id', order='asc')
keep = []
id_above = 0
while True:
    q = dict(params, id_above=id_above)
    req = urllib.request.Request(base + '?' + urllib.parse.urlencode(q), headers={'User-Agent': UA})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    res = d['results']
    for o in res:
        t = o.get('taxon') or {}
        keep.append(dict(  # no user fields kept
            id=o['id'], uri=o.get('uri'), observed_on=o.get('observed_on'), quality_grade=o.get('quality_grade'),
            coords=(o.get('geojson') or {}).get('coordinates'), positional_accuracy=o.get('positional_accuracy'),
            obscured=o.get('obscured'), geoprivacy=o.get('geoprivacy'), taxon_geoprivacy=o.get('taxon_geoprivacy'),
            license_code=o.get('license_code'),
            taxon=dict(id=t.get('id'), name=t.get('name'), rank=t.get('rank'), common=t.get('preferred_common_name'),
                       introduced=t.get('introduced'), native=t.get('native'), ancestor_ids=t.get('ancestor_ids'))))
    print(len(keep), '/', d['total_results'], flush=True)
    if len(res) < 200: break
    id_above = res[-1]['id']
    time.sleep(1.2)
json.dump(keep, open(out, 'w'))
