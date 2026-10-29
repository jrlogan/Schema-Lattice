import json, sys, collections, datetime
ct = json.load(open(sys.argv[1])); res = json.load(open(sys.argv[2])); obs = json.load(open(sys.argv[3])); out = sys.argv[4]
TODAY = datetime.date(2026, 10, 29)
norm = lambda s: ' '.join((s or '').replace('×', 'x').lower().split())
def resolve(n):
    for c in res.get(n, []):
        if c['iconic'] != 'Plantae': continue
        if norm(c['name']) == norm(n): return c, 'exact'
        if norm(c['matched_term']).startswith(norm(n)): return c, 'synonym'
    return None, 'none'
FRIENDS = ['Asclepias syriaca', 'Rudbeckia hirta', 'Quercus rubra']
ENEMIES = ['Fallopia japonica', 'Celastrus orbiculatus', 'Alliaria petiolata', 'Ailanthus altissima']
entries = []
for x in ct:
    c, how = resolve(x['scientificName'])
    entries.append(dict(x, inat=c, method=how))
for n in FRIENDS + ENEMIES:
    c, how = resolve(n)
    entries.append(dict(scientificName=n, guide='friend' if n in FRIENDS else 'enemy', inat=c, method=how, ct=False))
def match(e, o):
    t = e['inat']
    if not t: return False
    ot = o['taxon']
    if ot['id'] == t['id'] or t['id'] in (ot['ancestor_ids'] or []): return True
    if t['rank'] in ('variety', 'subspecies', 'form'):  # list names an infraspecific taxon; accept its species
        return norm(ot['name']) == ' '.join(norm(t['name']).split()[:2])
    return False
def summarize(e):
    m = [o for o in obs if match(e, o)]
    m.sort(key=lambda o: o['observed_on'] or '', reverse=True)
    if not m: return None
    MATCHED.update(o['id'] for o in m)
    last = m[0]['observed_on']
    days = (TODAY - datetime.date.fromisoformat(last)).days
    return dict(n=len(m), research=sum(o['quality_grade'] == 'research' for o in m),
                last12=sum((TODAY - datetime.date.fromisoformat(o['observed_on'])).days <= 365 for o in m),
                last=last, days_since=days, example=m[0]['uri'], example_qg=m[0]['quality_grade'],
                median_dist=sorted(o['dist_m'] for o in m)[len(m)//2])
MATCHED = set()
ctrows = []
for e in entries[:len(ct)]:
    s = summarize(e)
    if s: ctrows.append(dict(name=e['scientificName'], inat_name=e['inat']['name'], common=e['commonName'],
                             method=e['method'], potentially=e['potentiallyInvasive'], legal=e['legalStatus'], **s))
CT_MATCHED = set(MATCHED)
guide = {}
for e in entries[len(ct):]:
    ctm = next((r for r in ctrows if e['inat'] and r['inat_name'] == e['inat']['name']), None)
    guide[e['scientificName']] = dict(role=e['guide'], inat_name=e['inat']['name'] if e['inat'] else None, method=e['method'],
                                     on_ct_list=bool(ctm), ct_name=ctm['name'] if ctm else None, summary=summarize(e))
# priority: enemies first, then prohibited-now invasive, then by research-grade count x recency
def prio(r):
    enemy = any(g['role'] == 'enemy' and g['inat_name'] == r['inat_name'] for g in guide.values())
    now_prohibited = r['legal'] == 'prohibited' or ('effective' in r['legal'] and any(y in r['legal'] for y in ('2024',)))
    score = r['research'] + 0.5 * (r['n'] - r['research'])
    recency = 1.0 if r['days_since'] <= 365 else 0.5
    return (-(enemy), -(not r['potentially']), -(now_prohibited), -score * recency)
ctrows.sort(key=prio)
for r in ctrows:
    r['guide_enemy'] = any(g['role'] == 'enemy' and g['inat_name'] == r['inat_name'] for g in guide.values())
stats = dict(obs_in_corridor=len(obs), species_level=sum(o['taxon']['rank'] in ('species','subspecies','variety','hybrid','form') for o in obs),
             ct_entries=len(ct), resolved=collections.Counter(e['method'] for e in entries[:len(ct)]),
             ct_species_seen=len(ctrows), ct_obs=sum(r['n'] for r in ctrows),
             exact_name_only_species_seen=sum(1 for r in ctrows if r['method'] == 'exact'))
json.dump(dict(stats=stats, priority=ctrows, guide=guide, ct_matched_ids=sorted(CT_MATCHED)), open(out, 'w'), indent=1, default=str)
print(json.dumps(stats, default=str))
print('\n%-28s %-24s %4s %4s %4s %-10s %-5s %-34s %s' % ('CT name', 'iNat name', 'obs', 'RG', '12mo', 'last', 'P?', 'legal', 'example'))
for r in ctrows:
    print('%-28s %-24s %4d %4d %4d %-10s %-5s %-34s %s%s' % (r['name'][:28], r['inat_name'][:24], r['n'], r['research'], r['last12'], r['last'],
          'P' if r['potentially'] else '', r['legal'][:34], r['example'], '  <ENEMY' if r['guide_enemy'] else ''))
print()
for k, g in guide.items(): print(k, '|', g['role'], '|', g['inat_name'], g['method'], '| on CT list:', g['ct_name'], '|', g['summary'] and {x: g['summary'][x] for x in ('n','research','last','example')})
