// The reserved governance vocabulary, seeded at boot alongside the
// skeleton (see specs/data-classification.md).
//
// This is infrastructure vocabulary, not domain vocabulary — the JIT
// mining philosophy ("the lattice starts empty") applies to domain
// concepts; classification classes and the attestation shape are part
// of the protocol itself, like the skeleton. The classes are
// deliberately organization-neutral: they fit a makerspace's member
// records, a dive club's waivers, or a city's resident data equally.
//
// `sensitivityRank` is a rough ordinal (0 = public … 6 = secrets) so
// tools can compute a manifest's sensitivity profile. It is metadata,
// not hashed, and it is NOT a policy: mapping ranks to review tiers or
// handling rules is the adopting organization's job.

export interface GovernanceNode {
  slug: string;
  prefLabel: string;
  definition: string;
  conceptKind: string;
  broaderSkeletonSlug: string;
  closeMatch: string[];
  sensitivityRank?: number;
  /** Provenance classes only: how much the capture itself proves (0 = nothing). */
  assuranceRank?: number;
  structure?: unknown;
  /** The node this one replaces: its URI becomes this record's previousVersion. */
  previous?: GovernanceNode;
}

export const GOVERNANCE_CONTEXT_SLUG = "governance";
export const GOVERNANCE_CONTEXT_LABEL = "SchemaLattice Governance Vocabulary";
export const GOVERNANCE_CONTEXT_DEFINITION =
  "Reserved context for protocol-level vocabulary: data-sensitivity classes usable in any field's classification, and the attestation record shape shared by build-time gates. See specs/data-classification.md.";

export const DATA_CLASS_NODES: GovernanceNode[] = [
  {
    slug: "public",
    prefLabel: "Public",
    definition:
      "Information that can be freely shared outside the organization without harm — published schedules, open datasets, catalog descriptions.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    sensitivityRank: 0,
  },
  {
    slug: "internal",
    prefLabel: "Internal",
    definition:
      "Operational information meant for members or staff of the organization; disclosure would cause inconvenience but not damage — shift notes, usage counts, equipment states.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    sensitivityRank: 1,
  },
  {
    slug: "confidential",
    prefLabel: "Confidential",
    definition:
      "Restricted organizational information whose disclosure would cause real harm — contracts under negotiation, unreleased plans, incident or investigation notes.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    sensitivityRank: 2,
  },
  {
    slug: "personal-contact",
    prefLabel: "Personal Contact",
    definition:
      "Ways to reach an identifiable person: a name paired with an email address, phone number, postal address, or messaging handle.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv-pd:Contact", "dpv:PersonalData"],
    sensitivityRank: 3,
  },
  {
    slug: "personal-identity",
    prefLabel: "Personal Identity",
    definition:
      "Information that strongly identifies a specific person: government identifier numbers, date of birth, photographs of the person, or biometric data.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv-pd:Identifying", "dpv:PersonalData"],
    sensitivityRank: 4,
  },
  {
    slug: "personal-financial",
    prefLabel: "Personal Financial",
    definition:
      "A person's payment or financial details: card or account numbers, billing history, dues, salary, or transaction records tied to them.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv-pd:Financial", "dpv:PersonalData"],
    sensitivityRank: 4,
  },
  {
    slug: "personal-location",
    prefLabel: "Personal Location",
    definition:
      "Where a particular person was or is: precise coordinates, a home address, check-ins, or a track tied to the person or their device. A pothole's position is not personal; the route a volunteer walked while recording it is.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv-pd:Location"],
    sensitivityRank: 3,
  },
  {
    slug: "personal-health",
    prefLabel: "Personal Health",
    definition:
      "Information about a person's physical or mental condition: medical notes, injuries, allergies, disabilities, or fitness-to-participate records such as waivers.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv-pd:Health", "dpv:SpecialCategoryPersonalData"],
    sensitivityRank: 5,
  },
  {
    slug: "personal-minor",
    prefLabel: "Personal Minor",
    definition:
      "Any information about a person known to be under the age of majority; combines with the other classes and raises their handling requirements.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: ["dpv:PersonalData"],
    sensitivityRank: 5,
  },
  {
    slug: "access-secret",
    prefLabel: "Access Secret",
    definition:
      "Values that grant system entry on their own: passwords, API keys, tokens, door codes, or recovery answers. Distinct from a person's earned qualifications.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    sensitivityRank: 6,
  },
];

// Capture-provenance classes (specs/lifecycle-and-provenance.md): how a
// field's value came into being, ordered by how much the capture itself
// proves. They answer a different question from the data classes above —
// "how far can I trust where this came from", not "how careful must I be
// with it" — so a field may carry one of each. Organization-neutral like
// the data classes: they fit a trail group's before-and-after photos, a
// clinic's intake form, or a sensor's readings.
//
// `assuranceRank` is metadata (not hashed) and, like sensitivityRank, NOT
// a policy: which rank a prize, an audit or a grant requires is the
// adopting party's decision.
export const PROVENANCE_NODES: GovernanceNode[] = [
  {
    slug: "self-reported",
    prefLabel: "Self-Reported",
    definition:
      "A value a person states without any accompanying capture evidence — typed hours worked, a remembered date, a described condition taken on trust.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    assuranceRank: 0,
  },
  {
    slug: "uploaded",
    prefLabel: "Uploaded",
    definition:
      "A file supplied after the fact from someone's own storage, whose origin rests only on the metadata it carries, such as a phone photo's embedded time and coordinates.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    assuranceRank: 1,
  },
  {
    slug: "device-captured",
    prefLabel: "Device-Captured",
    definition:
      "Recorded by the receiving app at the moment of capture, with the device's own clock and position, but without a cryptographic seal proving the app or the content was untouched.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    assuranceRank: 2,
  },
  {
    slug: "attested-capture",
    prefLabel: "Attested Capture",
    definition:
      "Captured live and signed by an app or camera whose integrity the platform vouches for, so any later edit or substitution is detectable — a sealed camera app, or content credentials applied in-camera.",
    conceptKind: "classification",
    broaderSkeletonSlug: "classification",
    closeMatch: [],
    assuranceRank: 3,
  },
];

// The shared attestation record shape: one generic form for "a named
// check ran against a subject system and produced a result." Security
// reviews, privacy checks, accessibility audits, and any future gate
// all instantiate this rather than inventing their own result format.
export const ATTESTATION_NODE: GovernanceNode = {
  slug: "attestation",
  prefLabel: "Attestation",
  definition:
    "A dated record that a named check was performed against a subject system by an identified party, with the outcome and a pointer to detailed findings. One shape shared by security reviews, privacy checks, accessibility audits, and similar gates.",
  conceptKind: "entity",
  broaderSkeletonSlug: "record",
  closeMatch: ["prov:Entity"],
  structure: {
    kind: "entity",
    fields: [
      { name: "subject", type: "string", required: true },
      { name: "gate", type: "string", required: true },
      { name: "gateVersion", type: "string" },
      { name: "result", type: "string", required: true },
      { name: "performedBy", type: "string", required: true },
      { name: "performedOn", type: "date", required: true },
      { name: "findingsRef", type: "string" },
      { name: "notes", type: "string" },
    ],
  },
};

// What a person agreed to when a record they made is passed on: a volunteer's
// street observation forwarded to the city's 311, a survey answer shared with
// a partner group. Vocabulary only, like the classes: whether consent is
// required, and what counts as consent, is the adopting party's decision.
const FORWARDING_CONSENT_V1: GovernanceNode = {
  slug: "forwarding-consent",
  prefLabel: "Forwarding Consent",
  definition:
    "A person's agreement that a record they made may be sent to a named recipient, with which fields are included, when they agreed and how, and whether they have since withdrawn it.",
  conceptKind: "entity",
  broaderSkeletonSlug: "record",
  closeMatch: ["dpv:Consent"],
  structure: {
    kind: "entity",
    fields: [
      { name: "subjectRecord", type: "reference", required: true },
      { name: "recipient", type: "string", required: true },
      { name: "purpose", type: "string" },
      { name: "includedFields", type: "string[]" },
      { name: "identityShared", type: "boolean" },
      { name: "grantedAt", type: "dateTime", required: true },
      { name: "method", type: "string" },
      { name: "withdrawnAt", type: "dateTime" },
    ],
  },
};

// v2 (2026-10-29), from the Garden BioBlitz case study: a school group's
// records are consented to by a parent or guardian, not the student.
export const FORWARDING_CONSENT_NODE: GovernanceNode = {
  ...FORWARDING_CONSENT_V1,
  definition:
    "A person's agreement that a record they made may be sent to a named recipient, with which fields are included, who gave the agreement (the person, or a parent or guardian for a minor), when and how, and whether it has since been withdrawn.",
  structure: {
    kind: "entity",
    fields: [
      ...(FORWARDING_CONSENT_V1.structure as { fields: unknown[] }).fields,
      { name: "grantedBy", type: "enum", values: ["self", "parent-or-guardian", "organization"], required: true },
      { name: "subjectIsMinor", type: "boolean" },
    ],
  },
  previous: FORWARDING_CONSENT_V1,
};

export const GOVERNANCE_NODES: GovernanceNode[] = [
  ...DATA_CLASS_NODES,
  ...PROVENANCE_NODES,
  ATTESTATION_NODE,
  FORWARDING_CONSENT_NODE,
];
