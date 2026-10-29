// Communities — specs/communities-and-sub-lattices.md, tier 1.
//
// A community is a named, stewarded view over the public catalog: a set of
// contexts, the apps that opted in, the public sources in its jurisdictions,
// and the apps that look after it. It holds no vocabulary of its own, so
// nothing forks: every concept stays in the one catalog and URI space.
//
// Powers, deliberately small:
//   - the operator creates a community and names its stewards;
//   - a steward edits its title, charter, contexts, jurisdictions and
//     conventions, and may create a context inside it without contributor
//     tier (see writeDenial in tools.ts);
//   - an app joins or leaves through its own registration.
// Stewards review evidence about the community's concepts (the report lists
// pending claims); they never decide what the ledger promotes.

import type Database from "better-sqlite3";
import type { Store } from "../storage/db.ts";
import { PublishError } from "../publish/errors.ts";
import { OPERATOR, type Principal } from "../server/principals.ts";

const SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/;
const JURISDICTION_RE = /^(global|[A-Z]{2}(-[A-Z0-9]{1,3})?(\/[a-z0-9][a-z0-9-]{0,39})?)$/;
const MAX_CONTEXTS = 40;

export interface CommunityInput {
  slug: string;
  title?: string;
  charter?: string;
  /** Context slugs; every version of each belongs to the community. */
  contexts?: string[];
  jurisdictions?: string[];
  /** App slugs. Only the operator may set this. */
  stewards?: string[];
  /** Optional: the community's naming and data-handling notes, as text or a link. */
  conventions?: string;
}

export interface Community {
  slug: string;
  title: string;
  charter: string;
  contexts: string[];
  jurisdictions: string[];
  stewards: string[];
  conventions: string | null;
  members: string[];
  createdAt: string;
  updatedAt: string;
}

interface Row {
  slug: string; title: string; charter: string; contexts: string; jurisdictions: string;
  stewards: string; conventions: string | null; created_at: string; updated_at: string;
}

export class Communities {
  private db: Database.Database;

  constructor(private store: Store, readonly_ = false) {
    this.db = store.db;
    if (readonly_) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS communities (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        charter TEXT NOT NULL,
        contexts TEXT NOT NULL,
        jurisdictions TEXT NOT NULL,
        stewards TEXT NOT NULL,
        conventions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS community_members (
        community_slug TEXT NOT NULL,
        app_slug TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (community_slug, app_slug)
      );
      CREATE INDEX IF NOT EXISTS idx_community_members_app ON community_members(app_slug);
    `);
  }

  private hydrate(row: Row): Community {
    const members = (this.db
      .prepare("SELECT app_slug FROM community_members WHERE community_slug = ? ORDER BY app_slug")
      .all(row.slug) as Array<{ app_slug: string }>).map((r) => r.app_slug);
    return {
      slug: row.slug, title: row.title, charter: row.charter,
      contexts: JSON.parse(row.contexts), jurisdictions: JSON.parse(row.jurisdictions),
      stewards: JSON.parse(row.stewards), conventions: row.conventions,
      members, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  get(slug: string): Community | null {
    const row = this.db.prepare("SELECT * FROM communities WHERE slug = ?").get(slug) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  list(): Community[] {
    return (this.db.prepare("SELECT * FROM communities ORDER BY slug").all() as Row[]).map((r) => this.hydrate(r));
  }

  /** Communities an app belongs to. */
  of(app: string): string[] {
    return (this.db
      .prepare("SELECT community_slug FROM community_members WHERE app_slug = ? ORDER BY community_slug")
      .all(app) as Array<{ community_slug: string }>).map((r) => r.community_slug);
  }

  isSteward(slug: string, principal: Principal): boolean {
    if (principal.anonymous || !principal.app) return false;
    return this.get(slug)?.stewards.includes(principal.app) ?? false;
  }

  /** Every version of every context the community names, as URIs. */
  contextUris(slug: string): string[] {
    const c = this.get(slug);
    if (!c) return [];
    return c.contexts.flatMap((s) => this.store.contextsWithSlug(s).map((m) => m.uri));
  }

  /** The operator creates; the operator or a steward updates. Returns the stored community. */
  upsert(input: CommunityInput, actor: Principal = OPERATOR): { community: Community; created: boolean } {
    if (!SLUG_RE.test(input.slug ?? "")) {
      throw new PublishError("ERR_COMMUNITY_SLUG_INVALID", `invalid community slug ${JSON.stringify(input.slug)}`, {
        guidance: "Lowercase letters, digits and hyphens, 2–40 characters, starting with a letter.",
      });
    }
    const existing = this.get(input.slug);
    const operator = actor.tier === "operator" && !actor.anonymous;
    if (!existing && !operator) {
      throw new PublishError("ERR_OPERATOR_ONLY", "only the catalog operator can create a community", {
        guidance: "Ask the operator; say which contexts, jurisdictions and steward apps it should have.",
      });
    }
    if (existing && !operator && !this.isSteward(input.slug, actor)) {
      throw new PublishError("ERR_NOT_STEWARD", `only the operator or a steward of "${input.slug}" can change it`, {
        guidance: `Its stewards: ${existing.stewards.join(", ") || "(none yet)"}.`,
      });
    }
    if (input.stewards !== undefined && !operator) {
      throw new PublishError("ERR_OPERATOR_ONLY", "only the catalog operator can change a community's stewards", {
        guidance: "Leave `stewards` out to keep them as they are.",
      });
    }

    const title = (input.title ?? existing?.title ?? "").trim();
    const charter = (input.charter ?? existing?.charter ?? "").trim();
    if (!title) throw new PublishError("ERR_COMMUNITY_TITLE_REQUIRED", "a community needs a title");
    if (charter.length < 40) {
      throw new PublishError("ERR_COMMUNITY_CHARTER_TOO_SHORT", "the charter must say, in 40 characters or more, who the community is for and what it covers");
    }
    const contexts = [...new Set(input.contexts ?? existing?.contexts ?? [])];
    if (contexts.length > MAX_CONTEXTS) {
      throw new PublishError("ERR_COMMUNITY_TOO_MANY_CONTEXTS", `at most ${MAX_CONTEXTS} contexts`);
    }
    const unknown = contexts.filter((s) => this.store.contextsWithSlug(s).length === 0);
    if (unknown.length) {
      throw new PublishError("ERR_UNKNOWN_CONTEXT", `no context with slug ${unknown.join(", ")}`, {
        guidance: "Name existing context slugs (lattice_list_context with {} lists them). A steward creates a new one with lattice_publish_context and `community`.",
      });
    }
    const jurisdictions = [...new Set(input.jurisdictions ?? existing?.jurisdictions ?? [])];
    const badJ = jurisdictions.filter((j) => !JURISDICTION_RE.test(j));
    if (badJ.length) {
      throw new PublishError("ERR_JURISDICTION_INVALID", `jurisdictions must look like US, US-CT or US-CT/new-haven: ${badJ.join(", ")}`);
    }
    const stewards = [...new Set(input.stewards ?? existing?.stewards ?? [])];
    const unregistered = stewards.filter((s) => !this.db.prepare("SELECT 1 FROM apps WHERE slug = ?").get(s));
    if (unregistered.length) {
      throw new PublishError("ERR_UNKNOWN_APP", `stewards must be registered apps: ${unregistered.join(", ")}`);
    }
    const conventions = input.conventions !== undefined ? input.conventions.trim() || null : existing?.conventions ?? null;
    if (conventions && conventions.length > 4000) {
      throw new PublishError("ERR_COMMUNITY_CONVENTIONS_TOO_LONG", "conventions must be 4000 characters or fewer; link a longer document instead");
    }

    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO communities (slug, title, charter, contexts, jurisdictions, stewards, conventions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title=excluded.title, charter=excluded.charter, contexts=excluded.contexts,
         jurisdictions=excluded.jurisdictions, stewards=excluded.stewards, conventions=excluded.conventions,
         updated_at=excluded.updated_at`,
    ).run(input.slug, title, charter, JSON.stringify(contexts), JSON.stringify(jurisdictions),
      JSON.stringify(stewards), conventions, existing?.createdAt ?? now, now);
    this.store.logEvent(existing ? "community_update" : "community_create", { slug: input.slug, actor: actorName(actor) });
    return { community: this.get(input.slug)!, created: !existing };
  }

  /** A steward created a context for the community: it joins the community's list. */
  addContext(slug: string, contextSlug: string): void {
    const c = this.get(slug);
    if (!c || c.contexts.includes(contextSlug)) return;
    this.db.prepare("UPDATE communities SET contexts = ?, updated_at = ? WHERE slug = ?")
      .run(JSON.stringify([...c.contexts, contextSlug]), new Date().toISOString(), slug);
  }

  /** Replace an app's memberships (from its registration). Unknown communities are refused. */
  setMemberships(app: string, communities: string[]): void {
    const wanted = [...new Set(communities)];
    const unknown = wanted.filter((s) => !this.get(s));
    if (unknown.length) {
      throw new PublishError("ERR_UNKNOWN_COMMUNITY", `no community ${unknown.join(", ")}`, {
        guidance: "lattice_community_report with {} lists the communities.",
      });
    }
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM community_members WHERE app_slug = ?").run(app);
      const ins = this.db.prepare("INSERT INTO community_members (community_slug, app_slug, joined_at) VALUES (?, ?, ?)");
      for (const s of wanted) ins.run(s, app, now);
    });
    tx();
  }

  /** Newest concepts in the community's contexts, latest versions only. */
  recentConcepts(slug: string, superseded: Set<string>, limit = 15): Array<{ uri: string; createdAt: string }> {
    const c = this.get(slug);
    if (!c || c.contexts.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT uri, created_at FROM concepts WHERE context_slug IN (${c.contexts.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`)
      .all(...c.contexts, limit * 3) as Array<{ uri: string; created_at: string }>;
    return rows.filter((r) => !superseded.has(r.uri)).slice(0, limit).map((r) => ({ uri: r.uri, createdAt: r.created_at }));
  }
}

function actorName(p: Principal): string {
  if (p.anonymous) return "anonymous";
  return p.app ? `app:${p.app}` : "operator";
}
