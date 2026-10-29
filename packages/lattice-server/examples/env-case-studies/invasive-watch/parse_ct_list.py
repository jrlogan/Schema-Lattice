import re, html, json, sys
src, out = sys.argv[1], sys.argv[2]
t = open(src, encoding='utf-8', errors='replace').read()
parts = re.split(r"<div class='uc-accordion'>", t)[1:]
rows = []
first_alpha = next(i for i, q in enumerate(parts) if q.startswith('Acer'))
for idx, p in enumerate(parts):
    head = html.unescape(re.sub(r'<[^>]+>', '', p.split('</div>', 1)[0])).strip()
    body = html.unescape(re.sub(r'<[^>]+>', ' ', p[:3000]))
    body = re.sub(r'\s+', ' ', body)
    gf = re.search(r'Growth form or habit:\s*(.*?)(?:Prohibited|$)', body)
    pr = re.search(r'Prohibited by statute\?\s*([^.]*?)(?:\s{2}|Go Botany|USDA|http| [A-Z][a-z]+ -|$)', body)
    pr_full = re.search(r'Prohibited by statute\?\s*(.{0,120})', body)
    m = re.match(r'(.+?)(?:\s+-\s+|\s*[–—]\s*)(.+)$', head)
    sci, common = (m.group(1), m.group(2)) if m else (head, '')
    sci = re.sub(r'^[A-Z][a-z]+ \d{4}:\s*', '', sci); common = re.sub(r'^[A-Z][a-z]+ \d{4}:\s*', '', common)
    if idx < first_alpha:  # page's newest block is written 'Common - Scientific'
        sci, common = common, sci
    syn = []
    sm = re.search(r'\((?:syn\.?|synonym[s]?)\s*([^)]*)\)', common, re.I)
    if sm:
        syn = [s.strip() for s in re.split(r',| and ', sm.group(1)) if s.strip()]
        common = (common[:sm.start()] + common[sm.end():]).strip()
    potential = '(P)' in head or '(p)' in head
    sci_clean = re.sub(r'\(P\)', '', sci).strip()
    pm = re.search(r'\(([A-Z][a-z]+ [a-z-]+)\)', sci_clean)
    if pm: syn.append(pm.group(1)); sci_clean = sci_clean.replace(pm.group(0), '').strip()
    sci_clean = re.sub(r'\s*\(L\.\).*$', '', sci_clean).strip()
    raw = pr_full.group(1) if pr_full else ''
    if raw.startswith('Yes'):
        em = re.match(r'Yes \(Effective ([^)]*)\)', raw)
        legal = 'prohibited' + (' (effective ' + em.group(1) + ')' if em else '')
    elif raw.startswith('N/A'): legal = 'not prohibited (N/A)'
    else: legal = 'unknown'
    rows.append(dict(heading=head, scientificName=sci_clean, commonName=re.sub(r'\(P\)', '', common).strip(),
                     synonyms=syn, potentiallyInvasive=potential,
                     growthForm=gf.group(1).strip() if gf else None,
                     prohibitedRaw=raw[:40], legalStatus=legal))
json.dump(rows, open(out, 'w'), indent=1)
print(len(rows), 'entries;', sum(r['potentiallyInvasive'] for r in rows), 'marked (P);', sum(bool(r['synonyms']) for r in rows), 'with synonyms')
