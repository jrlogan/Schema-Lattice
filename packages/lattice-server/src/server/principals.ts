// Who is writing, and how much a mistake by them costs.
//
// The catalog is content-addressed and immutable: a published concept cannot be
// edited and cannot meaningfully be deleted, so access control has to sit BEFORE
// minting — there is no moderating it afterwards. Capabilities are therefore
// graded by blast radius rather than by seniority:
//
//   fork       additive, lineage-preserving, the safest write — never budgeted
//   originate  the claim "nothing like this exists" — the pollution vector
//   context    a namespace the whole catalog then lives with — the land grab
//
// Quality is NOT graded here. Every writer, operator included, goes through the
// same friction gates in publish/friction.ts. This file answers "who, and how
// much", never "is it any good".

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TIERS = ["low", "contributor", "operator"] as const;
export type Tier = (typeof TIERS)[number];

export interface Principal {
  /** Registered app slug. Null for the operator key and for anonymous callers. */
  app: string | null;
  tier: Tier;
  anonymous: boolean;
  /**
   * Why an anonymous caller is anonymous. Sending no key and sending one that
   * did not arrive are different mistakes: telling an operator whose key was
   * blank to "register your app" sends them the wrong way.
   */
  credential?: CredentialProblem;
}

/**
 * none: no Authorization header. empty: `Bearer ` with nothing after it —
 * usually an unset shell variable. malformed: a header that is not
 * `Bearer <key>`. unrecognised: a key that matches nothing — reissued,
 * truncated, or meant for another instance.
 */
export type CredentialProblem = "none" | "empty" | "malformed" | "unrecognised";

export const OPERATOR: Principal = { app: null, tier: "operator", anonymous: false };
export const ANONYMOUS: Principal = { app: null, tier: "low", anonymous: true, credential: "none" };

export function anonymousBecause(credential: CredentialProblem): Principal {
  return { ...ANONYMOUS, credential };
}

/** What to tell a caller whose key was not accepted, by why it was not. */
export function credentialGuidance(credential: CredentialProblem = "none"): { message: string; guidance: string } {
  switch (credential) {
    case "empty":
      return {
        message: "the Authorization header was sent with an empty key",
        guidance:
          "The header read `Bearer ` with nothing after it, which usually means the variable holding the key " +
          "was unset in the shell that sent it. Check the key is actually in the request. If you have no key " +
          "yet, lattice_register_app issues one immediately.",
      };
    case "malformed":
      return {
        message: "the Authorization header is not in the form `Bearer <key>`",
        guidance: "Send `Authorization: Bearer <key>`, with the word Bearer, one space, then the key.",
      };
    case "unrecognised":
      return {
        message: "the key sent does not match any app or the operator",
        guidance:
          "It may have been reissued (lattice_reissue_app_key invalidates the old one), copied incompletely, or " +
          "be for a different lattice instance. Registering again under the same slug needs the current key; " +
          "a lost key is reissued by the operator.",
      };
    default:
      return {
        message: "no API key was sent",
        guidance:
          "Call lattice_register_app to register your app and receive a key. It is issued immediately, no " +
          "approval needed. Reads never require a key.",
      };
  }
}

export function appPrincipal(app: string, tier: Tier): Principal {
  return { app, tier, anonymous: false };
}

/**
 * How an event names its cause. Operator writes are attributable too — an
 * unattributed audit log is the thing we are fixing, so there is no exemption.
 */
export function actorOf(p: Principal): string {
  if (p.anonymous) return "anonymous";
  return p.app === null ? "operator" : `app:${p.app}`;
}

/** Originations allowed per rolling 24h. Null means unbounded. */
export const ORIGINATE_BUDGET: Record<Tier, number | null> = {
  low: 3,
  contributor: null,
  operator: null,
};

export interface Denial {
  code: string;
  message: string;
  guidance: string;
}

/** Tools a self-serve key may never call, and why. */
export function checkCapability(p: Principal, tool: string): Denial | null {
  if (p.anonymous) {
    // The one write an unknown agent may make: claim a new app slug and get a
    // key for it. Re-registering a slug that already exists is refused inside
    // the registry, so this door only ever creates, never overwrites.
    if (tool === "lattice_register_app") return null;
    const { message, guidance } = credentialGuidance(p.credential);
    return {
      code: "ERR_NOT_AUTHENTICATED",
      message: `${tool} writes to the catalog and requires an API key: ${message}`,
      guidance,
    };
  }
  if (tool === "lattice_publish_context" && p.tier === "low") {
    return {
      code: "ERR_TIER_TOO_LOW",
      message: "creating a context is restricted to contributor tier and above",
      guidance:
        "A context is a namespace every later concept inherits, and it cannot be renamed. " +
        "Publish into an existing context (lattice_list_context with no arguments lists every " +
        "one), or ask " +
        "the catalog operator to promote your app.",
    };
  }
  if (
    (tool === "lattice_set_app_tier" || tool === "lattice_reissue_app_key" || tool === "lattice_evidence_admin") &&
    p.tier !== "operator"
  ) {
    return {
      code: "ERR_OPERATOR_ONLY",
      message:
        tool === "lattice_evidence_admin"
          ? "only the catalog operator can administer evidence"
          : "only the catalog operator can change an app's tier",
      guidance: "Ask the operator of this instance.",
    };
  }
  return null;
}

/** Denial for an exhausted daily origination budget. */
export function budgetDenial(tier: Tier, used: number, budget: number): Denial {
  return {
    code: "ERR_ORIGINATE_BUDGET",
    message: `${tier} tier may originate ${budget} concepts per day; ${used} already used`,
    guidance:
      "Forking is not budgeted — if an existing concept is close, lattice_publish_fork " +
      "preserves lineage and is the better move anyway. Otherwise wait for the window to " +
      "roll, or ask the operator to promote your app.",
  };
}

const KEY_PREFIX = "slk_";

export function mintKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("hex");
}

/** Keys are stored hashed: a stolen database must not be a stolen key ring. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function looksLikeAppKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

/** Constant-time compare for the single operator key from the environment. */
export function matchesOperatorKey(token: string, configured: string): boolean {
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
