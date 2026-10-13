"""Re-home makerspace-operations concepts as new versions in `shared-facilities`.

Each new version keeps its record (fields, anchors, attribution) and changes
only what was too narrow: label, wording, context, and references to the other
re-homed concepts. Published in dependency order so references point at new
versions. usage: LATTICE_API_KEY=… python3 rehome.py <target>
"""
import json, os, sys, urllib.request

T = sys.argv[1]
KEY = os.environ["LATTICE_API_KEY"]
D = os.path.dirname(os.path.abspath(__file__))
old = json.load(open(os.path.join(D, "old.json")))
by_slug = {u.split("/c/makerspace-operations/")[1].split("@")[0]: (u, r) for u, r in old.items()}

def call(name, args):
    req = urllib.request.Request(f"{T}/api/tools/{name}", data=json.dumps(args).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + KEY})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

FACILITIES = "a shared facility such as a makerspace, fab lab, tool library, school shop or coworking space"
NEW = {
  "member": ("facility-member", "Facility Member",
    f"A person's account at {FACILITIES}: the identity its door and equipment readers recognise, the membership plan and status that decide whether they may enter, and the dates and waiver that bound it. Also covers an account held only for an access card."),
  "equipment": ("shared-equipment", "Shared Equipment",
    "A tool, machine or instrument that the users of a shared facility operate, reserve or borrow, often gated behind a training badge and wired to a card reader. Distinguished from general assets by its capability, hazard band, required badges and reservation rules."),
  "equipment-badge": ("equipment-badge", "Equipment Badge",
    "A named, versioned qualification that a shared facility requires before someone may operate a particular machine or class of machines: its competency checklist, hazard class, prerequisites and how it is assessed (training, checkout, class). It is the definition; a person holding it is recorded separately."),
  "equipment-authorization": ("equipment-authorization", "Equipment Authorization",
    "The record that one person holds a specific equipment badge at a shared facility, so card readers and machines let them operate it. Carries who granted it after which training, its lifecycle (pending, active, suspended, expired) and, when exported, the signed credential that lets another facility honour it."),
  "access-event": ("access-event", "Access Event",
    "One attempt to get through a door or power up a machine at a shared facility: who presented which card or identifier at which reader, which permission was checked, and whether it was granted. Also covers a guest checked in by a hosting member."),
  "tool-loan": ("tool-loan", "Tool Loan",
    "A borrowing of a shared item to take away from a facility or lending library: who borrowed which item, when it is due, renewals, the condition inspection on return, and any late, damage or replacement charges. Distinct from an on-site reservation."),
  "equipment-reservation": ("equipment-reservation", "Equipment Reservation",
    "A booked time window on one shared machine or instrument, held by a user for a stated purpose (personal work, training checkout, class, production). Shown at the machine's station so walk-up users see who has it next."),
  "equipment-usage-session": ("equipment-usage-session", "Equipment Usage Session",
    "A period during which one identified user actually runs a shared machine or instrument, opened when they authenticate at it and closed when they log out or the job ends. Records duration and consumables used so time and material can be billed."),
  "shop-equipment-asset": ("shared-equipment-asset", "Shared Equipment Asset",
    "A shared facility's machine or tool as kept on its asset register: everything a basic equipment record holds plus the kit parts inside it, optional and safety requirements, guest use, booking lead time, use instructions and where it came from."),
  "material": ("stock-material", "Stock Material",
    "A consumable that a shared facility stocks and sells to users or uses on its machines, such as filament, sheet stock, ink or ingredients: its sale unit and price, its cost, stock count and reorder threshold, where it and its backstock are kept, and which machines it works with."),
  "material-transaction": ("material-transaction", "Material Transaction",
    "One change to a stocked consumable's quantity or one charge for it: a user buying some onto a tab or paying at once, a restock, a loss, or internal or educational use, recorded as a signed quantity with the price, buyer and payment state where it was a sale."),
  "facility-task": ("facility-task", "Facility Task",
    "A piece of work needed to keep a shared facility running, such as cleaning, maintenance, inspection or restocking, or a dated volunteer shift, that staff post and members claim, optionally tied to a machine, a required badge and a recurring schedule."),
}
ORDER = ["member", "equipment", "equipment-badge", "equipment-authorization", "access-event", "tool-loan",
         "equipment-reservation", "equipment-usage-session", "shop-equipment-asset", "material", "material-transaction", "facility-task"]

session = "rehome-shared-facilities"
call("lattice_discover", {"description": "shared facility equipment, members, badges, loans and consumables", "sessionId": session})
ctx = call("lattice_publish_context", {"slug": "shared-facilities", "title": "Shared Facilities",
  "definition": "Places where many people share equipment and space under a membership or booking: makerspaces, fab labs, hackerspaces, tool libraries, school and university shops, community kitchens and coworking spaces. Covers their members, equipment, training badges, access, reservations, loans, consumables and upkeep."})
ctx_uri = ctx.get("uri") or ctx.get("existing", {}).get("uri")
if not ctx_uri:
    sys.exit(f"context failed: {ctx}")

replaced = {}  # old URI -> new URI
def repoint(structure):
    s = json.dumps(structure)
    for o, n in replaced.items():
        s = s.replace(o, n)
    return json.loads(s)

for key in ORDER:
    old_uri, r = by_slug[key]
    slug, label, definition = NEW[key]
    alt = [a.strip() for a in (r.get("altLabel") or {}).get("en", "").split(";") if a.strip()]
    if r["prefLabel"]["en"] != label and r["prefLabel"]["en"] not in alt:
        alt.insert(0, r["prefLabel"]["en"])
    attribution = {k: r[k] for k in ("importedFrom", "sourceLicense", "sourceNotes", "inspiredBySources") if r.get(k)}
    if r.get("createdBy"): attribution["authoredBy"] = r["createdBy"]
    common = {"contextUri": ctx_uri, "conceptSlug": slug, "prefLabel": label, "altLabels": alt, "definition": definition,
              "structure": repoint(r.get("structure")), "sourceAttribution": attribution, "sessionId": session, "previousVersion": old_uri}
    if r.get("forkedFrom"):
        parent = replaced.get(r["forkedFrom"], r["forkedFrom"])
        res = call("lattice_publish_fork", {**common, "parentUri": parent, "changeset": {k: v for k, v in r["changeset"].items() if k != "upgradable"},
                                            "coRefersWith": r.get("coRefersWith", [])})
    else:
        res = call("lattice_publish_concept", {**common, "conceptKind": r.get("conceptKind"), "broader": r.get("broader"),
                                               **({"closeMatch": r["closeMatch"]} if r.get("closeMatch") else {}),
                                               **({"broadMatch": r["broadMatch"]} if r.get("broadMatch") else {}),
                                               "coRefersWith": r.get("coRefersWith", []),
                                               **({"coRefersRationale": r["coRefersRationale"]} if r.get("coRefersRationale") else {})})
    if "error" in res:
        sys.exit(f"✗ {label}: {json.dumps(res['error'])[:400]}")
    replaced[old_uri] = res["uri"]
    warn = [w.get("message", w.get("kind")) for w in res.get("warnings", [])]
    print(f"  {r['prefLabel']['en']:24} → {res['uri'].split('/c/')[1]}" + (f"\n      warnings: {' | '.join(warn)}" if warn else ""))
json.dump(replaced, open(os.path.join(D, "replaced.json"), "w"), indent=1)
print(f"{len(replaced)} concepts re-homed")
