// Evidence ledger phase 1 (specs/evidence-ledger.md): match feedback.
//
// Most checks play an attacker — many sessions from one network, many
// anonymous networks, brand-new apps, claims about results never shown —
// and every attack must fail to promote. The honest path must still work.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { ANONYMOUS } from "../src/server/principals.ts";
import { EvidenceRejected, networkPrefix } from "../src/evidence/ledger.ts";
import type { DiscoverCandidate } from "../src/discover/discover.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const DAY = 86_400_000;

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-evidence-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const ledger = instance.evidence;
  const T0 = new Date();
  const at = (days: number) => new Date(T0.getTime() + days * DAY);

  const QUERY = "a recorded boat trip on the water with a measured GPS track";
  const OTHER_QUERY = "a tax invoice issued by a supplier to a customer";

  // One session per source, each actually shown the results and resolving the one it judges.
  let sessionN = 0;
  async function sessionShowing(query: string, opts: { ephemeral?: boolean } = {}) {
    const sessionId = `sess-test-${++sessionN}`;
    const res = await instance.discover({ description: query, sessionId, limit: 10, ...opts });
    return { sessionId, results: res.results, verdict: res.verdict };
  }
  async function claim(
    source: string,
    conceptUri: string,
    verdict: "wrong" | "right",
    now: Date,
    opts: { query?: string; resolve?: boolean; ephemeral?: boolean } = {},
  ) {
    const s = await sessionShowing(opts.query ?? QUERY, { ephemeral: opts.ephemeral });
    if (opts.resolve !== false) instance.resolve(conceptUri, s.sessionId);
    return ledger.proposeMatch(
      { sessionId: s.sessionId, conceptUri, verdict, ...(verdict === "wrong" ? { reason: "different-referent" } : {}) },
      source,
      now,
    );
  }
  async function app(slug: string, established: boolean) {
    await callTool(instance, "lattice_register_app", {
      slug, name: slug, unit: "test", owner: "test", status: "experiment", concepts: [],
    }, ANONYMOUS);
    if (established) {
      instance.store.db.prepare("UPDATE apps SET registered_at = ? WHERE slug = ?").run(at(-40).toISOString(), slug);
      instance.store.logEvent("published", { test: true }, `app:${slug}`);
    }
    return `app:${slug}`;
  }
  const stateOf = (conceptUri: string, direction = "wrong") =>
    (instance.store.db
      .prepare("SELECT status, score, sources FROM claim_state WHERE claim_key LIKE ? AND direction = ?")
      .get(`match|${conceptUri}|%`, direction) as { status: string; score: number; sources: number } | undefined);

  const base = await sessionShowing(QUERY);
  const uris = base.results.map((r) => r.uri);
  check("setup-has-candidates", uris.length >= 6, `${uris.length} results`);
  const [X, Y, Z, W, V, U] = uris;

  // --- claims the server can reject outright --------------------------------
  const unseen = await sessionShowing(OTHER_QUERY);
  const notShown = uris.find((u) => !unseen.results.some((r) => r.uri === u))!;
  let rejected = "";
  try {
    await ledger.proposeMatch({ sessionId: unseen.sessionId, conceptUri: notShown, verdict: "wrong", reason: "wrong-domain" }, "net:x", T0);
  } catch (err) {
    rejected = err instanceof EvidenceRejected ? err.message : String(err);
  }
  check("cannot-judge-a-result-never-shown", rejected.includes("never shown"), rejected.slice(0, 70));

  rejected = "";
  try {
    await ledger.proposeMatch({ sessionId: "sess-made-up", conceptUri: X, verdict: "wrong", reason: "wrong-domain" }, "net:x", T0);
  } catch (err) {
    rejected = String((err as Error).message);
  }
  check("cannot-judge-from-an-invented-session", rejected.includes("never shown"));

  rejected = "";
  try {
    await ledger.proposeMatch({ sessionId: base.sessionId, conceptUri: X, verdict: "wrong" }, "net:x", T0);
  } catch (err) {
    rejected = String((err as Error).message);
  }
  check("wrong-needs-a-reason", rejected.includes("needs a reason"));

  // --- sources --------------------------------------------------------------
  const a1 = ledger.sourceOf(ANONYMOUS, "203.0.113.7");
  const a2 = ledger.sourceOf(ANONYMOUS, "203.0.113.200");
  const a3 = ledger.sourceOf(ANONYMOUS, "198.51.100.7");
  check("one-network-is-one-source", a1 === a2 && a1 !== a3 && !a1.includes("203.0.113"), `${a1} / ${a3}`);
  check(
    "ipv6-groups-by-48",
    networkPrefix("2001:db8:abcd:12::1") === networkPrefix("2001:db8:abcd:ffff::9") &&
      networkPrefix("2001:db8:abcd::1") !== networkPrefix("2001:db8:abce::1"),
  );

  // Many sessions from one network count once.
  for (let i = 0; i < 12; i++) await claim(a1, U, "wrong", T0);
  const uRows = (instance.store.db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE subject = ?").get(U) as { n: number }).n;
  check("many-sessions-one-network-count-once", uRows === 1, `${uRows} ledger row(s)`);

  // --- anonymous-only never promotes -----------------------------------------
  for (let i = 0; i < 6; i++) await claim(`net:anon-only-${i}`, X, "wrong", T0);
  ledger.rescore(at(30));
  const xState = stateOf(X);
  check(
    "anonymous-only-never-promotes",
    xState?.status === "pending" && xState.score >= 5,
    `status=${xState?.status} score=${xState?.score} sources=${xState?.sources}`,
  );

  // --- brand-new apps are weight 1 --------------------------------------------
  for (const slug of ["fresh-a", "fresh-b", "fresh-c"]) await claim(await app(slug, false), Z, "wrong", T0);
  ledger.rescore(at(30));
  check("new-apps-alone-do-not-promote", stateOf(Z)?.status === "pending", `score=${stateOf(Z)?.score}`);

  // --- the honest path: quarantine, then promotion ---------------------------
  const est1 = await app("harbor-app", true);
  const est2 = await app("dive-app", true);
  await claim(est1, Y, "wrong", T0);
  await claim(est2, Y, "wrong", T0);
  await claim("net:honest-1", Y, "wrong", T0);
  ledger.rescore(at(3));
  check("quarantine-holds-before-7-days", stateOf(Y)?.status === "pending", `score=${stateOf(Y)?.score}`);
  ledger.rescore(at(8));
  check("two-established-apps-plus-one-network-promote", stateOf(Y)?.status === "promoted", `score=${stateOf(Y)?.score}`);

  const again = await instance.discover({ description: QUERY, limit: 10 });
  const yNow = again.results.find((r) => r.uri === Y) as DiscoverCandidate | undefined;
  check(
    "promoted-wrong-shows-a-caution",
    !!yNow?.evidence?.caution && yNow.evidence.caution.reason === "different-referent",
    JSON.stringify(yNow?.evidence?.caution ?? null),
  );
  check(
    "demotion-is-bounded",
    !!yNow && yNow.adjustedSimilarity !== undefined && Math.abs(yNow.similarity - yNow.adjustedSimilarity - 0.05) < 1e-6,
    `raw=${yNow?.similarity} adjusted=${yNow?.adjustedSimilarity}`,
  );
  check("verdict-stays-on-raw-score", again.verdict === base.verdict, `${base.verdict} → ${again.verdict}`);

  const unrelated = await instance.discover({ description: OTHER_QUERY, limit: 20 });
  const yUnrelated = unrelated.results.find((r) => r.uri === Y);
  check("caution-only-for-similar-queries", !yUnrelated || !yUnrelated.evidence, yUnrelated ? "present" : "not in results");

  // --- opposition retracts ----------------------------------------------------
  const est3 = await app("marina-app", true);
  const est4 = await app("club-app", true);
  await claim(est3, Y, "right", at(9));
  await claim(est4, Y, "right", at(9));
  ledger.rescore(at(9));
  check("opposition-retracts", stateOf(Y)?.status === "retracted", `score=${stateOf(Y)?.score}`);
  const afterRetract = await instance.discover({ description: QUERY, limit: 10 });
  check("retracted-evidence-stops-applying", !afterRetract.results.find((r) => r.uri === Y)?.evidence);

  // --- burst of anonymous networks is frozen ---------------------------------
  for (let i = 0; i < 10; i++) await claim(`net:burst-${i}`, W, "wrong", new Date(T0.getTime() + i * 60_000));
  await claim(await app("late-helper", true), W, "wrong", T0);
  ledger.rescore(at(30));
  check("burst-is-frozen-for-review", stateOf(W)?.status === "frozen", String(stateOf(W)?.status));

  // --- ephemeral sessions: counted, never clustered, wording never kept ------
  await claim("net:private-1", V, "wrong", T0, { ephemeral: true });
  const vRow = instance.store.db.prepare("SELECT cluster, query_vec FROM evidence WHERE subject = ?").get(V) as
    | { cluster: string; query_vec: Buffer | null }
    | undefined;
  check("ephemeral-keeps-no-query-vector", vRow?.cluster === "*" && vRow.query_vec === null, `cluster=${vRow?.cluster}`);
  ledger.rescore(at(30));
  check("ephemeral-claims-are-totals-only", stateOf(V)?.status === "totals-only");

  // --- idempotency and flipping ---------------------------------------------
  await claim("net:flipper", X, "wrong", T0);
  await claim("net:flipper", X, "right", at(1));
  const flip = instance.store.db
    .prepare("SELECT COUNT(*) AS n, MIN(polarity) AS p FROM evidence WHERE source = 'net:flipper'")
    .get() as { n: number; p: number };
  check("a-source-changing-its-mind-replaces-its-claim", flip.n === 1 && flip.p === -1);

  // --- operator controls ------------------------------------------------------
  // Re-promote Y's cause on a fresh concept, then retract it by hand.
  const T = uris[6] ?? uris[0];
  if (T !== X) {
    await claim(await app("ops-a", true), T, "wrong", T0);
    await claim(await app("ops-b", true), T, "wrong", T0);
    await claim("net:ops-c", T, "wrong", T0);
    ledger.rescore(at(8));
    const key = (instance.store.db.prepare("SELECT claim_key FROM evidence WHERE subject = ? LIMIT 1").get(T) as { claim_key: string }).claim_key;
    ledger.admin("retract", key, "test");
    ledger.rescore(at(9));
    check("operator-retraction-sticks", stateOf(T)?.status === "operator-retracted", String(stateOf(T)?.status));
  }
  ledger.admin("purge-source", "net:flipper", "test");
  check(
    "purge-removes-a-source",
    (instance.store.db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE source = 'net:flipper'").get() as { n: number }).n === 0,
  );

  // --- tool surface -----------------------------------------------------------
  const s = await sessionShowing(QUERY);
  const viaTool = (await callTool(
    instance, "lattice_propose",
    { sessionId: s.sessionId, conceptUri: s.results[0].uri, verdict: "right" },
    ANONYMOUS, { clientAddress: "192.0.2.44" },
  )) as { status?: string; corroboration?: { nonAnonymousNeeded: boolean } };
  check("anonymous-can-propose", viaTool.status === "pending" && viaTool.corroboration?.nonAnonymousNeeded === true, JSON.stringify(viaTool).slice(0, 100));

  const anonAdmin = (await callTool(instance, "lattice_evidence_admin", { action: "switch", target: "apply", on: false }, ANONYMOUS)) as any;
  check("anonymous-cannot-administer", anonAdmin?.error?.details?.latticeCode === "ERR_NOT_AUTHENTICATED");
  const appAdmin = (await callTool(instance, "lattice_evidence_admin", { action: "switch", target: "apply", on: false }, { app: "harbor-app", tier: "contributor", anonymous: false })) as any;
  check("apps-cannot-administer", appAdmin?.error?.details?.latticeCode === "ERR_OPERATOR_ONLY");

  const report = (await callTool(instance, "lattice_evidence_report", {})) as any;
  check(
    "report-is-public-and-carries-the-notice",
    typeof report.notice === "string" && report.counts.frozen >= 1 && Array.isArray(report.claims),
    JSON.stringify(report.counts),
  );

  // Kill switch: stop applying.
  await callTool(instance, "lattice_evidence_admin", { action: "switch", target: "apply", on: false });
  await claim(await app("ks-a", true), U, "wrong", T0);
  await claim(await app("ks-b", true), U, "wrong", T0);
  ledger.rescore(at(8));
  const off = await instance.discover({ description: QUERY, limit: 10 });
  check("apply-switch-off-means-no-effect", off.results.every((r) => !r.evidence));
  await callTool(instance, "lattice_evidence_admin", { action: "switch", target: "apply", on: true });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
