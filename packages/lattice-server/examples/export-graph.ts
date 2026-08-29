// Export a visualization dataset from the New Haven scenario: the
// concept graph (lineage + semantic-closeness edges), per-department
// manifests, app-to-app compatibility, and a "built smart" score per
// app. Feeds the lattice map visualization; run:
//
//   npx tsx examples/export-graph.ts out.json
//
// The scoring here is a v0.1 preview of the DECISIONS.md v0.2
// "standardness" direction, computed from three observable signals:
//   reuse      — share of the app's concepts adopted or forked rather
//                than originated
//   dedupe     — share free of UNLINKED near-duplicates (>= 0.85
//                cosine to another concept with no lineage/coRefers
//                edge acknowledging it)
//   anchoring  — share carrying external closeMatch or coRefersWith
//                links

import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { cosine } from "../src/discover/embedder.ts";
import type { ConceptRecord } from "../src/hashing/types.ts";

interface ManifestEntry {
  uri: string;
  status: "adopted" | "forked" | "originated";
}

async function main() {
  const outPath = process.argv[2] ?? "graph-export.json";
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-export-"));
  const lattice = await LatticeInstance.create({ dataDir: tmp });
  const scheme = lattice.contextUri();

  const publish = async (
    sessionId: string,
    slug: string,
    record: Omit<ConceptRecord, "type" | "inScheme">,
  ) => {
    await lattice.discover({
      description: (record.definition as Record<string, string>).en,
      sessionId,
    });
    return lattice.publishConcept({
      contextSlug: "civic",
      conceptSlug: slug,
      record: { type: "Concept", inScheme: scheme, ...record } as ConceptRecord,
      sessionId,
    });
  };

  // --- Building Department (first mover: everything originates) -----
  const A = "viz-building";
  const parcel = await publish(A, "property-parcel", {
    prefLabel: { en: "Property Parcel" },
    definition: {
      en: "A legally defined unit of real estate within the city, identified in the assessor's database, with an address, owner of record, and zoning designation.",
    },
    broader: [lattice.skeletonUri("location")!],
    closeMatch: ["schema:Place", "wd:Q397059"],
    coRefersWith: [],
    coRefersRationale: "First location concept in the civic catalog.",
    conceptKind: "place",
  });
  const permit = await publish(A, "permit-application", {
    prefLabel: { en: "Permit Application" },
    definition: {
      en: "A request submitted by an owner or contractor for municipal authorization to perform regulated work, moving through intake, review, decision, and issuance states.",
    },
    broader: [lattice.skeletonUri("workflow")!],
    closeMatch: ["schema:GovernmentPermit"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this authorization workflow yet.",
    conceptKind: "workflow",
  });
  const inspection = await publish(A, "inspection", {
    prefLabel: { en: "Inspection" },
    definition: {
      en: "A scheduled site visit by a city official to verify that work or conditions at a property comply with applicable codes, producing a pass, fail, or partial result.",
    },
    broader: [lattice.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this compliance visit yet.",
    conceptKind: "event",
  });

  // --- Parks & Rec (discovers, adopts, forks) -----------------------
  const B = "viz-parks";
  const facility = await publish(B, "park-facility", {
    prefLabel: { en: "Park Facility" },
    definition: {
      en: "A reservable built amenity within a city park, such as a pavilion, athletic field, court, or meeting room, managed by the parks department.",
    },
    forkedFrom: parcel.uri,
    changeset: [
      { op: "remove", field: "ownerOfRecord" },
      { op: "remove", field: "zoningCode" },
      { op: "add", field: "facilityType", type: "string" },
      { op: "add", field: "capacity", type: "number" },
      { op: "rename", from: "parcelId", to: "facilityId" },
    ],
    conceptKind: "place",
  });
  const reservation = await publish(B, "facility-reservation", {
    prefLabel: { en: "Facility Reservation" },
    definition: {
      en: "A time-bounded booking of a public amenity by a resident or organization, with requested date, party size, fee, and approval status.",
    },
    broader: [lattice.skeletonUri("transaction")!],
    closeMatch: ["schema:Reservation"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this booking yet.",
    conceptKind: "event",
  });

  // --- Public Works (legacy 311 retrofit, adopts parcel) ------------
  const C = "viz-publicworks";
  const svcRequest = await publish(C, "service-request", {
    prefLabel: { en: "Service Request" },
    definition: {
      en: "A report from a resident asking the city to address a condition such as a pothole or blocked drain, routed to a responsible department and tracked to resolution.",
    },
    broader: [lattice.skeletonUri("record")!],
    importedFrom: "legacy://311-export/issues-table",
    closeMatch: ["schema:Action"],
    coRefersWith: [],
    coRefersRationale: "Extracted from the legacy 311 system.",
    conceptKind: "workflow",
  });

  // --- Fire Marshal (unaware near-duplicate, no acknowledging link) --
  const D = "viz-firemarshal";
  const siteInspection = await publish(D, "site-inspection", {
    prefLabel: { en: "Site Inspection" },
    definition: {
      en: "A scheduled site visit by a municipal official to verify that work or conditions at a property comply with applicable regulations, recording a pass, fail, or partial outcome.",
    },
    broader: [lattice.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [],
    coRefersRationale: "No related concept found.", // (it missed one)
    conceptKind: "event",
  });

  // --- Manifests ----------------------------------------------------
  const apps: Record<string, { dept: string; concepts: ManifestEntry[] }> = {
    "permit-tracker": {
      dept: "Building Department",
      concepts: [
        { uri: parcel.uri, status: "originated" },
        { uri: permit.uri, status: "originated" },
        { uri: inspection.uri, status: "originated" },
      ],
    },
    "park-reservations": {
      dept: "Parks & Recreation",
      concepts: [
        { uri: parcel.uri, status: "adopted" },
        { uri: facility.uri, status: "forked" },
        { uri: reservation.uri, status: "originated" },
      ],
    },
    "311-modernization": {
      dept: "Public Works",
      concepts: [
        { uri: parcel.uri, status: "adopted" },
        { uri: svcRequest.uri, status: "originated" },
      ],
    },
    "fire-inspections": {
      dept: "Fire Marshal",
      concepts: [{ uri: siteInspection.uri, status: "originated" }],
    },
  };

  // --- Graph nodes: civic concepts + referenced skeleton parents ----
  const civicUris = [
    parcel.uri, permit.uri, inspection.uri,
    facility.uri, reservation.uri, svcRequest.uri, siteInspection.uri,
  ];
  const skeletonSlugs = ["location", "workflow", "event", "transaction", "record"];
  const skeletonRefs = skeletonSlugs.map((s) => lattice.skeletonUri(s)!);

  const nodes = [...civicUris, ...skeletonRefs].map((uri) => {
    const rec = lattice.resolve(uri)!;
    const usedBy = Object.entries(apps)
      .filter(([, a]) => a.concepts.some((c) => c.uri === uri))
      .map(([name]) => name);
    return {
      uri,
      label: (rec.prefLabel as Record<string, string>).en,
      definition: ((rec.definition as Record<string, string>)?.en ?? "").slice(0, 180),
      kind: skeletonRefs.includes(uri) ? "skeleton" : "concept",
      conceptKind: rec.conceptKind ?? null,
      usedBy,
    };
  });

  // --- Edges: lineage + semantic closeness --------------------------
  type Edge = { from: string; to: string; type: string; similarity?: number };
  const edges: Edge[] = [];
  for (const uri of civicUris) {
    const rec = lattice.resolve(uri)!;
    for (const b of rec.broader ?? []) {
      if (skeletonRefs.includes(b)) edges.push({ from: uri, to: b, type: "broader" });
    }
    if (rec.forkedFrom) edges.push({ from: uri, to: rec.forkedFrom as string, type: "forkedFrom" });
    for (const co of rec.coRefersWith ?? []) {
      edges.push({ from: uri, to: co, type: "coRefersWith" });
    }
  }
  const linked = new Set(edges.map((e) => [e.from, e.to].sort().join("|")));
  const sims: Record<string, number> = {};
  for (let i = 0; i < civicUris.length; i++) {
    for (let j = i + 1; j < civicUris.length; j++) {
      const va = lattice.vectors.vectorOf(civicUris[i])!;
      const vb = lattice.vectors.vectorOf(civicUris[j])!;
      const s = cosine(va, vb);
      const key = [civicUris[i], civicUris[j]].sort().join("|");
      sims[key] = Number(s.toFixed(4));
      if (s >= 0.65 && !linked.has(key)) {
        edges.push({
          from: civicUris[i],
          to: civicUris[j],
          type: "semantic",
          similarity: Number(s.toFixed(3)),
        });
      }
    }
  }

  // --- Scores per app ----------------------------------------------
  const simOf = (a: string, b: string) => sims[[a, b].sort().join("|")] ?? 0;
  const hasLink = (a: string, b: string) => linked.has([a, b].sort().join("|"));

  const scores: Record<string, unknown> = {};
  for (const [name, app] of Object.entries(apps)) {
    const total = app.concepts.length;
    const reused = app.concepts.filter((c) => c.status !== "originated").length;
    // A concept is dup-flagged only when it has an unlinked >= 0.85
    // neighbor that existed BEFORE it was published — the debt belongs
    // to the later publisher who failed to acknowledge the earlier
    // concept, not to the original.
    const createdAt = (u: string) => lattice.store.getConceptMeta(u)?.createdAt ?? "";
    const dupFree = app.concepts.filter((c) => {
      const dup = civicUris.find(
        (o) =>
          o !== c.uri &&
          simOf(c.uri, o) >= 0.85 &&
          !hasLink(c.uri, o) &&
          createdAt(o) < createdAt(c.uri),
      );
      return !dup;
    }).length;
    const anchored = app.concepts.filter((c) => {
      if (c.status === "adopted") return true; // inherits the catalog record's links
      const rec = lattice.resolve(c.uri)!;
      return (
        (rec.closeMatch ?? []).length > 0 ||
        (rec.coRefersWith ?? []).length > 0 ||
        !!rec.forkedFrom
      );
    }).length;
    const reuse = reused / total;
    const dedupe = dupFree / total;
    const anchoring = anchored / total;
    scores[name] = {
      reuse: Number(reuse.toFixed(3)),
      dedupe: Number(dedupe.toFixed(3)),
      anchoring: Number(anchoring.toFixed(3)),
      overall: Math.round(100 * (0.4 * reuse + 0.35 * dedupe + 0.25 * anchoring)),
    };
  }

  // --- App-to-app compatibility ------------------------------------
  const appNames = Object.keys(apps);
  const appEdges: Array<{
    a: string; b: string;
    sharedUris: number; forkLinks: number; semanticPairs: number;
    compatibility: number;
  }> = [];
  const descendsFrom = (a: string, b: string): boolean => {
    let cur: string | undefined = a;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur === b) return true;
      cur = lattice.resolve(cur)?.forkedFrom as string | undefined;
    }
    return false;
  };
  for (let i = 0; i < appNames.length; i++) {
    for (let j = i + 1; j < appNames.length; j++) {
      const ca = apps[appNames[i]].concepts;
      const cb = apps[appNames[j]].concepts;
      let sharedUris = 0, forkLinks = 0, semanticPairs = 0, raw = 0;
      for (const x of ca) {
        for (const y of cb) {
          if (x.uri === y.uri) { sharedUris++; raw += 1.0; continue; }
          if (descendsFrom(x.uri, y.uri) || descendsFrom(y.uri, x.uri)) {
            forkLinks++; raw += 0.7; continue;
          }
          const s = simOf(x.uri, y.uri);
          if (s >= 0.75) { semanticPairs++; raw += 0.4; }
          else if (s >= 0.65) { semanticPairs++; raw += 0.2; }
        }
      }
      appEdges.push({
        a: appNames[i], b: appNames[j],
        sharedUris, forkLinks, semanticPairs,
        compatibility: Number(Math.min(1, raw / Math.min(ca.length, cb.length)).toFixed(3)),
      });
    }
  }

  const out = { generatedFor: "new-haven-demo", nodes, edges, apps, scores, appEdges };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${outPath}`);
  console.log(JSON.stringify(scores, null, 2));
  console.log(JSON.stringify(appEdges, null, 2));

  lattice.close();
  rmSync(tmp, { recursive: true, force: true });
}

main();
