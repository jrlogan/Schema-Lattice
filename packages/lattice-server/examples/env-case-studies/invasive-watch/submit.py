import json, sys, time, urllib.request
calls = json.load(open(sys.argv[1])); out = []
for tool, body in calls:
    for k in ('text', 'note'):
        if k in body: assert len(body[k]) <= 300, (k, len(body[k]), body[k][:60])
    req = urllib.request.Request('https://schemalattice.com/api/tools/' + tool, data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json'}, method='POST')
    try: r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e: r = {'http_error': e.code, 'body': e.read().decode()[:500]}
    out.append(dict(tool=tool, body=body, response=r)); print(tool, body.get('source', body.get('a')), '->', json.dumps(r)[:400]); time.sleep(1)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
