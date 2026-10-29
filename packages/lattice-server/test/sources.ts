// Public data sources (specs/public-sources.md): sources with field lists read
// from the publisher, field mappings as evidence claims, and relationships
// between sources worked out from shared concept fields. Nothing here touches
// the network: the publisher is a fake fetcher.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";
import { ANONYMOUS, OPERATOR } from "../src/server/principals.ts";
import { SourceRejected, coverage, detectGeometry, fieldJoinKind, locationFields } from "../src/sources/sources.ts";
import { isPrivateAddress, platformOf, safeFetchJson, SourceFetchError } from "../src/sources/fetch.ts";
import { wideNetworkPrefix } from "../src/evidence/ledger.ts";
import { renderSourcePage } from "../src/http/sources-page.ts";
import { startHttpServer } from "../src/http/server.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function rejects(fn: () => Promise<unknown> | unknown): Promise<SourceRejected | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof SourceRejected) return err;
    throw err;
  }
}

const DAY = 86_400_000;

// --- a fake publisher --------------------------------------------------------

const PARCELS = "https://gis.example.gov/arcgis/rest/services/Parcels/FeatureServer/0";
const ZONES = "https://gis.example.gov/arcgis/rest/services/Zoning/FeatureServer/2/query";
const SALES = "https://data.example.gov/resource/abcd-1234.json";
const OTHER_STATE = "https://data.example.org/resource/wxyz-9876.json";

const publisher: Record<string, unknown> = {
  [`${PARCELS}?f=json`]: {
    name: "Parcels",
    geometryType: "esriGeometryPolygon",
    copyrightText: "CC0",
    editingInfo: { lastEditDate: Date.UTC(2026, 8, 30), dataLastEditDate: Date.UTC(2026, 8, 15) },
    fields: [
      { name: "OBJECTID", type: "esriFieldTypeOID" },
      { name: "Parcel_ID", type: "esriFieldTypeString", alias: "Parcel ID" },
      { name: "Location", type: "esriFieldTypeString" },
      { name: "Town_Name", type: "esriFieldTypeString", alias: "Town Name" },
      { name: "Assessed_Total", type: "esriFieldTypeDouble", alias: "Assessed Total" },
    ],
  },
  "https://gis.example.gov/arcgis/rest/services/Zoning/FeatureServer/2?f=json": {
    name: "Zoning",
    geometryType: "esriGeometryPolygon",
    fields: [{ name: "zone_code", type: "esriFieldTypeString" }],
  },
  "https://data.example.gov/api/views/abcd-1234.json": {
    id: "abcd-1234",
    name: "Real Estate Sales",
    description: "<p>Sales <b>recorded</b> by town assessors.</p>",
    license: { name: "Public Domain" },
    rowsUpdatedAt: Date.UTC(2026, 6, 1) / 1000,
    columns: [
      { fieldName: "town", name: "Town", dataTypeName: "text" },
      { fieldName: "address", name: "Address", dataTypeName: "text" },
      { fieldName: "saleamount", name: "Sale Amount", dataTypeName: "number" },
      { fieldName: "daterecorded", name: "Date Recorded", dataTypeName: "calendar_date" },
      { fieldName: "geo_coordinates", name: "Location", dataTypeName: "point" },
      { fieldName: ":@computed_region_x", name: "Counties", dataTypeName: "number" },
    ],
  },
  "https://data.example.org/api/views/wxyz-9876.json": {
    id: "wxyz-9876",
    name: "Other State Sales",
    columns: [{ fieldName: "amount", name: "Amount", dataTypeName: "number" }],
  },
};
// A lot layer whose aggregates the server can ask for: one text field full of
// blank strings, lat/long in State Plane feet, degrees in latdd.
const LOTS = "https://gis.example.gov/arcgis/rest/services/Lots/FeatureServer/0";
publisher[`${LOTS}?f=json`] = {
  name: "Lots", geometryType: "esriGeometryPoint",
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "mbp", type: "esriFieldTypeString" },
    { name: "nbhd", type: "esriFieldTypeString" }, { name: "lat", type: "esriFieldTypeDouble" },
    { name: "long", type: "esriFieldTypeDouble" }, { name: "latdd", type: "esriFieldTypeDouble" },
  ],
};
const LOT_STATS: Record<string, { count: number; nonBlank?: number; min?: number; max?: number }> = {
  mbp: { count: 100, nonBlank: 100 }, nbhd: { count: 100, nonBlank: 0 },
  lat: { count: 100, min: 668000, max: 690000 }, long: { count: 100, min: 940000, max: 960000 }, latdd: { count: 100, min: 41.2, max: 41.35 },
};
let statsRequests = 0;
function lotsQuery(url: string): unknown {
  statsRequests++;
  const q = new URL(url).searchParams;
  if (q.get("returnCountOnly") === "true") {
    const where = q.get("where") ?? "";
    const field = where.match(/^(\w+) IS NOT NULL AND \1 <> ''$/)?.[1];
    return { count: field ? LOT_STATS[field]?.nonBlank ?? 0 : 100 };
  }
  const stats = JSON.parse(q.get("outStatistics") ?? "[]") as Array<{ statisticType: string; onStatisticField: string; outStatisticFieldName: string }>;
  const attributes: Record<string, number | null> = {};
  for (const st of stats) {
    const f = LOT_STATS[st.onStatisticField];
    // ArcGIS servers often upper-case the output names.
    attributes[st.outStatisticFieldName.toUpperCase()] = st.statisticType === "count" ? f?.count ?? 0 : st.statisticType === "min" ? f?.min ?? null : f?.max ?? null;
  }
  return { features: [{ attributes }] };
}

const down = new Set<string>();
const fakeFetch = async (url: string) => {
  if (url.startsWith(`${LOTS}/query?`)) return lotsQuery(url);
  if (down.has(url)) throw new SourceFetchError("the publisher answered HTTP 503");
  if (!(url in publisher)) throw new SourceFetchError(`the publisher answered HTTP 404`);
  return structuredClone(publisher[url]);
};

async function main() {
  // --- pure helpers ----------------------------------------------------------
  check("platform-arcgis", platformOf(`${PARCELS}/query`)?.schemaUrl === `${PARCELS}?f=json`);
  check("platform-socrata-resource", platformOf(SALES)?.schemaUrl === "https://data.example.gov/api/views/abcd-1234.json");
  check("platform-socrata-landing", platformOf("https://data.example.gov/Housing/Sales/abcd-1234")?.platform === "socrata");
  check("platform-unknown", platformOf("https://example.gov/data.csv") === null);
  check("private-v4", ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.1", "100.64.0.1", "::ffff:10.1.1.1"].every(isPrivateAddress));
  check("private-v6", ["::1", "fd00::1", "fe80::1"].every(isPrivateAddress));
  check("wide-network-prefix", wideNetworkPrefix("203.0.113.9") === "203.0" && wideNetworkPrefix("2600:1f18:abcd::1") === "2600:1f18");
  check("public-addresses", !isPrivateAddress("52.1.2.3") && !isPrivateAddress("2600:1f18::1"));
  const httpRefused = await safeFetchJson("http://example.gov/x").then(() => false, (e) => e instanceof SourceFetchError);
  check("fetch-refuses-http", httpRefused);
  const loopRefused = await safeFetchJson("https://127.0.0.1/x").then(() => false, (e) => /not public/.test(e.message));
  check("fetch-refuses-private-literal", loopRefused);
  check("coverage", coverage("US-CT", "US-CT/new-haven") === "broader" && coverage("US", "US-CT") === "broader" &&
    coverage("US-CT/new-haven", "US-CT") === "narrower" && coverage("US-NY", "US-CT") === null && coverage("US-C", "US-CT") === null &&
    coverage("global", "US-CT/new-haven") === "broader" && coverage("US-CT", "global") === "narrower");
  check("join-kinds", fieldJoinKind("pin", { name: "pin", type: "string" }) === "key" &&
    fieldJoinKind("parcelId", undefined) === "key" &&
    fieldJoinKind("identifier", { name: "identifier", type: "string" }) === "key" &&
    fieldJoinKind("address", { name: "address", type: "string" }, true) === "attribute" &&
    fieldJoinKind("address", { name: "address", type: "string" }) === null &&
    fieldJoinKind("zoneCode", { name: "zoneCode", type: "string" }, true) === "key" &&
    fieldJoinKind("landUseCode", { name: "landUseCode", type: "string" }) === null &&
    fieldJoinKind("geometry", { name: "geometry", type: "geometry" }) === "spatial" &&
    fieldJoinKind("mapBlockLot", { name: "mapBlockLot", type: "string" }) === "key" &&
    fieldJoinKind("price", { name: "price", type: "number" }) === null &&
    fieldJoinKind("rank", { name: "rank", type: "enum" }, true) === null &&
    fieldJoinKind("saleDate", { name: "saleDate", type: "date" }) === null);

  // --- an instance with two concepts ------------------------------------------
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-sources-"));
  const instance = await LatticeInstance.create({ dataDir: tmp, fetchJson: fakeFetch });
  const S = instance.sources;
  const T0 = new Date();
  const at = (days: number) => new Date(T0.getTime() + days * DAY);

  const sessionId = "sess-sources-test";
  await callTool(instance, "lattice_discover", { description: "a parcel of land and a sale of it", sessionId });
  const ctx = (await callTool(instance, "lattice_publish_context", {
    slug: "property-test", title: "Property test", definition: "Test fixture context for parcels and their sales, used by the sources smoke test only.",
  })) as { uri: string };
  const publish = async (prefLabel: string, definition: string, kind: string, fields: Array<Record<string, unknown>>) => {
    const r = (await callTool(instance, "lattice_publish_concept", {
      contextUri: ctx.uri, prefLabel, definition, conceptKind: kind,
      broader: [instance.skeletonUri(kind === "event" ? "event" : "location")!],
      closeMatch: ["schema:Place"], coRefersWith: [], coRefersRationale: "Test fixture.",
      structure: { kind: "entity", fields }, sessionId,
    })) as { uri: string };
    if (!r.uri) throw new Error(`fixture publish failed: ${JSON.stringify(r)}`);
    return r.uri;
  };
  const PARCEL = await publish(
    "Tax Parcel", "A piece of land with its own identifier on the assessor's map, the unit that taxes and zoning apply to.", "place",
    [{ name: "pin", type: "string" }, { name: "address", type: "string" }, { name: "town", type: "string" },
     { name: "zoneCode", type: "string" }, { name: "geometry", type: "geometry" }],
  );
  const SALE = await publish(
    "Parcel Sale", "One recorded transfer of a parcel from seller to buyer, with the recording date and the price paid.", "event",
    [{ name: "recordedOn", type: "date" }, { name: "price", type: "number", unit: "USD" }],
  );

  // --- adding sources -----------------------------------------------------------
  const parcels = await S.propose({
    accessUrl: `${PARCELS}/query`, publisher: "State GIS Office", jurisdiction: "US-CT",
    recordDescription: "One parcel polygon with its assessor attributes.", slug: "ct-parcels",
  }, "operator", T0);
  check("curated-source-listed", parcels.status === "listed" && parcels.fieldsVerified === true, JSON.stringify(parcels.evidence));
  check("fields-from-publisher", parcels.fieldCount === 5);

  const badJurisdiction = await rejects(() => S.propose({ accessUrl: SALES, publisher: "x", jurisdiction: "Connecticut", recordDescription: "One sale of a property in the state." }, "net:a", T0));
  check("jurisdiction-format-enforced", badJurisdiction !== null);
  const unreadable = await rejects(() => S.propose({ accessUrl: "https://data.example.gov/resource/zzzz-0000.json", publisher: "x", jurisdiction: "US-CT", recordDescription: "One thing that does not exist at all." }, "net:a", T0));
  check("unreadable-platform-refused", unreadable !== null && /could not read the field list/.test(unreadable.message), unreadable?.message);

  const sales = await S.propose({
    accessUrl: SALES, publisher: "State Policy Office", jurisdiction: "US-CT",
    recordDescription: "One recorded property sale of $2,000 or more.",
  }, "net:anon-1", T0);
  check("anonymous-source-proposed", sales.status === "proposed" && sales.slug === "real-estate-sales", `${sales.slug} ${sales.status}`);
  check("socrata-bookkeeping-dropped", sales.fieldCount === 5);
  const resolvedSales = S.resolve("real-estate-sales")!;
  check("publisher-html-stripped", !/<|>/.test(JSON.stringify(resolvedSales)), resolvedSales.license ?? "");
  check("geometry-detected-socrata", resolvedSales.geometry === "point");

  const hidden = await S.find({ description: "property sales" });
  check("proposed-hidden-from-find", !hidden.results.some((r) => r.slug === "real-estate-sales"));
  const shown = await S.find({ description: "property sales", includeProposed: true });
  check("proposed-shown-on-request", shown.results.some((r) => r.slug === "real-estate-sales" && r.status === "proposed"));

  const again = await S.propose({ accessUrl: SALES.replace("abcd-1234.json", "abcd-1234.json/"), title: "Hijacked", publisher: "x", jurisdiction: "US-NY", recordDescription: "An attempt to rename someone else's source." }, "net:anon-2", T0);
  check("reproposal-corroborates-not-edits", again.slug === "real-estate-sales" && S.resolve("real-estate-sales")!.title === "Real Estate Sales" && !!again.metadataUnchanged);

  const manual = await S.propose({
    accessUrl: "https://assessor.example.gov/Parcel.aspx", platform: "manual", title: "Assessor Property Cards", publisher: "City Assessor",
    jurisdiction: "US-CT/new-haven", recordDescription: "One property record card per parcel, as a web page.",
    fields: [{ name: "pid", type: "integer" }],
  }, "net:anon-3", T0);
  check("manual-proposed", manual.status === "proposed");
  const otherCity = await S.propose({
    accessUrl: "https://assessor.example.gov/Parcel.aspx?town=hamden", platform: "manual", title: "Hamden Property Cards",
    publisher: "Hamden Assessor", jurisdiction: "US-CT/hamden", recordDescription: "One property record card per parcel, as a web page.",
    fields: [{ name: "pid", type: "integer" }],
  }, "operator", T0);
  check("query-string-names-a-manual-dataset", otherCity.slug !== manual.slug, `${otherCity.slug} vs ${manual.slug}`);
  const manualNoFields = await rejects(() => S.propose({ accessUrl: "https://assessor.example.gov/Other.aspx", publisher: "x", jurisdiction: "US-CT", recordDescription: "A web page about a thing." }, "net:a", T0));
  check("manual-needs-fields", manualNoFields !== null);

  const zones = await S.propose({ accessUrl: ZONES, publisher: "City Planning", jurisdiction: "US-CT/new-haven", recordDescription: "One zoning district polygon with its code." }, "operator", T0);
  await S.propose({ accessUrl: OTHER_STATE, publisher: "Other State", jurisdiction: "US-NY", recordDescription: "One property sale in another state." }, "operator", T0);
  check("second-curated", zones.status === "listed");

  // --- mapping -------------------------------------------------------------------
  const typo = await rejects(() => S.map({ source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "parcel_id", to: "pin" }, { from: "Location", to: "adress" }] }, "operator", T0));
  check("map-refuses-wrong-names", !!typo && (typo.details.problems as string[]).length === 2 && /did you mean "Parcel_ID"/.test((typo.details.problems as string[])[0]), JSON.stringify(typo?.details));
  check("map-refusal-records-nothing", S.resolve("ct-parcels")!.fields.every((f) => !("means" in f)));

  const curated = S.map({
    source: "ct-parcels", conceptUri: PARCEL, role: "record",
    fields: [
      { from: "Parcel_ID", to: "pin" }, { from: "Location", to: "address", conversion: "collapse double spaces" },
      { from: "Town_Name", to: "town" },
    ],
  }, "operator", T0);
  check("curated-pairs-listed-now", curated.listedNow === 3, JSON.stringify(curated.pairs));
  const parcelView = S.resolve("ct-parcels")!;
  check("resolve-source-means", parcelView.fields.find((f) => f.name === "Location")?.means?.[0]?.conversion === "collapse double spaces");
  check("resolve-source-unmapped", parcelView.unmappedFields === 2);
  const conceptView = (await callTool(instance, "lattice_resolve", { uri: PARCEL })) as { publicSources: Array<{ slug: string; role: string }> };
  check("concept-points-at-sources", conceptView.publicSources.length === 1 && conceptView.publicSources[0].slug === "ct-parcels");
  const disc = (await callTool(instance, "lattice_discover", { description: "a tax parcel of land" })) as { results: Array<{ uri: string; publicSources?: number }> };
  check("discover-counts-sources", disc.results.find((r) => r.uri === PARCEL)?.publicSources === 1);

  // Anonymous mappings of a proposed source: pending, need corroboration.
  const anonMap = S.map({
    source: "real-estate-sales", conceptUri: PARCEL, role: "reference",
    fields: [{ from: "address", to: "address" }, { from: "town", to: "town" }],
  }, "net:anon-1", T0);
  check("anonymous-pairs-pending", anonMap.pending === 2 && anonMap.listedNow === 0);
  S.map({ source: "real-estate-sales", conceptUri: SALE, fields: [{ from: "saleamount", to: "price" }, { from: "daterecorded", to: "recordedOn" }] }, "net:anon-1", T0);

  // An established app plus independent anonymous networks, after quarantine.
  await callTool(instance, "lattice_register_app", { slug: "parcel-app", name: "Parcel app", unit: "test", owner: "test", status: "experiment", concepts: [] }, ANONYMOUS);
  instance.store.db.prepare("UPDATE apps SET registered_at = ? WHERE slug = ?").run(at(-40).toISOString(), "parcel-app");
  instance.store.logEvent("published", { test: true }, "app:parcel-app");
  for (const src of ["net:anon-2", "net:anon-3", "app:parcel-app"]) {
    await S.propose({ accessUrl: SALES }, src, at(1));
    S.map({ source: "real-estate-sales", conceptUri: PARCEL, role: "reference", fields: [{ from: "address", to: "address" }, { from: "town", to: "town" }] }, src, at(1));
  }
  instance.evidence.rescore(at(3));
  check("quarantine-holds", (await S.find({ description: "sales" })).results.every((r) => r.slug !== "real-estate-sales"));
  instance.evidence.rescore(at(8));
  check("corroborated-source-listed", S.resolve("real-estate-sales")!.status === "listed");
  const salesView = S.resolve("real-estate-sales")!;
  const addressMeaning = salesView.fields.find((f) => f.name === "address")?.means?.[0];
  check("corroborated-pairs-listed", !!addressMeaning && "corroboratedBy" in addressMeaning && addressMeaning.corroboratedBy === 4, JSON.stringify(addressMeaning));
  check("uncorroborated-pairs-not-listed", !salesView.fields.find((f) => f.name === "saleamount")?.means);

  // Manual source: corroboration alone never lists it.
  for (const src of ["net:anon-4", "net:anon-5", "app:parcel-app"]) {
    await S.propose({ accessUrl: "https://assessor.example.gov/Parcel.aspx", platform: "manual", fields: [{ name: "pid", type: "integer" }] }, src, at(1));
  }
  instance.evidence.rescore(at(9));
  check("manual-needs-curator", S.resolve(manual.slug)!.status === "proposed", manual.slug);
  await S.propose({ accessUrl: "https://assessor.example.gov/Parcel.aspx", platform: "manual", fields: [{ name: "pid", type: "integer" }] }, "operator", at(9));
  check("manual-listed-by-curator", S.resolve(manual.slug)!.status === "listed");

  // --- the structural route: anonymous builders alone, publisher-verified only -----------
  const anonSlug = (await S.propose({ accessUrl: "https://gis.example.gov/arcgis/rest/services/Zoning/FeatureServer/2" }, "operator", at(9))).slug;
  const pair = { source: anonSlug, conceptUri: PARCEL, role: "reference", fields: [{ from: "zone_code", to: "zoneCode" }] };
  // Three /24s inside one /16: one campus, so not enough.
  for (const n of ["net:camp-1", "net:camp-2", "net:camp-3"]) S.map(pair, n, at(9), "wide:campus");
  instance.evidence.rescore(at(17));
  const campus = instance.evidence.outcome(`field-mapping|${anonSlug}|zone_code|${PARCEL}|zoneCode`, "right");
  check("one-wide-network-not-enough", campus.status === "pending" && campus.corroboration.widerNetworks === 1 && campus.corroboration.nonAnonymousNeeded === false, JSON.stringify(campus));
  S.map(pair, "net:elsewhere", at(10), "wide:elsewhere");
  instance.evidence.rescore(at(12));
  check("structural-route-waits-for-quarantine", instance.evidence.outcome(campus.claimKey, "right").status === "pending");
  instance.evidence.rescore(at(17));
  check("structural-route-lists-anonymous", instance.evidence.outcome(campus.claimKey, "right").status === "promoted");
  // A hand-supplied source never takes this route.
  const manualPair = { source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "address" }] };
  for (const [n, w] of [["net:m1", "wide:a"], ["net:m2", "wide:b"], ["net:m3", "wide:c"]]) S.map(manualPair, n, at(9), w);
  instance.evidence.rescore(at(17));
  check("manual-source-no-structural-route", instance.evidence.outcome(`field-mapping|${manual.slug}|pid|${PARCEL}|address`, "right").status === "pending");

  // --- the daily cap is for strangers, not curators ----------------------------------
  const many = Array.from({ length: 210 }, (_, i) => ({ claimKey: `source|cap-test-${i}`, subject: `cap-test-${i}`, direction: "right" as const, claim: {} }));
  let capped = false;
  try { instance.evidence.proposeClaims("source", many, "net:cap-test", at(9)); } catch { capped = true; }
  check("daily-cap-stops-strangers", capped);
  let operatorOk = true;
  try { instance.evidence.proposeClaims("source", many, "operator", at(9)); } catch { operatorOk = false; }
  check("daily-cap-spares-curators", operatorOk);
  instance.store.db.prepare("DELETE FROM evidence WHERE claim_key LIKE 'source|cap-test-%'").run();
  instance.store.db.prepare("DELETE FROM claim_state WHERE claim_key LIKE 'source|cap-test-%'").run();

  // --- standards are conformed to, not joined -----------------------------------------
  await S.propose({
    accessUrl: "https://example.org/spec/parcel-standard", platform: "manual", kind: "standard", slug: "parcel-standard",
    title: "Parcel Standard", publisher: "Standards Body", jurisdiction: "global",
    recordDescription: "A published field specification for parcel records.", fields: [{ name: "parcel.pin", type: "ID" }],
  }, "operator", at(9));
  S.map({ source: "parcel-standard", conceptUri: PARCEL, fields: [{ from: "parcel.pin", to: "pin" }] }, "operator", at(9));
  await S.propose({ accessUrl: `${PARCELS}/query`, conformsTo: ["parcel-standard"] }, "operator", at(9));
  const std = S.resolve("parcel-standard")!;
  check("standard-lists-conformers", std.conformedBy?.some((c) => c.slug === "ct-parcels") === true && std.related.length === 0);
  check("standard-not-a-join", !S.resolve("ct-parcels")!.related.some((r) => r.slug === "parcel-standard"));
  check("conforms-to-typo-refused", (await rejects(() => S.propose({ accessUrl: `${PARCELS}/query`, conformsTo: ["parcel-standrad"] }, "operator", at(9)))) !== null);

  // --- relationships ---------------------------------------------------------------
  const related = S.resolve("ct-parcels")!.related;
  const toSales = related.find((r) => r.slug === "real-estate-sales");
  check("attribute-join-found", toSales?.joins[0]?.kind === "attribute" && toSales.joins[0].pairs.length === 2, JSON.stringify(toSales?.joins));
  check("spatial-overlay-found", S.resolve("ct-parcels")!.overlays.some((o) => o.slug === zones.slug));
  check("no-relation-across-states", !related.some((r) => r.slug === "other-state-sales"));
  S.map({ source: zones.slug, conceptUri: PARCEL, role: "reference", fields: [{ from: "zone_code", to: "zoneCode" }] }, "operator", at(9));
  S.map({ source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "Assessed_Total", to: "zoneCode", verdict: "wrong" }] }, "net:anon-9", at(9));

  // A key join: two sources both map onto pin.
  S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin" }] }, "operator", at(9));
  const keyJoin = S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug);
  check("key-join-found", keyJoin?.joins[0]?.kind === "key" && keyJoin.joins[0].pairs[0].a === "Parcel_ID" && keyJoin.joins[0].pairs[0].b === "pid", JSON.stringify(keyJoin));
  check("cross-publisher-key-unchecked", keyJoin?.joins[0]?.unchecked === true && /same identifier system/.test(keyJoin.joins[0].how), keyJoin?.joins[0]?.how);
  // Both say which numbering they use: a checked key join, ranked first.
  S.map({ source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "Parcel_ID", to: "pin", scheme: "vision-pid" }] }, "operator", at(9));
  S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin", scheme: "vision-pid" }] }, "operator", at(9));
  const schemed = S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug)!.joins[0];
  check("same-scheme-key-checked", schemed.kind === "key" && !schemed.unchecked && /^Equal pin/.test(schemed.how), JSON.stringify(schemed));
  check("key-joins-rank-first", S.resolve("ct-parcels")!.related[0].slug === manual.slug);
  check("scheme-shown", S.resolve("ct-parcels")!.fields.find((f) => f.name === "Parcel_ID")?.means?.some((m) => "scheme" in m && m.scheme === "vision-pid") === true);
  // Different numberings never join, however the fields are mapped.
  S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin", scheme: "state-parcel-id" }] }, "operator", at(9));
  check("different-schemes-never-join", !S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug)?.joins.some((j) => j.kind === "key"),
    JSON.stringify(S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug)?.joins));
  S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin", scheme: "vision-pid" }] }, "operator", at(9));
  check("scheme-format-checked", (await rejects(() => S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin", scheme: "Vision PID!" }] }, "operator", at(9)))) !== null);

  // --- jurisdiction search -----------------------------------------------------------
  const nh = await S.find({ jurisdiction: "US-CT/new-haven" });
  check("city-search-includes-state", nh.results.some((r) => r.slug === "ct-parcels" && r.coverage === "broader") && nh.results.some((r) => r.slug === zones.slug && r.coverage === "exact"));
  check("city-search-excludes-other-state", !nh.results.some((r) => r.jurisdiction === "US-NY"));
  const byConcept = await S.find({ conceptUri: PARCEL });
  check("search-by-concept", byConcept.results.length === 5 && byConcept.results.some((r) => r.kind === "standard"), byConcept.results.map((r) => r.slug).join(","));

  // --- disputes ------------------------------------------------------------------------
  for (const src of ["net:d1", "net:d2", "net:d3", "net:d4"]) {
    S.map({ source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "Town_Name", to: "town", verdict: "wrong" }] }, src, at(9));
  }
  instance.evidence.rescore(at(20));
  check("anonymous-disputes-cannot-overturn-curation", !!S.resolve("ct-parcels")!.fields.find((f) => f.name === "Town_Name")?.means);
  const report = S.report();
  check("report-shows-disputes", report.disputes.some((d) => d.sourceField === "Town_Name"));

  // --- unmet searches --------------------------------------------------------------------
  await S.find({ description: "building permits issued by the city of new haven", jurisdiction: "US-CT/new-haven" });
  await S.find({ description: "building permits issued by the city of new haven", jurisdiction: "US-CT/new-haven" });
  await S.find({ description: "secret project i am not ready to share", ephemeral: true });
  const unmet = S.report().unmetSearches;
  check("unmet-searches-grouped", unmet.some((u) => /building permits/.test(u.query ?? "") && u.count === 2), JSON.stringify(unmet.slice(0, 3)));
  check("ephemeral-searches-not-shown", !unmet.some((u) => /secret/.test(u.query ?? "")));

  // --- the publisher changes a field ---------------------------------------------------------
  (publisher[`${PARCELS}?f=json`] as { fields: Array<{ name: string }> }).fields =
    (publisher[`${PARCELS}?f=json`] as { fields: Array<{ name: string }> }).fields.filter((f) => f.name !== "Town_Name");
  const drift = await S.check("ct-parcels", at(21));
  check("check-reports-removed", drift.checked === true && (drift as { removed: string[] }).removed.includes("Town_Name"));
  check("check-reports-broken-mappings", (drift as { mappingsBroken: string[] }).mappingsBroken.includes("Town_Name"));
  check("broken-pair-gone", !S.resolve("ct-parcels")!.fields.some((f) => f.name === "Town_Name"));

  // --- what a builder can rely on ------------------------------------------------------------
  const trusted = S.resolve("ct-parcels")!;
  check("check-recorded", trusted.recentChecks[0]?.changed === true && trusted.recentChecks[0].removed?.includes("Town_Name") === true &&
    trusted.recentChecks.at(-1)?.via === "proposal", JSON.stringify(trusted.recentChecks));
  check("access-tested", trusted.access.status === "tested" && trusted.access.lastOkAt === at(21).toISOString(), JSON.stringify(trusted.access));
  check("publisher-date-arcgis", trusted.publisherUpdatedAt === "2026-09-15T00:00:00.000Z", trusted.publisherUpdatedAt ?? "none");
  check("publisher-date-socrata", S.resolve("real-estate-sales")!.publisherUpdatedAt === "2026-07-01T00:00:00.000Z");
  check("unknowns-listed", trusted.unknowns.includes("cost") && trusted.unknowns.includes("contact") && !trusted.unknowns.includes("license"),
    trusted.unknowns.join(","));
  check("readiness-default", trusted.readiness.level === "not-assessed" && trusted.readiness.reviewBy === null);
  check("manual-is-located", S.resolve(manual.slug)!.access.status === "located");

  const badDate = await rejects(() => S.propose({ accessUrl: PARCELS, reviewBy: "next week" }, "operator", at(21)));
  check("review-date-format", badDate !== null && /YYYY-MM-DD/.test(badDate.message));
  const badLevel = await rejects(() => S.propose({ accessUrl: PARCELS, readiness: "great" }, "operator", at(21)));
  check("readiness-level-checked", badLevel !== null);
  const reserved = await rejects(() => S.propose({ accessUrl: "https://gis.example.gov/x", slug: "health", platform: "manual",
    fields: [{ name: "a" }], title: "Health", publisher: "x", jurisdiction: "US-CT", recordDescription: "One thing of some kind here." }, "operator", at(21)));
  check("health-slug-reserved", reserved !== null && /reserved/.test(reserved.message), reserved?.message);

  await S.propose({
    accessUrl: PARCELS, cost: "Free; no key", contact: "gis@example.gov", readiness: "needs-preparation",
    readinessNote: "Parcel_ID needs the town prefix for statewide joins.", reviewBy: "2026-01-01",
  }, "operator", at(21));
  const assessed = S.resolve("ct-parcels")!;
  check("curator-sets-readiness", assessed.readiness.level === "needs-preparation" && assessed.readiness.reviewOverdue === true && assessed.cost === "Free; no key");
  check("confirmed-facts-leave-unknowns", !assessed.unknowns.includes("cost") && !assessed.unknowns.includes("contact"));
  const stranger = await S.propose({ accessUrl: PARCELS, readiness: "ready" }, "net:anon-9", at(21));
  check("stranger-cannot-set-readiness", !!stranger.metadataUnchanged && S.resolve("ct-parcels")!.readiness.level === "needs-preparation");

  // The publisher goes down, then comes back.
  down.add(`${PARCELS}?f=json`);
  const outage = await S.check("ct-parcels", at(22));
  const failing = S.resolve("ct-parcels")!.access;
  check("failed-check-recorded", outage.checked === false && failing.status === "failing" && failing.failingSince === at(22).toISOString() &&
    /503/.test(failing.reason ?? "") && failing.lastOkAt === at(21).toISOString(), JSON.stringify(failing));
  await S.check("ct-parcels", at(23));
  check("failing-since-first-failure", S.resolve("ct-parcels")!.access.failingSince === at(22).toISOString());
  const report2 = S.report();
  check("report-needs-attention", report2.needsAttention.some((n) => n.slug === "ct-parcels" && n.access === "failing" && n.reviewOverdue === "2026-01-01"),
    JSON.stringify(report2.needsAttention));
  await S.checkDue(new Date(at(23).getTime() + DAY / 2));
  check("failed-not-retried-within-a-day", S.resolve("ct-parcels")!.recentChecks[0].checkedAt === at(23).toISOString());
  down.clear();
  const retry = await S.checkDue(at(25));
  check("failed-retried", S.resolve("ct-parcels")!.access.status === "tested" && retry.failed.length === 0, JSON.stringify(retry));

  // The weekly sweep: every readable source once, then nothing until a week has passed.
  const sweep = await S.checkDue(at(40));
  const verifiedCount = S.health(at(40)).sources.filter((e) => e.access.status !== "located").length;
  check("sweep-checks-due-sources", sweep.checked >= verifiedCount && sweep.remaining === 0 && sweep.failed.length === 0, JSON.stringify(sweep));
  check("sweep-idempotent", (await S.checkDue(at(41))).checked === 0);
  check("sweep-respects-limit", (await S.checkDue(at(50), { limit: 1 })).remaining > 0);
  const later = S.health(at(80));
  check("stale-without-checks", later.sources.find((e) => e.slug === "ct-parcels")?.access.status === "stale", JSON.stringify(later.counts));
  check("health-counts", later.counts.listed === later.sources.length && later.counts.reviewOverdue >= 1);

  // --- point locations ------------------------------------------------------------------------
  check("lat-lng-is-a-point", detectGeometry([{ name: "lat", type: "number" }, { name: "lng", type: "number" }]) === "point");
  check("geojson-point-is-a-point", detectGeometry([{ name: "point", type: "object" }, { name: "point.type", type: "string" }, { name: "point.coordinates", type: "array" }]) === "point");
  check("nested-lat-lng", locationFields([{ name: "location.latitude", type: "double" }, { name: "location.longitude", type: "double" }])?.includes("`location.latitude`") === true);
  check("darwin-core-lat-lng-is-a-point", detectGeometry([{ name: "decimalLatitude", type: "number" }, { name: "decimalLongitude", type: "number" }]) === "point");
  check("unpaired-lat-is-not-a-point", detectGeometry([{ name: "lat", type: "number" }, { name: "zip", type: "string" }]) === null);
  const issues = await S.propose({
    accessUrl: "https://api.example.org/issues?place=new-haven", platform: "manual", slug: "nh-issues", title: "Issues",
    publisher: "Reporting service", jurisdiction: "US-CT/new-haven", recordDescription: "One problem a resident reported, with its location.",
    fields: [{ name: "id", type: "integer" }, { name: "lat", type: "number" }, { name: "lng", type: "number" }],
  }, "operator", at(41));
  const stops = await S.propose({
    accessUrl: "https://api.example.org/stops?place=new-haven", platform: "manual", slug: "nh-stops", title: "Stops",
    publisher: "Transit", jurisdiction: "US-CT/new-haven", recordDescription: "One bus stop with its location in the city.",
    fields: [{ name: "stop_lat", type: "number" }, { name: "stop_lon", type: "number" }, { name: "location.coordinates", type: "array" }],
  }, "operator", at(41));
  const issuesView = S.resolve(issues.slug)!;
  const toParcels = issuesView.related.find((r) => r.slug === "ct-parcels");
  check("point-layer-gets-geometry", issuesView.geometry === "point" && issuesView.locationFields?.startsWith("latitude `lat`, longitude `lng`") === true, issuesView.locationFields ?? "none");
  check("point-in-polygon-is-a-join", toParcels?.joins[0]?.method === "point-in-polygon" && /Point in polygon/.test(toParcels.joins[0].how) &&
    toParcels.joins[0].how.includes("`lat`"), JSON.stringify(toParcels?.joins));
  check("polygon-side-lists-point-layer", S.resolve("ct-parcels")!.related.some((r) => r.slug === issues.slug));
  check("points-do-not-overlay-points", !issuesView.related.some((r) => r.slug === stops.slug) && !issuesView.overlays.some((o) => o.slug === stops.slug));
  const pip = S.resolve("ct-parcels")!.related.find((r) => r.slug === issues.slug)?.joins[0];
  check("listing-by-place-is-complete-and-local-first", (() => {
    const l = S.listAll("US-CT/new-haven");
    const firstBroader = l.findIndex((x) => x.jurisdiction !== "US-CT/new-haven");
    return l.length >= 3 && firstBroader > 0 && l.slice(firstBroader).every((x) => x.jurisdiction !== "US-CT/new-haven") &&
      l.some((x) => x.jurisdiction === "US-CT") && !l.some((x) => x.jurisdiction === "US-NY");
  })(), S.listAll("US-CT/new-haven").map((x) => x.jurisdiction).join(","));
  check("point-in-polygon-names-fields-for-api-points", /`lat`/.test(pip?.how ?? ""), pip?.how);
  const parcelsPage = renderSourcePage(S.resolve("ct-parcels")!, "x");
  check("point-layers-listed-compactly", parcelsPage.includes("## Point layers that fall in these areas") && !parcelsPage.includes(`### Issues (\`${issues.slug}\``), parcelsPage.slice(parcelsPage.indexOf("## Point"), parcelsPage.indexOf("## Point") + 300));
  const station = await S.propose({
    accessUrl: "https://api.example.org/station?id=1", platform: "manual", slug: "nh-station", title: "Station", publisher: "Agency",
    jurisdiction: "US-CT/new-haven", recordDescription: "One reading at a monitoring station in the city.", fields: [{ name: "where", type: "geometry" }],
  }, "operator", at(41));
  check("generic-geometry-is-not-an-area", !S.resolve(issues.slug)!.related.some((r) => r.slug === station.slug && r.joins.some((j) => j.method === "point-in-polygon")));
  check("polygons-still-overlay", S.resolve("ct-parcels")!.overlays.some((o) => o.slug === zones.slug));

  // --- what builders found -------------------------------------------------------------------
  const F = S.findings;
  const anonNote = F.note({ source: "ct-parcels", topic: "field", field: "Location", assertion: "mostly-empty", text: "Location is blank for most condo rows." }, "net:n1", at(42), "w1");
  check("anonymous-note-pending", anonNote.status === "pending" && anonNote.key === "source-note|ct-parcels|field|Location|mostly-empty", JSON.stringify(anonNote));
  const sameFinding = F.note({ source: "ct-parcels", topic: "field", field: "Location", assertion: "mostly-empty", text: "Most rows have no Location value at all." }, "net:n2", at(42), "w2");
  check("same-field-fact-corroborates-whatever-the-words", sameFinding.key === anonNote.key && sameFinding.independentSources === 2);
  F.note({ source: "ct-parcels", agree: anonNote.key }, "net:n3", at(42), "w3");
  instance.evidence.rescore(at(50));
  check("anonymous-notes-need-a-keyed-source", instance.evidence.outcome(anonNote.key, "right").status === "pending");
  check("note-field-checked", (() => { try { F.note({ source: "ct-parcels", topic: "field", field: "location", assertion: "always-empty", text: "Field is always empty here." }, "net:n1", at(42), "w1"); return false; } catch (e) { return /names are exact/.test((e as Error).message); } })());
  check("note-assertion-required", (() => { try { F.note({ source: "ct-parcels", topic: "field", field: "Location", text: "Something about the field." }, "net:n1", at(42), "w1"); return false; } catch (e) { return /assertion/.test((e as Error).message); } })());
  const access = F.note({ source: "ct-parcels", topic: "access", text: "Returns 1,000 rows per request; page with resultOffset." }, "operator", at(42), "operator");
  check("curated-note-listed", access.status === "promoted" && S.resolve("ct-parcels")!.notes.some((n) => n.key === access.key && n.curatedBy === "operator"));
  const agreeAccess = F.note({ source: "ct-parcels", agree: access.key }, "net:n4", at(42), "w4");
  check("agree-by-key", agreeAccess.key === access.key && agreeAccess.independentSources === 2, JSON.stringify(agreeAccess));
  check("disagreement-needs-other-source", (() => { try { F.note({ source: "ct-parcels", topic: "disagreement", otherSource: "nope", text: "These sources disagree on values." }, "operator", at(42), "operator"); return false; } catch { return true; } })());
  const disagree = F.note({ source: "ct-parcels", topic: "disagreement", otherSource: "real-estate-sales", text: "Sale prices differ by a few thousand; prefer the state file." }, "operator", at(42), "operator");
  check("disagreement-listed", S.resolve("ct-parcels")!.notes.some((n) => n.key === disagree.key && n.otherSource === "real-estate-sales"), JSON.stringify(disagree) + JSON.stringify(S.resolve("ct-parcels")!.notes.map((n) => n.key)));
  F.note({ source: "ct-parcels", agree: disagree.key, verdict: "wrong" }, "operator", at(42), "operator");
  check("disputed-note-drops-out", !S.resolve("ct-parcels")!.notes.some((n) => n.key === disagree.key));
  check("report-lists-pending-notes", S.report().pendingNotes.some((n) => n.key === anonNote.key));

  // Joins builders ran.
  const keyJoinReport = F.reportJoin({ a: manual.slug, b: "ct-parcels", fieldsA: ["pid"], fieldsB: ["Parcel_ID"], tried: 200, matched: 188 }, "operator", at(42), "operator");
  check("join-report-canonical", keyJoinReport.key === (manual.slug < "ct-parcels" ? `join-report|${manual.slug}|ct-parcels|pid=Parcel_ID` : `join-report|ct-parcels|${manual.slug}|Parcel_ID=pid`), keyJoinReport.key);
  const offered = S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug)!.joins.find((j) => j.kind === "key") as { tested?: { status: string; matchRate: number } | null };
  check("offered-join-shows-measurement", offered?.tested?.status === "works" && offered.tested.matchRate === 0.94, JSON.stringify(offered?.tested));
  F.reportJoin({ a: "ct-parcels", b: zones.slug, fieldsA: ["Parcel_ID"], fieldsB: ["zone_code"], tried: 50, matched: 2 }, "operator", at(42), "operator");
  const extra = S.resolve("ct-parcels")!.builderJoins.find((j) => j.other === zones.slug);
  check("unoffered-join-listed-as-builder-found", extra?.status === "fails" && extra.matchRate === 0.04 && extra.fields.here[0] === "Parcel_ID", JSON.stringify(extra));
  const transformed = F.reportJoin({ a: "ct-parcels", b: zones.slug, fieldsA: ["Location"], fieldsB: ["zone_code"], tried: 10, matched: 9, transform: "strip the URL prefix from occurrenceID" }, "operator", at(42), "operator");
  const partial = F.reportJoin({ a: "ct-parcels", b: zones.slug, method: "point-in-polygon", tried: 200, matched: 58, partialCoverage: true }, "operator", at(42), "operator");
  check("partial-coverage-join-works", partial.reported === "works" && partial.evidence?.partialCoverage === true && partial.evidence.status === "works", JSON.stringify(partial));
  check("join-transform-recorded", transformed.evidence?.transforms[0] === "strip the URL prefix from occurrenceID");
  check("transformed-join-has-own-key", /\|t:[0-9a-f]{12}$/.test(transformed.key), transformed.key);
  const anonJoin = F.reportJoin({ a: "ct-parcels", b: "real-estate-sales", method: "point-in-polygon", tried: 40, matched: 3 }, "net:j1", at(42), "wj1");
  check("anonymous-join-report-unconfirmed", anonJoin.status === "pending" && anonJoin.evidence?.status === "unconfirmed" && anonJoin.reported === "fails");
  check("join-counts-checked", (() => { try { F.reportJoin({ a: "ct-parcels", b: zones.slug, fieldsA: ["Parcel_ID"], fieldsB: ["zone_code"], tried: 5, matched: 9 }, "net:j1", at(42), "wj1"); return false; } catch { return true; } })());
  check("join-fields-checked", (() => { try { F.reportJoin({ a: "ct-parcels", b: zones.slug, fieldsA: ["parcel_id"], fieldsB: ["zone_code"], tried: 5, matched: 1 }, "net:j1", at(42), "wj1"); return false; } catch (e) { return /names are exact/.test((e as Error).message); } })());
  const findingsPage = renderSourcePage(S.resolve("ct-parcels")!, "schemalattice.test");
  check("page-shows-builder-findings", findingsPage.includes("## What builders found") && findingsPage.includes("## Joins builders found") &&
    findingsPage.includes("_Builders ran it: works, median match 94%"));

  // --- query notes ----------------------------------------------------------------------------
  await S.propose({ accessUrl: PARCELS, queryNotes: { paging: "1,000 per request; page with resultOffset.", defaults: "Every row; no default filter." } }, "operator", at(43));
  await S.propose({ accessUrl: PARCELS, queryNotes: { defaults: null, recordLink: "https://example.gov/parcel/{Parcel_ID}" } }, "operator", at(43));
  const qn = S.resolve("ct-parcels")!.queryNotes;
  check("query-notes-merge-and-clear", qn.paging?.startsWith("1,000") === true && qn.recordLink?.includes("{Parcel_ID}") === true && !qn.defaults, JSON.stringify(qn));
  check("query-notes-keys-checked", (await rejects(() => S.propose({ accessUrl: PARCELS, queryNotes: { speed: "fast" } }, "operator", at(43)))) !== null);
  check("query-notes-on-page", renderSourcePage(S.resolve("ct-parcels")!, "x").includes("- **Link to a record:** https://example.gov/parcel/{Parcel_ID}"));

  // --- a curator cannot overwrite a different source by URL ------------------------------------
  const clash = await rejects(() => S.propose({ accessUrl: PARCELS, slug: "parcels-copy", publisher: "x", jurisdiction: "US-CT", recordDescription: "A copy of the parcels." }, "operator", at(43)));
  check("curator-same-url-other-slug-refused", !!clash && /already the source "ct-parcels"/.test(clash.message), clash?.message);
  check("stranger-same-url-other-slug-corroborates", (await S.propose({ accessUrl: PARCELS, slug: "parcels-copy" }, "net:x9", at(43))).slug === "ct-parcels");
  const page1 = await S.propose({ accessUrl: "https://spec.example.org/standard/#get", platform: "manual", slug: "spec-get", title: "Spec GET", kind: "standard",
    publisher: "Spec body", jurisdiction: "global", recordDescription: "One request read from the standard's API.", fields: [{ name: "a", type: "string" }] }, "operator", at(43));
  const page2 = await S.propose({ accessUrl: "https://spec.example.org/standard/#post", platform: "manual", slug: "spec-post", title: "Spec POST", kind: "standard",
    publisher: "Spec body", jurisdiction: "global", recordDescription: "One request sent to the standard's API.", fields: [{ name: "b", type: "string" }] }, "operator", at(43));
  check("fragment-names-a-different-source", page1.slug === "spec-get" && page2.slug === "spec-post" && S.resolve("spec-get")!.fields[0].name === "a");

  // --- submit endpoints -------------------------------------------------------------------------
  const post = await S.propose({
    accessUrl: "https://api.example.org/open311/requests.json", platform: "manual", slug: "nh-311-post", title: "311 create request",
    publisher: "City", jurisdiction: "US-CT/new-haven", recordDescription: "One new service request a resident sends to the city.", direction: "submit",
    fields: [{ name: "service_code", type: "string" }, { name: "lat", type: "number" }, { name: "long", type: "number" }],
  }, "operator", at(43));
  const postView = S.resolve(post.slug)!;
  check("submit-direction-recorded", postView.direction === "submit" && postView.exampleQuery === null);
  check("submit-page-warns", renderSourcePage(postView, "x").includes("This is a submit endpoint"));
  await S.propose({ accessUrl: "https://api.example.org/open311/requests.json", platform: "manual", fieldClassifications: { lat: "personal-location", long: "personal-location" },
    fields: [{ name: "service_code", type: "string" }, { name: "lat", type: "number" }, { name: "long", type: "number" }] }, "operator", at(43));
  const classed = S.resolve(post.slug)!.fields.find((f) => f.name === "lat");
  check("field-classification-stated", classed?.classification === "personal-location" && classed.classifiedBy === "source", JSON.stringify(classed));
  check("field-classification-validated", (await rejects(() => S.propose({ accessUrl: "https://api.example.org/open311/requests.json", platform: "manual",
    fieldClassifications: { lat: "secret-ish" }, fields: [{ name: "service_code", type: "string" }, { name: "lat", type: "number" }, { name: "long", type: "number" }] }, "operator", at(43)))) !== null);
  F.note({ source: "ct-parcels", topic: "field", field: "Location", assertion: "personal-data", text: "Owner home addresses appear here for some rows." }, "operator", at(43), "operator");
  const reportedField = S.resolve("ct-parcels")!.fields.find((f) => f.name === "Location");
  check("personal-data-note-classifies", reportedField?.classifiedBy === "builders", JSON.stringify(reportedField));
  check("page-lists-sensitive-fields", renderSourcePage(S.resolve(post.slug)!, "x").includes("## Personal and sensitive fields"));
  check("direction-checked", (await rejects(() => S.propose({ accessUrl: PARCELS, direction: "write" }, "operator", at(43)))) !== null);

  // --- field profiles --------------------------------------------------------------------------
  await S.propose({ accessUrl: LOTS, slug: "nh-lots", publisher: "City", jurisdiction: "US-CT/new-haven", recordDescription: "One city-managed lot with its parcel number." }, "operator", at(43));
  const before = statsRequests;
  const lotCheck = await S.check("nh-lots", at(43));
  const lots = S.resolve("nh-lots")!;
  const warn = (field: string, problem: string) => lots.fieldWarnings.some((w) => w.field === field && w.problem === problem);
  check("profile-runs-in-check", lotCheck.checked === true && lots.profiledAt === at(43).toISOString() && statsRequests - before >= 3, JSON.stringify(lots.recentChecks[0]));
  check("profile-catches-blank-strings", warn("nbhd", "always-empty") && lots.fields.find((f) => f.name === "nbhd")?.filled === 0, JSON.stringify(lots.fieldWarnings));
  check("profile-catches-state-plane", warn("lat", "not-degrees") && warn("long", "not-degrees") && !warn("latdd", "not-degrees"));
  check("profile-filled-shown", lots.fields.find((f) => f.name === "mbp")?.filled === 1);
  check("profile-not-for-manual", (await S.profile(manual.slug, at(43))).error !== undefined);
  for (const [n, w] of [["net:p1", "wp1"], ["net:p2", "wp1"], ["net:p3", "wp2"]]) {
    F.note({ source: "nh-lots", topic: "field", field: "nbhd", assertion: "always-empty", text: "nbhd is blank on every row I fetched." }, n, at(43), w);
  }
  instance.evidence.rescore(at(51));
  const confirmed = S.resolve("nh-lots")!.notes.find((n) => n.field === "nbhd");
  check("profile-confirmed-note-lists-anonymously", confirmed?.confirmedByProfile === true && confirmed.corroboratedBy === 3, JSON.stringify(S.resolve("nh-lots")!.notes));
  F.note({ source: "nh-lots", topic: "field", field: "mbp", assertion: "always-empty", text: "mbp seems always blank to me." }, "net:p1", at(43), "wp1");
  F.note({ source: "nh-lots", topic: "field", field: "mbp", assertion: "always-empty", text: "mbp seems always blank to me." }, "net:p2", at(43), "wp1");
  F.note({ source: "nh-lots", topic: "field", field: "mbp", assertion: "always-empty", text: "mbp seems always blank to me." }, "net:p3", at(43), "wp2");
  instance.evidence.rescore(at(51));
  check("profile-contradicted-note-stays-pending", !S.resolve("nh-lots")!.notes.some((n) => n.field === "mbp"));
  const lotsPage = renderSourcePage(S.resolve("nh-lots")!, "schemalattice.test");
  check("page-shows-profile", lotsPage.includes("| Filled |") && lotsPage.includes("`nbhd` always empty") && lotsPage.includes("`lat` not degrees"));

  // --- a concept gets a new version ---------------------------------------------------------
  const PARCEL2 = ((await callTool(instance, "lattice_publish_concept", {
    contextUri: ctx.uri, prefLabel: "Tax Parcel", conceptSlug: "tax-parcel", previousVersion: PARCEL,
    definition: "A piece of land with its own identifier on the assessor's map, the unit that taxes and zoning apply to, with its land area.",
    conceptKind: "place", broader: [instance.skeletonUri("location")!], closeMatch: ["schema:Place"], coRefersWith: [], coRefersRationale: "Test fixture.",
    structure: { kind: "entity", fields: [{ name: "pin", type: "string" }, { name: "address", type: "string" }, { name: "town", type: "string" },
      { name: "zoneCode", type: "string" }, { name: "geometry", type: "geometry" }, { name: "landArea", type: "number" }] }, sessionId,
  })) as { uri: string }).uri;
  check("fixture-v2-published", !!PARCEL2 && PARCEL2 !== PARCEL, String(PARCEL2));
  await S.map({ source: "ct-parcels", conceptUri: PARCEL2, fields: [{ from: "Parcel_ID", to: "pin" }, { from: "Location", to: "address" }] }, "operator", at(42));
  const carried = S.resolve("ct-parcels")!.carries.filter((c) => c.prefLabel === "Tax Parcel");
  check("remapped-source-shows-new-version-only", carried.length === 1 && carried[0].conceptUri === PARCEL2, JSON.stringify(carried));
  check("unmoved-source-keeps-old-version", S.resolve(manual.slug)!.carries.some((c) => c.conceptUri === PARCEL));
  check("join-survives-across-versions", S.resolve("ct-parcels")!.related.some((r) => r.slug === manual.slug && r.joins.some((j) => j.kind === "key")),
    JSON.stringify(S.resolve("ct-parcels")!.related.map((r) => [r.slug, r.joins.map((j) => j.kind)])));
  check("old-pairs-stay-in-ledger", instance.evidence.outcome(`field-mapping|ct-parcels|Parcel_ID|${PARCEL}|pin`, "right").status === "promoted");

  // --- place profile ---------------------------------------------------------------------------
  const prof = S.placeProfile({ latitude: 41.31, longitude: -72.92, jurisdiction: "US-CT/new-haven" });
  const parcelLayer = prof.layers.find((l) => l.slug === "ct-parcels");
  check("place-profile-lists-covering-layers", !!parcelLayer && prof.layers.some((l) => l.slug === zones.slug) && !prof.layers.some((l) => l.slug === station.slug),
    prof.layers.map((l) => l.slug).join(","));
  check("place-profile-query-is-point-intersect", !!parcelLayer?.query && parcelLayer.query.includes("geometry=-72.92%2C41.31") && parcelLayer.query.includes("returnGeometry=false") &&
    parcelLayer.query.includes("outFields=*") && !parcelLayer.query.includes("distance="), parcelLayer?.query ?? "");
  check("place-profile-area-has-nearby-query", !!parcelLayer && "nearbyQuery" in parcelLayer && /distance=250&units=esriSRUnit_Meter/.test(String(parcelLayer.nearbyQuery)));
  check("place-profile-warns-empty-is-not-nowhere", /not nothing nearby/.test(prof.notice));
  check("place-profile-says-what-fields-mean", Object.values(parcelLayer?.fields ?? {}).some((m) => m.includes("Tax Parcel")));
  check("place-profile-local-first", prof.layers[0].coverage === "exact");
  check("place-profile-rejects-bad-point", (await rejects(() => S.placeProfile({ latitude: 668642, longitude: 947648, jurisdiction: "US-CT" }))) !== null);

  // --- the markdown page ---------------------------------------------------------------------
  const page = renderSourcePage(S.resolve("ct-parcels")!, "schemalattice.test");
  check("page-has-endpoint", page.includes("/FeatureServer/0/query?where=1%3D1"));
  check("page-has-meanings", page.includes("| `Parcel_ID` |") && page.includes("Tax Parcel.pin"));
  check("page-has-joins", page.includes("**key join via Tax Parcel.**"));
  check("page-says-what-to-rely-on", page.includes("## What you can rely on") && page.includes("**Cost of access:** Free; no key") &&
    page.includes("**Build readiness:** needs preparation") && page.includes("review overdue since 2026-01-01"));
  const salesPage = renderSourcePage(S.resolve("real-estate-sales")!, "schemalattice.test");
  check("page-marks-unconfirmed", salesPage.includes("**Contact for corrections:** _not confirmed_"));

  // --- over HTTP, as a stranger -----------------------------------------------------------------
  const http = await startHttpServer(instance, { dataDir: tmp, port: 0, host: "127.0.0.1", apiKey: "operator-secret" });
  const index = await fetch(`${http.url}/sources`);
  const indexText = await index.text();
  check("http-sources-index", index.status === 200 && /## US-CT\/new-haven/.test(indexText) && indexText.includes("/sources/ct-parcels"), indexText.slice(0, 200));
  const pageRes = await fetch(`${http.url}/sources/ct-parcels`);
  check("http-source-page", pageRes.status === 200 && (pageRes.headers.get("content-type") ?? "").startsWith("text/markdown") && (await pageRes.text()).includes("## Related sources"));
  const searched = await (await fetch(`${http.url}/sources?q=property+sales&jurisdiction=US-CT`)).text();
  check("http-sources-search", searched.includes("real-estate-sales"), searched.slice(0, 300));
  check("http-unknown-source-404", (await fetch(`${http.url}/sources/nope`)).status === 404);
  const healthRes = await fetch(`${http.url}/sources/health`);
  const healthText = await healthRes.text();
  check("http-sources-health", healthRes.status === 200 && healthText.includes("## All sources") && healthText.includes("/sources/ct-parcels"),
    healthText.slice(0, 300));
  const atlas = (await (await fetch(`${http.url}/atlas.json`)).json()) as {
    concepts: Array<{ uri: string; x: number; y: number; publicSources: number }>; sources: Array<{ slug: string }>;
  };
  check("atlas-places-concepts", atlas.concepts.length >= 16 && atlas.concepts.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
  check("atlas-excludes-governance", !atlas.concepts.some((c) => c.uri.includes("/c/governance/")));
  check("atlas-shows-sources", atlas.sources.some((s) => s.slug === "ct-parcels") && atlas.concepts.some((c) => c.uri === PARCEL2 && c.publicSources > 0));
  const atlasPageRes = await fetch(`${http.url}/atlas`);
  const atlasHtml = await atlasPageRes.text();
  check("atlas-page", atlasPageRes.status === 200 && atlasHtml.includes("/atlas.json") && atlasHtml.includes('id="lens"'));
  const atlasAny = atlas as unknown as { concepts: Array<{ pc: number[]; rootAncestor: string | null }>; layoutQuality: { meaning: number; pca: number } };
  check("atlas-views-data", atlasAny.concepts.every((c) => c.pc.length >= 2 && c.pc.every(Number.isFinite) && c.rootAncestor) &&
    atlasAny.layoutQuality.meaning > 0, JSON.stringify(atlasAny.layoutQuality));
  check("atlas-lists-apps", Array.isArray((atlas as unknown as { apps: unknown }).apps));
  const anonPropose = await fetch(`${http.url}/api/tools/lattice_propose_source`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessUrl: OTHER_STATE.replace("wxyz-9876", "wxyz-9876") }),
  });
  const anonBody = (await anonPropose.json()) as { status?: string; evidence?: { status: string } };
  check("http-propose-open-to-anonymous", anonPropose.status === 200 && anonBody.evidence?.status === "promoted", JSON.stringify(anonBody).slice(0, 200));
  const anonNew = await fetch(`${http.url}/api/tools/lattice_propose_source`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessUrl: "https://gis.example.gov/arcgis/rest/services/Zoning/FeatureServer/2", jurisdiction: "US-CT" }),
  });
  check("http-anonymous-is-not-curator", ((await anonNew.json()) as { metadataUnchanged?: string }).metadataUnchanged !== undefined);
  await http.close();

  // --- tools and gates ------------------------------------------------------------------------
  const viaTool = (await callTool(instance, "lattice_resolve_source", { slug: "nope" })) as unknown;
  check("tool-not-found", isToolError(viaTool));
  const badMap = (await callTool(instance, "lattice_map_source", { source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "nope", to: "pin" }] }, ANONYMOUS, { clientAddress: "203.0.113.9" })) as unknown;
  check("tool-refusal-is-invalid-parameter", isToolError(badMap) && badMap.error.code === "invalid-parameter");
  const anonWithdraw = (await callTool(instance, "lattice_evidence_admin", { action: "withdraw-source", target: "ct-parcels" }, ANONYMOUS)) as unknown;
  check("withdraw-is-operator-only", isToolError(anonWithdraw));
  await callTool(instance, "lattice_evidence_admin", { action: "withdraw-source", target: "ct-parcels", reason: "test" }, OPERATOR);
  check("withdrawn-out-of-find", !(await S.find({ jurisdiction: "US-CT" })).results.some((r) => r.slug === "ct-parcels"));
  check("withdrawn-out-of-concept", !((await callTool(instance, "lattice_resolve", { uri: PARCEL })) as { publicSources: Array<{ slug: string }> }).publicSources.some((s) => s.slug === "ct-parcels"));
  const reproposed = await rejects(() => S.propose({ accessUrl: PARCELS }, "net:anon-1", at(22)));
  check("withdrawn-not-reproposable", reproposed !== null);
  const switched = (await callTool(instance, "lattice_evidence_admin", { action: "switch", target: "field-mapping.accept", on: false }, OPERATOR)) as { switches: { accept: boolean } };
  const paused = await rejects(() => S.map({ source: zones.slug, conceptUri: PARCEL, fields: [{ from: "zone_code", to: "zoneCode" }] }, "net:x", at(22)));
  check("per-kind-switch", switched.switches.accept === false && paused !== null && /paused/.test(paused.message));

  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
