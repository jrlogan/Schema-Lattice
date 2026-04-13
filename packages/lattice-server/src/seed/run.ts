// CLI entry: `npm run seed` — boots the default store and seeds the skeleton.

import { join } from "node:path";
import { Store } from "../storage/db.ts";
import { seedSkeleton } from "./seed.ts";

function main() {
  const varDir = join(process.cwd(), "var");
  const store = new Store({
    dbPath: join(varDir, "dev.db"),
    blobDir: join(varDir, "blobs"),
  });
  const result = seedSkeleton(store);
  console.log(
    `seeded context=${result.contextUri} (new=${result.createdContext}) concepts=${result.createdConcepts}`,
  );
  for (const [slug, uri] of result.conceptUris) {
    console.log(`  ${slug.padEnd(16)} ${uri}`);
  }
  store.close();
}

main();
