// The app registry — the aggregation point for everything the rest of
// the stack produces: which apps exist, who owns them, which lattice
// concepts they use, what their sensitivity profile looks like, and
// which build-time gates have attested to them.
//
// Organization-neutral by design: an "app" belongs to a `unit`, which
// can be a city department, a makerspace shop area, a club committee,
// or a product team. Attestations follow the `governance/attestation`
// shape (specs/data-classification.md); the registry stores results,
// it never runs checks or enforces policy.
//
// This is the server-side half of REQUIREMENTS §R4: it provides
// `listUsages` (the tool the Local Register reconciles against) and
// the advisory audit findings. The client-side scan of repos for
// schemalattice.json sidecars remains M4 CLI work.

import type Database from "better-sqlite3";
import type { Store } from "../storage/db.ts";
import type { GovernanceSeedResult } from "../seed/governance.ts";
import type { VectorIndex } from "../discover/vectors.ts";
import {
  sensitivityProfile,
  type SensitivityProfile,
} from "../publish/classification.ts";
import { cosine } from "../discover/embedder.ts";
import { PublishError } from "../publish/errors.ts";

// Unlike concept slugs, app slugs may start with a digit ("311-portal").
const APP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export type UsageStatus = "adopted" | "forked" | "originated";
export type AppStatus = "experiment" | "pilot" | "production" | "retired";
export type AttestationResult = "pass" | "fail" | "waived";

export interface AppUsage {
  uri: string;
  status: UsageStatus;
  shortName?: string;
}

export interface AppRegistration {
  slug: string;
  name: string;
  description?: string;
  /** Owning organizational unit — department, shop area, team, committee. */
  unit: string;
  owner: string;
  contact?: string;
  status: AppStatus;
  concepts: AppUsage[];
}

export interface AttestationInput {
  gate: string;
  gateVersion?: string;
  result: AttestationResult;
  performedBy: string;
  performedOn: string; // ISO date
  findingsRef?: string;
  notes?: string;
}

export interface AppScore {
  reuse: number;
  dedupe: number;
  anchoring: number;
  overall: number;
}

export interface AppOverlap {
  a: string;
  b: string;
  sharedUris: number;
  forkLinks: number;
  semanticPairs: number;
  compatibility: number;
}

export interface AuditFinding {
  kind:
    | "unlinked-near-duplicate"
    | "fork-bridge"
    | "unclassified-fields"
    | "unattested-sensitive-profile";
  apps: string[];
  detail: string;
}

const USAGE_STATUSES: UsageStatus[] = ["adopted", "forked", "originated"];
const APP_STATUSES: AppStatus[] = ["experiment", "pilot", "production", "retired"];
const ATTESTATION_RESULTS: AttestationResult[] = ["pass", "fail", "waived"];

/** Cosine similarity at/above which two unlinked concepts are near-duplicates. */
const NEAR_DUP_SIM = 0.85;
/** Cosine similarity at/above which an overlap counts as a semantic pair. */
const SEMANTIC_PAIR_SIM = 0.75;
/** Sensitivity rank at/above which a missing attestation is surfaced. */
const SENSITIVE_RANK = 3;

export interface RegistryDeps {
  store: Store;
  governance: GovernanceSeedResult;
  vectors: VectorIndex;
}

export class Registry {
  private db: Database.Database;

  constructor(private deps: RegistryDeps) {
    this.db = deps.store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        unit TEXT NOT NULL,
        owner TEXT NOT NULL,
        contact TEXT,
        status TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_usages (
        app_slug TEXT NOT NULL,
        concept_uri TEXT NOT NULL,
        status TEXT NOT NULL,
        short_name TEXT,
        PRIMARY KEY (app_slug, concept_uri)
      );
      CREATE INDEX IF NOT EXISTS idx_app_usages_concept
        ON app_usages(concept_uri);
      CREATE TABLE IF NOT EXISTS app_attestations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_slug TEXT NOT NULL,
        gate TEXT NOT NULL,
        gate_version TEXT,
        result TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performed_on TEXT NOT NULL,
        findings_ref TEXT,
        notes TEXT,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attestations_app
        ON app_attestations(app_slug);
    `);
  }

  // ---------------------------------------------------------------
  registerApp(input: AppRegistration): { slug: string; created: boolean } {
    if (!APP_SLUG_RE.test(input.slug)) {
      throw new PublishError(
        "ERR_APP_SLUG_INVALID",
        `invalid app slug ${JSON.stringify(input.slug)} — lowercase letters, digits, and hyphens only`,
      );
    }
    if (!input.name?.trim()) {
      throw new PublishError("ERR_APP_NAME_REQUIRED", "app name is required");
    }
    if (!input.unit?.trim() || !input.owner?.trim()) {
      throw new PublishError(
        "ERR_APP_OWNER_REQUIRED",
        "unit and owner are required — an unowned app cannot be audited or contacted",
      );
    }
    if (!APP_STATUSES.includes(input.status)) {
      throw new PublishError(
        "ERR_APP_STATUS_INVALID",
        `status must be one of ${APP_STATUSES.join(", ")}`,
      );
    }
    for (const u of input.concepts) {
      if (!USAGE_STATUSES.includes(u.status)) {
        throw new PublishError(
          "ERR_USAGE_STATUS_INVALID",
          `usage status must be one of ${USAGE_STATUSES.join(", ")} (got ${JSON.stringify(u.status)})`,
        );
      }
      if (!this.deps.store.hasConcept(u.uri)) {
        throw new PublishError(
          "ERR_UNKNOWN_CONCEPT",
          `manifest references a concept the catalog does not have: ${u.uri}`,
          { guidance: "Publish the concept first (or fix the URI); the registry only accepts manifests that resolve." },
        );
      }
    }

    const now = new Date().toISOString();
    const exists = !!this.db
      .prepare("SELECT 1 AS ok FROM apps WHERE slug = ?")
      .get(input.slug);

    const tx = this.db.transaction(() => {
      if (exists) {
        this.db
          .prepare(
            `UPDATE apps SET name=?, description=?, unit=?, owner=?, contact=?, status=?, updated_at=? WHERE slug=?`,
          )
          .run(
            input.name, input.description ?? null, input.unit, input.owner,
            input.contact ?? null, input.status, now, input.slug,
          );
        this.db.prepare("DELETE FROM app_usages WHERE app_slug=?").run(input.slug);
      } else {
        this.db
          .prepare(
            `INSERT INTO apps (slug, name, description, unit, owner, contact, status, registered_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.slug, input.name, input.description ?? null, input.unit,
            input.owner, input.contact ?? null, input.status, now, now,
          );
      }
      const ins = this.db.prepare(
        `INSERT INTO app_usages (app_slug, concept_uri, status, short_name) VALUES (?, ?, ?, ?)`,
      );
      for (const u of input.concepts) {
        ins.run(input.slug, u.uri, u.status, u.shortName ?? null);
      }
    });
    tx();
    this.deps.store.logEvent("register_app", {
      slug: input.slug,
      unit: input.unit,
      status: input.status,
      conceptCount: input.concepts.length,
      updated: exists,
    });
    return { slug: input.slug, created: !exists };
  }

  recordAttestation(appSlug: string, att: AttestationInput): { id: number } {
    this.requireApp(appSlug);
    if (!att.gate?.trim() || !att.performedBy?.trim() || !att.performedOn?.trim()) {
      throw new PublishError(
        "ERR_ATTESTATION_INCOMPLETE",
        "gate, performedBy, and performedOn are required (governance/attestation shape)",
      );
    }
    if (!ATTESTATION_RESULTS.includes(att.result)) {
      throw new PublishError(
        "ERR_ATTESTATION_RESULT_INVALID",
        `result must be one of ${ATTESTATION_RESULTS.join(", ")}`,
      );
    }
    const info = this.db
      .prepare(
        `INSERT INTO app_attestations
           (app_slug, gate, gate_version, result, performed_by, performed_on, findings_ref, notes, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        appSlug, att.gate, att.gateVersion ?? null, att.result, att.performedBy,
        att.performedOn, att.findingsRef ?? null, att.notes ?? null,
        new Date().toISOString(),
      );
    this.deps.store.logEvent("attestation", {
      app: appSlug, gate: att.gate, result: att.result,
    });
    return { id: Number(info.lastInsertRowid) };
  }

  // ---------------------------------------------------------------
  /** R4: which registered apps use this concept (or any of its forks' parents). */
  listUsages(conceptUri: string): Array<{ app: string; unit: string; status: UsageStatus; shortName: string | null }> {
    return (this.db
      .prepare(
        `SELECT u.app_slug AS app, a.unit AS unit, u.status AS status, u.short_name AS shortName
           FROM app_usages u JOIN apps a ON a.slug = u.app_slug
          WHERE u.concept_uri = ? ORDER BY u.app_slug`,
      )
      .all(conceptUri)) as Array<{ app: string; unit: string; status: UsageStatus; shortName: string | null }>;
  }

  listApps(): Array<{ slug: string; name: string; unit: string; owner: string; status: AppStatus; conceptCount: number; attestationCount: number }> {
    return (this.db
      .prepare(
        `SELECT a.slug, a.name, a.unit, a.owner, a.status,
                (SELECT COUNT(*) FROM app_usages u WHERE u.app_slug = a.slug) AS conceptCount,
                (SELECT COUNT(*) FROM app_attestations t WHERE t.app_slug = a.slug) AS attestationCount
           FROM apps a ORDER BY a.slug`,
      )
      .all()) as ReturnType<Registry["listApps"]>;
  }

  usagesOf(appSlug: string): AppUsage[] {
    return (this.db
      .prepare(
        `SELECT concept_uri AS uri, status, short_name AS shortName
           FROM app_usages WHERE app_slug = ? ORDER BY concept_uri`,
      )
      .all(appSlug)) as AppUsage[];
  }

  attestationsOf(appSlug: string): Array<AttestationInput & { recordedAt: string }> {
    return (this.db
      .prepare(
        `SELECT gate, gate_version AS gateVersion, result, performed_by AS performedBy,
                performed_on AS performedOn, findings_ref AS findingsRef, notes,
                recorded_at AS recordedAt
           FROM app_attestations WHERE app_slug = ? ORDER BY recorded_at`,
      )
      .all(appSlug)) as Array<AttestationInput & { recordedAt: string }>;
  }

  // ---------------------------------------------------------------
  /**
   * Connectivity score — the registry-grade version of the demo's
   * "built smart" metric, and a v0.1 preview of DECISIONS.md's v0.2
   * standardness direction. Three observable habits, equally
   * meaningful for any organization:
   *   reuse     — share of concepts adopted/forked rather than originated
   *   dedupe    — share free of unlinked near-duplicates that already
   *               existed when the concept was published (directional:
   *               the later, unacknowledging publisher carries the debt)
   *   anchoring — share carrying external matches, co-references, or
   *               fork lineage
   */
  scoreApp(appSlug: string): AppScore {
    const usages = this.usagesOf(appSlug);
    const total = usages.length || 1;
    const store = this.deps.store;

    const reused = usages.filter((u) => u.status !== "originated").length;

    const allUris = (this.db
      .prepare("SELECT DISTINCT concept_uri AS uri FROM app_usages")
      .all() as Array<{ uri: string }>).map((r) => r.uri);
    const createdAt = (u: string) => store.getConceptMeta(u)?.createdAt ?? "";
    const dupFree = usages.filter((u) => !this.findUnlinkedEarlierDup(u.uri, allUris, createdAt)).length;

    const anchored = usages.filter((u) => {
      if (u.status === "adopted") return true;
      const rec = store.getConcept(u.uri);
      if (!rec) return false;
      return (
        (rec.closeMatch ?? []).length > 0 ||
        (rec.coRefersWith ?? []).length > 0 ||
        !!rec.forkedFrom
      );
    }).length;

    const reuse = reused / total;
    const dedupe = dupFree / total;
    const anchoring = anchored / total;
    return {
      reuse: round3(reuse),
      dedupe: round3(dedupe),
      anchoring: round3(anchoring),
      overall: Math.round(100 * (0.4 * reuse + 0.35 * dedupe + 0.25 * anchoring)),
    };
  }

  profileOf(appSlug: string): SensitivityProfile {
    const uris = this.usagesOf(appSlug).map((u) => u.uri);
    return sensitivityProfile(this.deps.store, this.deps.governance, uris);
  }

  /** Pairwise compatibility across all registered apps. */
  overlaps(): AppOverlap[] {
    const apps = this.listApps().map((a) => a.slug);
    const out: AppOverlap[] = [];
    for (let i = 0; i < apps.length; i++) {
      for (let j = i + 1; j < apps.length; j++) {
        out.push(this.overlapBetween(apps[i], apps[j]));
      }
    }
    return out;
  }

  overlapBetween(a: string, b: string): AppOverlap {
    const ua = this.usagesOf(a);
    const ub = this.usagesOf(b);
    let sharedUris = 0, forkLinks = 0, semanticPairs = 0, raw = 0;
    for (const x of ua) {
      for (const y of ub) {
        if (x.uri === y.uri) { sharedUris++; raw += 1.0; continue; }
        if (this.descendsFrom(x.uri, y.uri) || this.descendsFrom(y.uri, x.uri)) {
          forkLinks++; raw += 0.7; continue;
        }
        const s = this.similarity(x.uri, y.uri);
        if (s >= SEMANTIC_PAIR_SIM) { semanticPairs++; raw += 0.4; }
      }
    }
    const denom = Math.min(ua.length, ub.length) || 1;
    return {
      a, b, sharedUris, forkLinks, semanticPairs,
      compatibility: round3(Math.min(1, raw / denom)),
    };
  }

  // ---------------------------------------------------------------
  /** Advisory findings across the whole registry. Nothing is auto-fixed. */
  audit(): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const store = this.deps.store;
    const apps = this.listApps().map((a) => a.slug);
    const allUris = (this.db
      .prepare("SELECT DISTINCT concept_uri AS uri FROM app_usages")
      .all() as Array<{ uri: string }>).map((r) => r.uri);
    const createdAt = (u: string) => store.getConceptMeta(u)?.createdAt ?? "";
    const label = (u: string) =>
      (store.getConcept(u)?.prefLabel as Record<string, string>)?.en ?? u;

    for (const app of apps) {
      for (const u of this.usagesOf(app)) {
        const dup = this.findUnlinkedEarlierDup(u.uri, allUris, createdAt);
        if (dup) {
          const earlierApps = this.listUsages(dup.uri).map((x) => x.app);
          findings.push({
            kind: "unlinked-near-duplicate",
            apps: [app, ...earlierApps],
            detail: `"${label(u.uri)}" (${app}) is ${Math.round(dup.similarity * 100)}% similar to the earlier "${label(dup.uri)}" with no acknowledging link — consider adopting, forking, or adding coRefersWith.`,
          });
        }
      }
    }

    // Fork bridges: one app uses a parent, another uses its fork.
    for (let i = 0; i < apps.length; i++) {
      for (let j = 0; j < apps.length; j++) {
        if (i === j) continue;
        for (const x of this.usagesOf(apps[i])) {
          for (const y of this.usagesOf(apps[j])) {
            if (x.uri !== y.uri && this.descendsFrom(y.uri, x.uri)) {
              findings.push({
                kind: "fork-bridge",
                apps: [apps[i], apps[j]],
                detail: `${apps[j]}'s "${label(y.uri)}" is a fork of ${apps[i]}'s "${label(x.uri)}" — a recorded changeset connects their data; these teams have overlapping ground.`,
              });
            }
          }
        }
      }
    }

    for (const app of apps) {
      const profile = this.profileOf(app);
      const unclassified = profile.totalFields - profile.classifiedFields;
      if (profile.totalFields > 0 && unclassified > 0) {
        findings.push({
          kind: "unclassified-fields",
          apps: [app],
          detail: `${unclassified} of ${profile.totalFields} fields carry no data classification — the app's sensitivity profile is incomplete.`,
        });
      }
      if (
        profile.maxRank !== null &&
        profile.maxRank >= SENSITIVE_RANK &&
        this.attestationsOf(app).length === 0
      ) {
        findings.push({
          kind: "unattested-sensitive-profile",
          apps: [app],
          detail: `Profile reaches "${profile.maxClass}" (rank ${profile.maxRank}) but no gate attestation is recorded. Whether one is required is organizational policy; the gap itself is worth knowing.`,
        });
      }
    }

    return findings;
  }

  /** Everything a program owner wants on one screen. */
  portfolioReport(): {
    apps: Array<{
      slug: string; name: string; unit: string; owner: string; status: AppStatus;
      score: AppScore; profile: SensitivityProfile;
      attestations: Array<{ gate: string; result: AttestationResult; performedOn: string }>;
    }>;
    overlaps: AppOverlap[];
    findings: AuditFinding[];
  } {
    return {
      apps: this.listApps().map((a) => ({
        slug: a.slug, name: a.name, unit: a.unit, owner: a.owner, status: a.status,
        score: this.scoreApp(a.slug),
        profile: this.profileOf(a.slug),
        attestations: this.attestationsOf(a.slug).map((t) => ({
          gate: t.gate, result: t.result, performedOn: t.performedOn,
        })),
      })),
      overlaps: this.overlaps(),
      findings: this.audit(),
    };
  }

  // ---------------------------------------------------------------
  private requireApp(slug: string): void {
    if (!this.db.prepare("SELECT 1 AS ok FROM apps WHERE slug=?").get(slug)) {
      throw new PublishError("ERR_UNKNOWN_APP", `no registered app with slug ${JSON.stringify(slug)}`);
    }
  }

  private similarity(a: string, b: string): number {
    const va = this.deps.vectors.vectorOf(a);
    const vb = this.deps.vectors.vectorOf(b);
    if (!va || !vb) return 0;
    return cosine(va, vb);
  }

  private linked(a: string, b: string): boolean {
    const ra = this.deps.store.getConcept(a);
    const rb = this.deps.store.getConcept(b);
    const touches = (rec: typeof ra, other: string) =>
      !!rec &&
      (rec.forkedFrom === other ||
        rec.derivedFrom === other ||
        (rec.broader ?? []).includes(other) ||
        (rec.coRefersWith ?? []).includes(other));
    return touches(ra, b) || touches(rb, a);
  }

  private descendsFrom(uri: string, ancestor: string): boolean {
    let cur: string | undefined = uri;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur === ancestor) return true;
      cur = this.deps.store.getConcept(cur)?.forkedFrom as string | undefined;
    }
    return false;
  }

  private findUnlinkedEarlierDup(
    uri: string,
    allUris: string[],
    createdAt: (u: string) => string,
  ): { uri: string; similarity: number } | null {
    for (const other of allUris) {
      if (other === uri) continue;
      if (createdAt(other) >= createdAt(uri)) continue;
      if (this.linked(uri, other)) continue;
      const s = this.similarity(uri, other);
      if (s >= NEAR_DUP_SIM) return { uri: other, similarity: s };
    }
    return null;
  }
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}
