// Seed, round three: published data standards as `kind: "standard"` sources
// (NEW-HAVEN-SURVEY.md, "Standards as sources"). Field lists in standards.json
// were parsed from each official specification on 2026-10-13; the source URL
// is each entry's accessUrl. Open311 is also mapped onto the 311 concepts, so
// any Open311 city lines up with them. Run with seed-sources.ts --seed standards.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MappingSeed, SourceSeed } from "./property-seed.ts";

export const SOURCES: SourceSeed[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "standards.json"), "utf8"),
);

const ISSUE_REPORT = "https://schemalattice.com/c/civic-issue-reporting/issue-report@6ab5cb338457";
const REPORT_CATEGORY = "https://schemalattice.com/c/civic-issue-reporting/report-category@b3bdd478944f";
const CIVIC_BODY = "https://schemalattice.com/c/civic-issue-reporting/civic-body@ef79d8c6a015";

export const MAPPINGS: Array<Omit<MappingSeed, "concept"> & { conceptUri: string }> = [
  {
    source: "open311-georeport-v2", conceptUri: REPORT_CATEGORY, role: "record",
    fields: [{ from: "services.service_name", to: "category" }],
  },
  {
    source: "open311-georeport-v2", conceptUri: ISSUE_REPORT, role: "record",
    fields: [
      { from: "requests.service_name", to: "category" },
      { from: "requests.description", to: "detail" },
      { from: "requests.lat", to: "latitude" },
      { from: "requests.long", to: "longitude" },
      { from: "requests.zipcode", to: "postcode" },
      { from: "requests.status", to: "state", conversion: "open or closed; finer states live in status_notes" },
      { from: "requests.requested_datetime", to: "created" },
      { from: "requests.media_url", to: "photo" },
    ],
  },
  { source: "open311-georeport-v2", conceptUri: CIVIC_BODY, role: "reference", fields: [{ from: "requests.agency_responsible", to: "name" }] },
];
