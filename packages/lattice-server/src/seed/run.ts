// CLI entry: `npm run seed` — boots the default instance, seeds the
// skeleton, and backfills the vector index (M2).

import { join } from "node:path";
import { LatticeInstance } from "../server/instance.ts";

async function main() {
  const instance = await LatticeInstance.create({
    dataDir: join(process.cwd(), "var"),
  });
  const result = instance.seed;
  console.log(
    `seeded context=${result.contextUri} (new=${result.createdContext}) concepts=${result.createdConcepts} indexed=${instance.vectors.count()}`,
  );
  for (const [slug, uri] of result.conceptUris) {
    console.log(`  ${slug.padEnd(16)} ${uri}`);
  }
  instance.close();
}

main();
