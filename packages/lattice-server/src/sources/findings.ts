// What builders find out by using a public source (specs/public-sources.md
// § What builders found): notes about fields, access behaviour and
// disagreements with other sources, and reports of joins they actually ran.
//
// Both are evidence-ledger claims, so they follow the same quarantine and
// corroboration rules as field mappings: a curator's take effect at once,
// a stranger's once independent builders agree. Join reports carry counts
// only (tried, matched), never records.

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { EvidenceLedger } from "../evidence/ledger.ts";
import { EvidenceRejected } from "../evidence/ledger.ts";

export const FINDINGS_CONFIG = {
  textMax: 300,
  maxFieldsPerSide: 4,
  maxTried: 10_000_000,
  /** A join "works" at or above this match rate; a report below it says the join fails. */
  worksAt: 0.5,
} as const;

const TOPICS = ["field", "access", "disagreement", "caveat"] as const;
export type NoteTopic = (typeof TOPICS)[number];

/**
 * Field facts with a fixed vocabulary, so two builders who find the same thing
 * corroborate each other whatever words they use.
 */
const ASSERTIONS = [
  "always-empty", "mostly-empty", "not-degrees", "values-lag", "personal-data",
  "codes-unpublished", "meaning-differs", "other",
] as const;
export type FieldAssertion = (typeof ASSERTIONS)[number];

const METHODS = ["fields", "point-in-polygon", "nearest"] as const;
export type JoinMethod = (typeof METHODS)[number];

export class FindingRejected extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

/** What findings need to know about a source; supplied by Sources. */
export interface SourceView {
  fields: string[];
  verified: boolean;
  withdrawn: boolean;
}

export interface NoteInput {
  source: string;
  topic?: string;
  field?: string;
  assertion?: string;
  otherSource?: string;
  text?: string;
  /** Agree with (or, with verdict wrong, dispute) a note already recorded, by its key. */
  agree?: string;
  verdict?: string;
}

export interface JoinReportInput {
  a: string;
  b: string;
  method?: string;
  fieldsA?: unknown;
  fieldsB?: unknown;
  tried: unknown;
  matched: unknown;
  /** How values had to change before they matched; a raw comparison would not. */
  transform?: string;
  note?: string;
}

export interface ListedNote {
  key: string;
  topic: NoteTopic;
  field?: string;
  assertion?: FieldAssertion;
  otherSource?: string;
  text: string;
  curatedBy?: string;
  corroboratedBy?: number;
  /** Set when the server's own field profile shows the same thing. */
  confirmedByProfile?: boolean;
}

export interface JoinEvidence {
  key: string;
  a: string;
  b: string;
  method: JoinMethod;
  fieldsA: string[];
  fieldsB: string[];
  status: "works" | "fails" | "unconfirmed";
  reports: number;
  /** Median of the reported match rates, 0..1. */
  matchRate: number;
  tried: number;
  /** Transformations builders needed, most recent first. */
  transforms: string[];
}

export class SourceFindings {
  constructor(
    private db: Database.Database,
    private evidence: EvidenceLedger,
    private view: (slug: string) => SourceView | null,
    /** Whether the server's own profile of a field confirms a field assertion. */
    private profileConfirms: (slug: string, field: string, assertion: FieldAssertion) => boolean,
  ) {
    evidence.registerKind("source-note", {
      valid: (_subject, claim) => this.noteStillValid(claim as unknown as NoteClaim),
      // A field fact the server can see for itself lists on anonymous corroboration.
      structurallyVerified: (_subject, claim) => {
        const c = claim as unknown as NoteClaim;
        return c.topic === "field" && !!c.field && !!c.assertion && this.profileConfirms(c.source, c.field, c.assertion);
      },
    });
    evidence.registerKind("join-report", {
      valid: (_subject, claim) => this.joinStillValid(claim as unknown as JoinClaim),
      // Both field lists were read from the publishers, so the fields named are real.
      structurallyVerified: (_subject, claim) => {
        const c = claim as unknown as JoinClaim;
        return !!this.view(c.a)?.verified && !!this.view(c.b)?.verified;
      },
    });
  }

  // --- notes ------------------------------------------------------------------

  note(input: NoteInput, source: string, now: Date, wide: string) {
    const slug = text(input.source, "source", 60, true)!;
    const view = this.view(slug);
    if (!view) throw new FindingRejected(`no source "${slug}"`);
    if (view.withdrawn) throw new FindingRejected(`"${slug}" was withdrawn`);
    const verdict = oneOf(input.verdict, "verdict", ["right", "wrong"] as const) ?? "right";

    let claim: NoteClaim;
    let claimKey: string;
    if (input.agree) {
      claimKey = text(input.agree, "agree", 400, true)!;
      if (!claimKey.startsWith(`source-note|${slug}|`)) throw new FindingRejected(`"agree" must be the key of a note on ${slug}`);
      const existing = this.evidence.latestClaim(claimKey) as unknown as NoteClaim;
      if (!existing.topic) throw new FindingRejected(`no note ${claimKey}`);
      claim = existing;
    } else {
      const topic = oneOf(input.topic, "topic", TOPICS);
      if (!topic) throw new FindingRejected(`"topic" is required: one of ${TOPICS.join(", ")}`);
      const body = text(input.text, "text", FINDINGS_CONFIG.textMax, true)!;
      if (body.split(/\s+/).length < 3) throw new FindingRejected('"text" must say what you found, in a sentence');
      claim = { source: slug, topic, text: body };
      if (topic === "field") {
        const field = text(input.field, "field", 120, true)!;
        if (!view.fields.includes(field)) throw new FindingRejected(`"${field}" is not a field of ${slug}; names are exact`);
        const assertion = oneOf(input.assertion, "assertion", ASSERTIONS);
        if (!assertion) throw new FindingRejected(`"assertion" is required for a field note: one of ${ASSERTIONS.join(", ")}`);
        claim = { ...claim, field, assertion };
        claimKey = `source-note|${slug}|field|${field}|${assertion}`;
      } else if (topic === "disagreement") {
        const other = text(input.otherSource, "otherSource", 60, true)!;
        const otherView = this.view(other);
        if (!otherView || other === slug) throw new FindingRejected(`"otherSource" must name another source`);
        const field = input.field ? text(input.field, "field", 120)! : undefined;
        if (field && !view.fields.includes(field)) throw new FindingRejected(`"${field}" is not a field of ${slug}`);
        claim = { ...claim, otherSource: other, ...(field ? { field } : {}) };
        claimKey = `source-note|${slug}|disagreement|${other}|${field ?? "all"}`;
      } else {
        // Free-text notes corroborate by agreeing with the key, not by retyping the words.
        claimKey = `source-note|${slug}|${topic}|${digest(body)}`;
      }
      if (claimKey.split("|").some((part) => part === "")) throw new FindingRejected("empty part in note");
    }

    const [outcome] = this.claim(() =>
      this.evidence.proposeClaims("source-note", [{ claimKey, subject: slug, direction: verdict, claim: claim as unknown as Record<string, unknown> }], source, now, wide),
    );
    return {
      key: claimKey,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      independentSources: outcome.corroboration.independentSources,
      next:
        outcome.status === "promoted"
          ? "Listed: it shows on the source page under What builders found."
          : `Another builder who finds the same can agree with { "source": "${slug}", "agree": "${claimKey}" }. ` +
            "It lists once independent builders agree (lattice_sources_report shows progress).",
    };
  }

  /** Listed notes on a source, newest wording for each. */
  notesFor(slug: string): ListedNote[] {
    const disputed = new Set(this.evidence.promotedKeys("source-note", "wrong").map((k) => k.claimKey));
    return this.evidence
      .promotedKeys("source-note")
      .filter((k) => k.claimKey.startsWith(`source-note|${slug}|`) && !disputed.has(k.claimKey))
      .map(({ claimKey, reason, sources }) => {
        const c = this.evidence.latestClaim(claimKey) as unknown as NoteClaim;
        return {
          key: claimKey,
          topic: c.topic,
          ...(c.field ? { field: c.field } : {}),
          ...(c.assertion ? { assertion: c.assertion } : {}),
          ...(c.otherSource ? { otherSource: c.otherSource } : {}),
          text: c.text,
          ...(reason?.startsWith("curated by ") ? { curatedBy: reason.slice("curated by ".length) } : { corroboratedBy: sources }),
          ...(c.field && c.assertion && this.profileConfirms(slug, c.field, c.assertion) ? { confirmedByProfile: true } : {}),
        };
      });
  }

  pendingNotes() {
    return this.evidence
      .statesOf("source-note")
      .filter((s) => s.status === "pending" || s.status === "frozen")
      .map((s) => {
        const c = this.evidence.latestClaim(s.claimKey) as unknown as NoteClaim;
        return { key: s.claimKey, source: c.source, topic: c.topic, field: c.field, assertion: c.assertion, independentSources: s.sources, status: s.status };
      });
  }

  // --- join reports -------------------------------------------------------------

  reportJoin(input: JoinReportInput, source: string, now: Date, wide: string) {
    let a = text(input.a, "a", 60, true)!;
    let b = text(input.b, "b", 60, true)!;
    if (a === b) throw new FindingRejected('"a" and "b" must be two different sources');
    const method = oneOf(input.method, "method", METHODS) ?? "fields";
    let fieldsA = fieldList(input.fieldsA, "fieldsA");
    let fieldsB = fieldList(input.fieldsB, "fieldsB");
    const va = this.view(a);
    const vb = this.view(b);
    if (!va || !vb) throw new FindingRejected(`no source "${!va ? a : b}"`);
    if (va.withdrawn || vb.withdrawn) throw new FindingRejected("one of the sources was withdrawn");
    if (method === "fields") {
      if (fieldsA.length === 0 || fieldsA.length !== fieldsB.length) {
        throw new FindingRejected('a "fields" join needs fieldsA and fieldsB, the same length: the fields compared, in order');
      }
    } else if (fieldsA.length || fieldsB.length) {
      throw new FindingRejected(`a ${method} join compares geometries; leave fieldsA and fieldsB out`);
    }
    const missing = [...fieldsA.filter((f) => !va.fields.includes(f)).map((f) => `${a}.${f}`), ...fieldsB.filter((f) => !vb.fields.includes(f)).map((f) => `${b}.${f}`)];
    if (missing.length) throw new FindingRejected(`not fields of those sources (names are exact): ${missing.join(", ")}`);
    const tried = count(input.tried, "tried", 1);
    const matched = count(input.matched, "matched", 0);
    if (matched > tried) throw new FindingRejected('"matched" cannot exceed "tried"');
    if (input.note && input.note.length > FINDINGS_CONFIG.textMax) throw new FindingRejected(`note must be ${FINDINGS_CONFIG.textMax} characters or fewer`);
    const transform = text(input.transform, "transform", 200);
    // One key per join whichever way round it was reported.
    if (b < a) [a, b, fieldsA, fieldsB] = [b, a, fieldsB, fieldsA];
    const claimKey = joinKey(a, b, method, fieldsA, fieldsB);
    const rate = matched / tried;
    const claim: JoinClaim = { a, b, method, fieldsA, fieldsB, tried, matched, ...(transform ? { transform } : {}), ...(input.note ? { note: input.note } : {}) };
    const [outcome] = this.claim(() =>
      this.evidence.proposeClaims("join-report", [{
        claimKey, subject: `${a}|${b}`, direction: rate >= FINDINGS_CONFIG.worksAt ? "right" : "wrong", claim: claim as unknown as Record<string, unknown>,
      }], source, now, wide),
    );
    return {
      key: claimKey,
      reported: rate >= FINDINGS_CONFIG.worksAt ? "works" : "fails",
      matchRate: Number(rate.toFixed(3)),
      status: outcome.status,
      evidence: this.joinEvidence(claimKey),
      notice: "Counts only: never send the records themselves.",
    };
  }

  /** What builders measured for one join, or null when nobody reported it. */
  joinEvidence(claimKey: string): JoinEvidence | null {
    const claims = this.evidence.claimsOf(claimKey);
    if (claims.length === 0) return null;
    const c = claims[0].claim as unknown as JoinClaim;
    const rates = claims.map((x) => (x.claim.matched as number) / (x.claim.tried as number)).sort((p, q) => p - q);
    const works = this.evidence.outcome(claimKey, "right").status === "promoted";
    const fails = this.evidence.outcome(claimKey, "wrong").status === "promoted";
    return {
      key: claimKey, a: c.a, b: c.b, method: c.method, fieldsA: c.fieldsA, fieldsB: c.fieldsB,
      status: fails && !works ? "fails" : works && !fails ? "works" : "unconfirmed",
      reports: claims.length,
      matchRate: Number(rates[Math.floor(rates.length / 2)].toFixed(3)),
      tried: claims.reduce((s, x) => s + (x.claim.tried as number), 0),
      transforms: [...new Set(claims.map((x) => x.claim.transform).filter((t): t is string => typeof t === "string"))],
    };
  }

  /** Every reported join touching a source. */
  joinsFor(slug: string): JoinEvidence[] {
    const keys = (this.db
      .prepare("SELECT DISTINCT claim_key FROM evidence WHERE kind = 'join-report' AND (subject LIKE ? OR subject LIKE ?)")
      .all(`${slug}|%`, `%|${slug}`) as Array<{ claim_key: string }>).map((r) => r.claim_key);
    return keys.map((k) => this.joinEvidence(k)).filter((j): j is JoinEvidence => j !== null);
  }

  // --- internals ------------------------------------------------------------------

  private noteStillValid(c: NoteClaim): boolean {
    const v = this.view(c.source);
    if (!v || v.withdrawn) return false;
    if (c.field && !v.fields.includes(c.field)) return false;
    if (c.otherSource && !this.view(c.otherSource)) return false;
    return true;
  }

  private joinStillValid(c: JoinClaim): boolean {
    const va = this.view(c.a);
    const vb = this.view(c.b);
    if (!va || !vb || va.withdrawn || vb.withdrawn) return false;
    return c.fieldsA.every((f) => va.fields.includes(f)) && c.fieldsB.every((f) => vb.fields.includes(f));
  }

  private claim<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof EvidenceRejected) throw new FindingRejected(err.message, err.details);
      throw err;
    }
  }
}

interface NoteClaim {
  source: string;
  topic: NoteTopic;
  text: string;
  field?: string;
  assertion?: FieldAssertion;
  otherSource?: string;
}

interface JoinClaim {
  a: string;
  b: string;
  method: JoinMethod;
  fieldsA: string[];
  fieldsB: string[];
  tried: number;
  matched: number;
  transform?: string;
  note?: string;
}

/** The claim key for a join, sources in sorted order. */
export function joinKey(a: string, b: string, method: JoinMethod, fieldsA: string[], fieldsB: string[]): string {
  if (b < a) return joinKey(b, a, method, fieldsB, fieldsA);
  return `join-report|${a}|${b}|${method === "fields" ? `${fieldsA.join("+")}=${fieldsB.join("+")}` : method}`;
}

function digest(body: string): string {
  return createHash("sha256").update(body.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
}

function text(value: unknown, key: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new FindingRejected(`"${key}" is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new FindingRejected(`"${key}" must be a string`);
  const v = value.trim();
  if (!v && required) throw new FindingRejected(`"${key}" is required`);
  if (v.length > max) throw new FindingRejected(`"${key}" must be ${max} characters or fewer`);
  if (v.includes("|") && key !== "text" && key !== "agree") throw new FindingRejected(`"${key}" may not contain "|"`);
  return v;
}

function oneOf<T extends string>(value: unknown, key: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new FindingRejected(`"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function fieldList(value: unknown, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    throw new FindingRejected(`"${key}" must be an array of field names`);
  }
  if (value.length > FINDINGS_CONFIG.maxFieldsPerSide) throw new FindingRejected(`at most ${FINDINGS_CONFIG.maxFieldsPerSide} fields per side`);
  const out = value.map((v: string) => v.trim());
  if (out.some((f) => f.includes("|") || f.includes("=") || f.includes("+"))) throw new FindingRejected(`"${key}": field names may not contain | = +`);
  return out;
}

function count(value: unknown, key: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > FINDINGS_CONFIG.maxTried) {
    throw new FindingRejected(`"${key}" must be a whole number from ${min} to ${FINDINGS_CONFIG.maxTried}`);
  }
  return value;
}
