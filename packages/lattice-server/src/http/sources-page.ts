// Public data sources as paste-ready markdown (specs/public-sources.md § Builder packs).
//
// The page a builder would otherwise write by hand before touching a public
// dataset: where it is, how to query it, what every column means in catalog
// terms, and how it lines up with the other sources the catalog knows about.

import type { LatticeInstance } from "../server/instance.ts";
import { UNTRUSTED_NOTICE } from "../sources/sources.ts";

type Resolved = NonNullable<ReturnType<LatticeInstance["sources"]["resolve"]>>;

/** Keep publisher text from breaking a table row or opening a link. */
function cell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim();
}

function line(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim();
}

export function renderSourcePage(s: Resolved, host: string): string {
  const out: string[] = [];
  out.push(`# ${line(s.title)}`, "");
  out.push(`> ${line(s.recordDescription)}`, "");
  out.push(
    `**Publisher:** ${line(s.publisher)} · **Jurisdiction:** ${s.jurisdiction} · **Status:** ${s.status}` +
      (s.license ? ` · **License:** ${line(s.license)}` : "") +
      (s.updateFrequency ? ` · **Updated:** ${line(s.updateFrequency)}` : ""),
    "",
  );
  if (s.status !== "listed") {
    out.push(
      s.status === "withdrawn"
        ? `**Withdrawn by the operator:** ${line(s.withdrawnReason)}`
        : "**Not yet listed.** This source was proposed but is not yet curated or corroborated. Check it before relying on it.",
      "",
    );
  }
  out.push(`_${UNTRUSTED_NOTICE}_`, "");

  out.push("## Get the data", "");
  out.push(`- **Endpoint (${s.platform}):** ${s.accessUrl}`);
  if (s.exampleQuery) out.push(`- **Example request:** ${s.exampleQuery}`);
  if (s.schemaUrl) out.push(`- **Live field list:** ${s.schemaUrl}`);
  if (s.landingPage) out.push(`- **About it:** ${s.landingPage}`);
  if (s.geometry) out.push(`- **Geometry:** ${s.geometry}`);
  if (s.conformsTo.length) out.push(`- **Follows:** ${s.conformsTo.map((c) => `https://${host}/sources/${c}`).join(", ")}`);
  out.push(
    `- **Field list ${s.fieldsVerified ? `read from the publisher ${s.fieldsCheckedAt?.slice(0, 10) ?? ""}` : "supplied by hand, not checked against the publisher"}.**` +
      " Field names below are exact; use them as written.",
    "",
  );

  if (s.carries.length) {
    out.push("## What the records are", "");
    out.push("| Concept | Role | Fields mapped |", "|---|---|---|");
    for (const c of s.carries) {
      out.push(`| [${cell(c.prefLabel)}](${c.conceptUri}) | ${c.role === "record" ? "each row is one" : "each row points at one"} | ${c.mappedFields} of ${c.conceptFields} |`);
    }
    out.push("");
  }

  out.push("## Fields", "");
  out.push("| Field | Type | Label | Means (concept field) |", "|---|---|---|---|");
  for (const f of s.fields) {
    const means = "means" in f && f.means
      ? f.means.map((m) => `${cell(m.concept)}.${cell(m.field)}${m.conversion ? ` (${cell(m.conversion)})` : ""}`).join("; ")
      : "";
    out.push(`| \`${cell(f.name)}\` | ${cell(f.type)} | ${cell(f.label ?? "")} | ${means} |`);
  }
  out.push("");
  if (s.unmappedFields > 0) {
    out.push(`${s.unmappedFields} field(s) have no meaning recorded yet.`, "");
  }

  if (s.related.length) {
    out.push("## Related sources", "");
    for (const r of s.related) {
      out.push(`### ${line(r.title)} (\`${r.slug}\`, ${r.jurisdiction})`, "");
      for (const j of r.joins) {
        out.push(`**${j.kind} join${j.via ? ` via ${line(j.via.prefLabel)}` : ""}.** ${line(j.how)}`, "");
        if (j.pairs.length) {
          out.push(`| This source | ${cell(r.slug)} | Concept field |`, "|---|---|---|");
          for (const p of j.pairs) out.push(`| \`${cell(p.a)}\` | \`${cell(p.b)}\` | ${cell(p.conceptField)} |`);
          out.push("");
        }
      }
      out.push(`Full page: https://${host}/sources/${r.slug}`, "");
    }
  }

  if ("conformedBy" in s && s.conformedBy) {
    out.push("## Datasets that follow it", "");
    out.push(
      s.conformedBy.length
        ? s.conformedBy.map((c) => `- [${line(c.title)}](https://${host}/sources/${c.slug}) (${c.jurisdiction})`).join("\n")
        : "None listed yet. A dataset declares it with `conformsTo` when it is proposed.",
      "",
    );
  }

  if (s.overlays.length) {
    out.push("## Map layers it overlays", "");
    out.push(
      "No shared field: relate records by intersecting geometries. " +
        s.overlays.map((o) => `[${line(o.title)}](https://${host}/sources/${o.slug})`).join(", ") + ".",
      "",
    );
  }

  out.push("## Help the next builder", "");
  out.push(
    "If you work out what an unmapped field means, or find a mapping above is wrong, record it with " +
      "`lattice_map_source` (MCP) or `POST https://" + host + "/api/tools/lattice_map_source` with " +
      `\`{ "source": "${s.slug}", "conceptUri": "…", "fields": [{ "from": "…", "to": "…" }] }\`. ` +
      "Send `\"verdict\": \"wrong\"` on a pair to dispute it. Never send record values, only field names.",
    "",
  );
  out.push(`JSON: \`POST https://${host}/api/tools/lattice_resolve_source\` with \`{ "slug": "${s.slug}" }\`.`, "");
  return out.join("\n");
}

export function renderSourcesIndex(
  instance: LatticeInstance,
  host: string,
  found?: { query: string; jurisdiction?: string; results: Array<{ slug: string; title: string; jurisdiction: string; recordDescription: string; similarity?: number; coverage?: string | null }> },
): string {
  const out: string[] = [];
  if (found) {
    out.push(`# Public data sources: ${line(found.query || found.jurisdiction)}`, "");
    if (found.results.length === 0) {
      out.push(
        "Nothing listed matches. If you find the dataset yourself, add it with `lattice_propose_source` " +
          `(or \`POST https://${host}/api/tools/lattice_propose_source\`) so the next builder doesn't have to search.`,
        "",
      );
    }
    for (const r of found.results) {
      out.push(
        `- **[${line(r.title)}](https://${host}/sources/${r.slug})** (${r.jurisdiction}${r.coverage && r.coverage !== "exact" ? `, ${r.coverage}` : ""}` +
          `${r.similarity !== undefined ? `, ${r.similarity.toFixed(2)}` : ""}): ${line(r.recordDescription)}`,
      );
    }
    out.push("", `_${UNTRUSTED_NOTICE}_`, "");
    return out.join("\n");
  }

  out.push("# Public data sources", "");
  out.push(
    "Public datasets the catalog knows about, with what each field means in catalog terms and how the " +
      "datasets join. Search: `/sources?q=property+sales&jurisdiction=US-CT/new-haven`. Jurisdictions are " +
      "ISO codes with an optional locality; a search includes broader sources that cover the place.",
    "",
  );
  const all = instance.sources.listAll();
  if (all.length === 0) out.push("No sources are listed yet.", "");
  let current = "";
  for (const s of all) {
    if (s.jurisdiction !== current) {
      current = s.jurisdiction;
      out.push(`## ${current}`, "");
    }
    out.push(`- **[${line(s.title)}](https://${host}/sources/${s.slug})**${s.kind === "standard" ? " (standard)" : ""}, ${line(s.publisher)}: ${line(s.recordDescription)}`);
  }
  out.push("", `_${UNTRUSTED_NOTICE}_`, "");
  return out.join("\n");
}
