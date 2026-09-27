// In-process server façade. HTTP/MCP wrappers will layer on top later.
//
// Construction is async as of M2 (embedding model + index backfill), so
// use `await LatticeInstance.create(...)`. Holds the Store, the seed
// result, the ancestry context, the embedder, and the vector index.

import { join } from "node:path";
import { Store } from "../storage/db.ts";
import { BASE_AUTHORITY } from "../hashing/hash.ts";
import { seedSkeleton, skeletonUris, type SeedResult } from "../seed/seed.ts";
import { seedGovernance, type GovernanceSeedResult } from "../seed/governance.ts";
import {
  sensitivityProfile,
  type SensitivityProfile,
} from "../publish/classification.ts";
import {
  publishConcept,
  embeddingText,
  type PublishConceptInput,
  type PublishConceptOk,
} from "../publish/publish.ts";
import type { AncestryContext } from "../publish/ancestry.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { TransformersEmbedder, type Embedder } from "../discover/embedder.ts";
import { VectorIndex } from "../discover/vectors.ts";
import {
  discover,
  type DiscoverInput,
  type DiscoverResponse,
} from "../discover/discover.ts";
import { Registry } from "../registry/registry.ts";
import {
  publishContext,
  type PublishContextInput,
  type PublishContextOk,
} from "../publish/context.ts";
import {
  publishFork,
  type PublishForkInput,
  type PublishForkOk,
} from "../publish/fork.ts";
import {
  listContext,
  conceptStats,
  type ListContextResponse,
  type ConceptStats,
} from "../query/stats.ts";
import { demandReport, type DemandReport } from "../query/demand.ts";

export interface InstanceOptions {
  dataDir: string;
  /** Override the embedding runtime (tests, alternative models). */
  embedder?: Embedder;
}

/**
 * The authority is inside the hash (`specs/hashing-rules.md` — `inScheme` and every
 * relation URI are hashed), so changing it re-mints the whole catalog. A store written
 * under one authority therefore cannot be served under another: seeding would lay a
 * second namespace beside the first, `broader` and `forkedFrom` chains would point at
 * URIs that no longer exist, and ancestry walks would fail one lineage at a time
 * instead of all at once. Refuse the boot rather than corrupt quietly.
 *
 * Checked before seeding, because seeding is itself a write.
 */
function assertAuthorityMatches(store: Store): void {
  const foreign = store
    .listConceptUris()
    .find((uri) => !uri.startsWith(`${BASE_AUTHORITY}/`));
  if (foreign === undefined) return;
  const theirs = foreign.slice(0, foreign.indexOf("/c/"));
  throw new Error(
    `this catalog was minted under ${theirs}, but the build mints ${BASE_AUTHORITY}.\n` +
      `Changing the authority re-mints every URI — there is no in-place rename. Either ` +
      `restore BASE_AUTHORITY to ${theirs}, or point LATTICE_DATA_DIR at a fresh directory ` +
      `and re-publish. If anyone has recorded URIs from this instance, they must be ` +
      `re-resolved either way.`,
  );
}

export class LatticeInstance {
  readonly store: Store;
  readonly seed: SeedResult;
  readonly governance: GovernanceSeedResult;
  readonly ancestryCtx: AncestryContext;
  readonly embedder: Embedder;
  readonly vectors: VectorIndex;
  readonly registry: Registry;

  private constructor(opts: InstanceOptions) {
    this.store = new Store({
      dbPath: join(opts.dataDir, "dev.db"),
      blobDir: join(opts.dataDir, "blobs"),
    });
    assertAuthorityMatches(this.store);
    this.seed = seedSkeleton(this.store);
    this.governance = seedGovernance(this.store, this.seed);
    this.ancestryCtx = { skeletonUris: skeletonUris(this.seed) };
    this.embedder = opts.embedder ?? new TransformersEmbedder();
    this.vectors = new VectorIndex(this.store.db, this.embedder.dim, this.embedder.id);
    this.registry = new Registry({
      store: this.store,
      governance: this.governance,
      vectors: this.vectors,
    });
  }

  static async create(opts: InstanceOptions): Promise<LatticeInstance> {
    const instance = new LatticeInstance(opts);
    await instance.ensureIndexed();
    return instance;
  }

  /**
   * Backfill the vector index for any concept missing an embedding
   * (skeleton nodes on first boot, or a wiped index — embeddings are
   * derived data and fully rebuildable from blobs).
   */
  async ensureIndexed(): Promise<number> {
    const missing = this.store
      .listConceptUris()
      .filter((uri) => !this.vectors.has(uri));
    if (missing.length === 0) return 0;
    const texts = missing.map((uri) => {
      const record = this.store.getConcept(uri);
      return record ? embeddingText(record) : "";
    });
    const vecs = await this.embedder.embed(texts);
    for (let i = 0; i < missing.length; i++) {
      this.vectors.add(missing[i], vecs[i]);
    }
    return missing.length;
  }

  publishConcept(input: PublishConceptInput): Promise<PublishConceptOk> {
    return publishConcept(
      {
        store: this.store,
        ancestryCtx: this.ancestryCtx,
        embedder: this.embedder,
        vectors: this.vectors,
        governance: this.governance,
      },
      input,
    );
  }

  publishFork(input: PublishForkInput): Promise<PublishForkOk> {
    return publishFork(
      {
        store: this.store,
        ancestryCtx: this.ancestryCtx,
        embedder: this.embedder,
        vectors: this.vectors,
        governance: this.governance,
      },
      input,
    );
  }

  publishContext(input: PublishContextInput): PublishContextOk {
    return publishContext(this.store, input);
  }

  listContext(uri: string, limit?: number, offset?: number): ListContextResponse | null {
    return listContext(this.store, uri, limit, offset);
  }

  stats(uri: string): ConceptStats | null {
    return conceptStats(this.store, uri);
  }

  /** Catalog-wide counts, for the health and stats surfaces. */
  totals(): { concepts: number; contexts: number; events: number } {
    return this.store.totals();
  }

  /**
   * Aggregate field-level data classifications across a set of concept
   * URIs — typically a project manifest's concept list. Rank-to-policy
   * mapping is the adopting organization's, not the lattice's.
   */
  sensitivityProfile(conceptUris: string[]): SensitivityProfile {
    return sensitivityProfile(this.store, this.governance, conceptUris);
  }

  governanceUri(slug: string): string | undefined {
    return this.governance.conceptUris.get(slug);
  }

  discover(input: DiscoverInput): Promise<DiscoverResponse> {
    return discover(this.store, this.vectors, this.embedder, input, {
      // Governance data classes tag fields; they are not domain concepts
      // and must not crowd real candidates out of discovery.
      reservedContexts: [this.governance.contextUri],
    });
  }

  demandReport(opts?: { threshold?: number; limit?: number }): Promise<DemandReport> {
    return demandReport(
      {
        store: this.store,
        embedder: this.embedder,
        vectors: this.vectors,
        reservedContexts: [this.governance.contextUri],
      },
      opts,
    );
  }

  resolve(uri: string): ConceptRecord | null {
    const record = this.store.getConcept(uri);
    // DECISIONS.md § Learning loop: resolve is a tracked usage event.
    // Misses matter too — a stale-URI rate is a health signal.
    this.store.logEvent("resolve", { uri, found: record !== null });
    return record;
  }

  skeletonUri(slug: string): string | undefined {
    return this.seed.conceptUris.get(slug);
  }

  contextUri(): string {
    return this.seed.contextUri;
  }

  close(): void {
    this.store.close();
  }
}
