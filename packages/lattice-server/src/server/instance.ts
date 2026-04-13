// In-process server façade. HTTP/MCP wrappers will layer on top later.
//
// Holds the Store, the seed result, and the ancestry context so the
// R1 gate has the skeleton URI set on hand.

import { join } from "node:path";
import { Store } from "../storage/db.ts";
import { seedSkeleton, skeletonUris, type SeedResult } from "../seed/seed.ts";
import {
  publishConcept,
  type PublishConceptInput,
  type PublishConceptOk,
} from "../publish/publish.ts";
import type { AncestryContext } from "../publish/ancestry.ts";
import type { ConceptRecord } from "../hashing/types.ts";

export interface InstanceOptions {
  dataDir: string;
}

export class LatticeInstance {
  readonly store: Store;
  readonly seed: SeedResult;
  readonly ancestryCtx: AncestryContext;

  constructor(opts: InstanceOptions) {
    this.store = new Store({
      dbPath: join(opts.dataDir, "dev.db"),
      blobDir: join(opts.dataDir, "blobs"),
    });
    this.seed = seedSkeleton(this.store);
    this.ancestryCtx = { skeletonUris: skeletonUris(this.seed) };
  }

  publishConcept(input: PublishConceptInput): PublishConceptOk {
    return publishConcept(this.store, this.ancestryCtx, input);
  }

  resolve(uri: string): ConceptRecord | null {
    return this.store.getConcept(uri);
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
