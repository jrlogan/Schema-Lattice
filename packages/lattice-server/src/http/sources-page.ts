// Public data sources as paste-ready markdown (specs/public-sources.md § Builder packs).
//
// The page a builder would otherwise write by hand before touching a public
// dataset: where it is, how to query it, what every column means in catalog
// terms, and how it lines up with the other sources the catalog knows about.

import type { LatticeInstance } from "../server/instance.ts";
import { UNTRUSTED_NOTICE } from "../sources/sources.ts";

type Resolved = NonNullable<ReturnType<LatticeInstance["sources"]["resolve"]>>;
type Health = ReturnType<LatticeInstance["sources"]["health"]>;

const NOT_CONFIRMED = "_not confirmed_";

const READINESS_LABEL: Record<string, string> = {
  "not-assessed": "not assessed",
  "needs-preparation": "needs preparation",
  ready: "ready to build on",
};

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "never";
}

/** One line on whether the server can read the source, for the page and the health table. */
function accessLine(a: Resolved["access"]): string {
  switch (a.status) {
    case "tested":
      return `**tested** — the server read the publisher's field list on ${day(a.lastOkAt)}`;
    case "stale":
      return `**stale** — last read successfully on ${day(a.lastOkAt)}; not re-checked since`;
    case "failing":
      return `**failing** since ${day(a.failingSince)}: ${line(a.reason)} (last good read ${day(a.lastOkAt)})`;
    default:
      return "**located** — the field list was supplied by hand; the server cannot read this source itself";
  }
}

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
    `**Publisher:** ${line(s.publisher)} · **Jurisdiction:** ${s.jurisdiction} · **Status:** ${s.status}`,
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

  out.push("## What you can rely on", "");
  out.push(`- **Access:** ${accessLine(s.access)}`);
  out.push(`- **Data last changed (publisher):** ${s.publisherUpdatedAt ? day(s.publisherUpdatedAt) : NOT_CONFIRMED}. This is not when anyone checked it.`);
  out.push(
    `- **Build readiness:** ${READINESS_LABEL[s.readiness.level] ?? s.readiness.level}` +
      (s.readiness.note ? `. ${line(s.readiness.note)}` : "") +
      (s.readiness.reviewBy ? ` (review ${s.readiness.reviewOverdue ? "overdue since" : "by"} ${s.readiness.reviewBy})` : ""),
  );
  out.push(`- **License / terms:** ${s.license ? line(s.license) : NOT_CONFIRMED}`);
  out.push(`- **Cost of access:** ${s.cost ? line(s.cost) : NOT_CONFIRMED}`);
  out.push(`- **Update frequency:** ${s.updateFrequency ? line(s.updateFrequency) : NOT_CONFIRMED}`);
  out.push(`- **Contact for corrections:** ${s.contact ? line(s.contact) : NOT_CONFIRMED}`);
  out.push(
    "",
    "A public source is not automatically reusable, current or complete. A passing check means the field " +
      "list could be read, not that every row is there. Test a small request before relying on it.",
    "",
  );
  const lastChange = s.recentChecks.find((c) => c.ok && c.changed);
  if (lastChange) {
    const list = (k: "added" | "removed" | "retyped") => (lastChange[k] ?? []).map((n) => `\`${cell(n)}\``).join(", ");
    out.push(
      `**Field list changed on ${day(lastChange.checkedAt)}.**` +
        (list("added") ? ` Added: ${list("added")}.` : "") +
        (list("removed") ? ` Removed: ${list("removed")}.` : "") +
        (list("retyped") ? ` Retyped: ${list("retyped")}.` : ""),
      "",
    );
  }

  out.push("## Get the data", "");
  out.push(`- **Endpoint (${s.platform}):** ${s.accessUrl}`);
  if (s.exampleQuery) out.push(`- **Example request:** ${s.exampleQuery}`);
  if (s.schemaUrl) out.push(`- **Live field list:** ${s.schemaUrl}`);
  if (s.landingPage) out.push(`- **About it:** ${s.landingPage}`);
  if (s.geometry) out.push(`- **Geometry:** ${s.geometry}${s.locationFields ? `, from ${s.locationFields}` : ""}`);
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

type Found = {
  query: string;
  jurisdiction?: string;
  results: Array<{ slug: string; title: string; jurisdiction: string; recordDescription: string; similarity?: number; coverage?: string | null }>;
};

/** `/sources`: every listed source; with a jurisdiction, all that cover it; with a search, the matches. */
export function renderSourcesIndex(instance: LatticeInstance, host: string, found?: Found, jurisdiction?: string): string {
  return found ? renderSearch(host, found) : renderIndex(instance, host, jurisdiction);
}

function renderSearch(host: string, found: Found): string {
  const out: string[] = [];
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
  out.push(
    "",
    `Showing the ${found.results.length} best matches.` +
      (found.jurisdiction ? ` Every source covering ${line(found.jurisdiction)}: https://${host}/sources?jurisdiction=${encodeURIComponent(found.jurisdiction)}` : ""),
    "",
    `_${UNTRUSTED_NOTICE}_`,
    "",
  );
  return out.join("\n");
}

function renderIndex(instance: LatticeInstance, host: string, jurisdiction?: string): string {
  const out: string[] = [];
  out.push(jurisdiction ? `# Public data sources: ${line(jurisdiction)}` : "# Public data sources", "");
  out.push(
    "Public datasets the catalog knows about, with what each field means in catalog terms and how the " +
      "datasets join. Search: `/sources?q=property+sales&jurisdiction=US-CT/new-haven`. Jurisdictions are " +
      "ISO codes with an optional locality; a search includes broader sources that cover the place. " +
      `Which sources the server can still read, and what is unconfirmed: https://${host}/sources/health`,
    "",
  );
  const all = instance.sources.listAll(jurisdiction);
  if (jurisdiction) out.push(`**${all.length} listed sources cover ${line(jurisdiction)}**: the place's own first, then broader ones.`, "");
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

export function renderSourcesHealth(h: Health, host: string): string {
  const c = h.counts;
  const out: string[] = [];
  out.push("# Public data sources: health", "");
  out.push(
    `Checked ${day(h.checkedOn)}. The server re-reads every source it can read once a week and keeps each result.`,
    "",
    `**${c.listed} listed** · ${c.tested} tested · ${c.stale} stale · ${c.failing} failing · ${c.located} hand-supplied (located) · ` +
      `${c.drifted} with a changed field list · ${c.reviewOverdue} reviews overdue · ${c.ready} assessed ready, ${c.notAssessed} not assessed`,
    "",
    `_${h.notice}_`,
    "",
  );
  const attention = h.sources.filter((e) => e.access.status === "failing" || e.access.status === "stale" || e.drifted || e.reviewOverdue);
  if (attention.length) {
    out.push("## Needs attention", "");
    for (const e of attention) {
      const why = [
        e.access.status === "failing" || e.access.status === "stale" ? accessLine(e.access) : "",
        e.drifted ? "field list changed at the last check" : "",
        e.reviewOverdue ? `review overdue since ${e.reviewBy}` : "",
      ].filter(Boolean).join("; ");
      out.push(`- [${line(e.title)}](https://${host}/sources/${e.slug}): ${why}`);
    }
    out.push("");
  }
  out.push("## All sources", "");
  out.push("| Source | Jurisdiction | Access | Last good read | Readiness | Not confirmed |", "|---|---|---|---|---|---|");
  for (const e of h.sources) {
    out.push(
      `| [${cell(e.title)}](https://${host}/sources/${e.slug}) | ${e.jurisdiction} | ${e.access.status} | ${day(e.access.lastOkAt)} | ` +
        `${READINESS_LABEL[e.readiness] ?? e.readiness} | ${e.unknowns.join(", ")} |`,
    );
  }
  out.push("", `JSON: \`POST https://${host}/api/tools/lattice_sources_report\` (its \`needsAttention\` list).`, "");
  return out.join("\n");
}
