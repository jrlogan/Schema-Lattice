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
import { SourceRejected, coverage, fieldJoinKind } from "../src/sources/sources.ts";
import { isPrivateAddress, platformOf, safeFetchJson, SourceFetchError } from "../src/sources/fetch.ts";
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
const fakeFetch = async (url: string) => {
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
  check("public-addresses", !isPrivateAddress("52.1.2.3") && !isPrivateAddress("2600:1f18::1"));
  const httpRefused = await safeFetchJson("http://example.gov/x").then(() => false, (e) => e instanceof SourceFetchError);
  check("fetch-refuses-http", httpRefused);
  const loopRefused = await safeFetchJson("https://127.0.0.1/x").then(() => false, (e) => /not public/.test(e.message));
  check("fetch-refuses-private-literal", loopRefused);
  check("coverage", coverage("US-CT", "US-CT/new-haven") === "broader" && coverage("US", "US-CT") === "broader" &&
    coverage("US-CT/new-haven", "US-CT") === "narrower" && coverage("US-NY", "US-CT") === null && coverage("US-C", "US-CT") === null);
  check("join-kinds", fieldJoinKind("pin", { name: "pin", type: "string" }) === "key" &&
    fieldJoinKind("parcelId", undefined) === "key" &&
    fieldJoinKind("address", { name: "address", type: "string" }, true) === "attribute" &&
    fieldJoinKind("address", { name: "address", type: "string" }) === null &&
    fieldJoinKind("zoneCode", { name: "zoneCode", type: "string" }, true) === "key" &&
    fieldJoinKind("landUseCode", { name: "landUseCode", type: "string" }) === null &&
    fieldJoinKind("geometry", { name: "geometry", type: "geometry" }) === "spatial" &&
    fieldJoinKind("mapBlockLot", { name: "mapBlockLot", type: "string" }) === "key" &&
    fieldJoinKind("price", { name: "price", type: "number" }) === null &&
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

  // --- relationships ---------------------------------------------------------------
  const related = S.resolve("ct-parcels")!.related;
  const toSales = related.find((r) => r.slug === "real-estate-sales");
  check("attribute-join-found", toSales?.joins[0]?.kind === "attribute" && toSales.joins[0].pairs.length === 2, JSON.stringify(toSales?.joins));
  check("spatial-overlay-found", related.find((r) => r.slug === zones.slug)?.joins.some((j) => j.kind === "spatial") === true);
  check("no-relation-across-states", !related.some((r) => r.slug === "other-state-sales"));
  S.map({ source: zones.slug, conceptUri: PARCEL, role: "reference", fields: [{ from: "zone_code", to: "zoneCode" }] }, "operator", at(9));
  S.map({ source: "ct-parcels", conceptUri: PARCEL, fields: [{ from: "Assessed_Total", to: "zoneCode", verdict: "wrong" }] }, "net:anon-9", at(9));

  // A key join: two sources both map onto pin.
  S.map({ source: manual.slug, conceptUri: PARCEL, fields: [{ from: "pid", to: "pin" }] }, "operator", at(9));
  const keyJoin = S.resolve("ct-parcels")!.related.find((r) => r.slug === manual.slug);
  check("key-join-found", keyJoin?.joins[0]?.kind === "key" && keyJoin.joins[0].pairs[0].a === "Parcel_ID" && keyJoin.joins[0].pairs[0].b === "pid", JSON.stringify(keyJoin));
  check("key-joins-rank-first", S.resolve("ct-parcels")!.related[0].slug === manual.slug);

  // --- jurisdiction search -----------------------------------------------------------
  const nh = await S.find({ jurisdiction: "US-CT/new-haven" });
  check("city-search-includes-state", nh.results.some((r) => r.slug === "ct-parcels" && r.coverage === "broader") && nh.results.some((r) => r.slug === zones.slug && r.coverage === "exact"));
  check("city-search-excludes-other-state", !nh.results.some((r) => r.jurisdiction === "US-NY"));
  const byConcept = await S.find({ conceptUri: PARCEL });
  check("search-by-concept", byConcept.results.length === 4, byConcept.results.map((r) => r.slug).join(","));

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

  // --- the markdown page ---------------------------------------------------------------------
  const page = renderSourcePage(S.resolve("ct-parcels")!, "schemalattice.test");
  check("page-has-endpoint", page.includes("/FeatureServer/0/query?where=1%3D1"));
  check("page-has-meanings", page.includes("| `Parcel_ID` |") && page.includes("Tax Parcel.pin"));
  check("page-has-joins", page.includes("**key join via Tax Parcel.**"));

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
  const atlas = (await (await fetch(`${http.url}/atlas.json`)).json()) as {
    concepts: Array<{ uri: string; x: number; y: number; publicSources: number }>; sources: Array<{ slug: string }>;
  };
  check("atlas-places-concepts", atlas.concepts.length >= 16 && atlas.concepts.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
  check("atlas-excludes-governance", !atlas.concepts.some((c) => c.uri.includes("/c/governance/")));
  check("atlas-shows-sources", atlas.sources.some((s) => s.slug === "ct-parcels") && atlas.concepts.some((c) => c.uri === PARCEL && c.publicSources > 0));
  const atlasPageRes = await fetch(`${http.url}/atlas`);
  check("atlas-page", atlasPageRes.status === 200 && (await atlasPageRes.text()).includes("/atlas.json"));
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
