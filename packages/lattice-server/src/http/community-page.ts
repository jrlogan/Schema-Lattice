// /community and /community/{slug} as markdown, for people and agents alike.

import type { communityReport } from "../query/community.ts";

type Report = Awaited<ReturnType<typeof communityReport>>;
type Full = Extract<Report, { community: unknown }>;
type Index = Extract<Report, { communities: unknown }>;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function renderCommunityIndex(index: Index, host: string): string {
  const base = `https://${host}`;
  const rows = index.communities.map((c) =>
    `| [${cell(c.title)}](${base}/community/${c.slug}) | ${cell(c.charter)} | ${c.contexts} | ${c.members} | ${c.jurisdictions.join(", ")} |`);
  return `# Communities

A community is a group of apps, people and public data around one topic or place, looking after
a shared part of the catalog. It holds no vocabulary of its own: everything stays in the one
catalog. A community has stewards, its own list of unmet searches, and a vocabulary pack.

${rows.length ? `| Community | Charter | Contexts | Apps | Places |\n|---|---|---|---|---|\n${rows.join("\n")}` : "No communities yet."}

Join one: add \`"communities": ["<slug>"]\` to your app's \`lattice_register_app\` call.
Start one: ask the operator (${base}/api/tools/lattice_feedback).
`;
}

export function renderCommunityPage(r: Full, host: string): string {
  const base = `https://${host}`;
  const c = r.community;
  const out: string[] = [
    `# ${c.title}`,
    "",
    c.charter,
    "",
    `Places: ${c.jurisdictions.join(", ") || "none"}. Stewards: ${c.stewards.join(", ") || "none yet"}.`,
  ];
  if (c.conventions) out.push("", "## Conventions", "", c.conventions);
  out.push(
    "",
    "## Use it",
    "",
    `- Search only this community: \`GET ${base}/discover?community=${c.slug}&description=...\`, or \`community: "${c.slug}"\` on lattice_discover`,
    `- Its vocabulary, ready to paste: ${base}${r.pack}`,
    `- Join with your app: \`"communities": ["${c.slug}"]\` on lattice_register_app`,
    `- As JSON: POST ${base}/api/tools/lattice_community_report with {"slug": "${c.slug}"}`,
    "",
    "## Contexts",
    "",
    r.contexts.length ? r.contexts.map((x) => `- **${x.title}** (\`${x.slug}\`, ${x.concepts} concepts): ${base}/pack/${x.slug}`).join("\n") : "None yet.",
    "",
    "## Newest concepts",
    "",
    r.recentConcepts.length ? r.recentConcepts.map((x) => `- ${x.prefLabel} (${x.createdAt.slice(0, 10)}): ${x.uri}`).join("\n") : "None yet.",
    "",
    "## Apps",
    "",
    r.apps.length
      ? `| App | Unit | Status | Concepts |\n|---|---|---|---|\n${r.apps.map((a) => `| ${cell(a.name)} (\`${a.slug}\`) | ${cell(a.unit)} | ${a.status} | ${a.concepts} |`).join("\n")}`
      : "No apps have joined yet.",
  );
  if (r.meshPairs.length) out.push("", "How well members exchange data:", "", r.meshPairs.map((p) => `- ${base}${p}`).join("\n"));
  out.push(
    "",
    "## Public data",
    "",
    r.sources.length ? r.sources.map((s) => `- **${cell(s.title)}** (${s.publisher}, ${s.jurisdiction}): ${base}/sources/${s.slug}`).join("\n") : "No sources listed for these places yet.",
    "",
    "## Unmet searches",
    "",
    "What builders searched for in this community and the catalog did not have. This is the community's backlog.",
    "",
    r.unmetSearches.clusters.length
      ? r.unmetSearches.clusters.map((k) => `- ${k.asked}× "${cell(k.representative).slice(0, 160)}"${k.nearestExisting ? ` (nearest: ${k.nearestExisting.prefLabel}, ${k.nearestExisting.similarity.toFixed(2)})` : ""}`).join("\n")
      : "None recorded.",
    "",
    "## Evidence under review",
    "",
    r.evidence.length
      ? r.evidence.map((e) => `- ${e.status}: ${e.claim} — ${e.conceptUri} (${e.independentSources} independent sources)`).join("\n")
      : "No claims about this community's concepts.",
    "",
    `_${r.notice}_`,
    "",
  );
  return out.join("\n");
}
