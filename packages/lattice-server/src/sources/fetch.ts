// Reading a public source's field list from its publisher (specs/public-sources.md
// § Field lists).
//
// Anyone may ask the server to read a URL, so this is the one place the server
// makes outbound requests on a stranger's behalf. The rules: HTTPS only, the
// address actually connected to must be public (checked in the socket's own
// DNS lookup, so a rebinding answer cannot slip an internal address past a
// check made earlier), no redirects, a time cap and a size cap.

import { request } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";

export const FETCH_LIMITS = {
  timeoutMs: 10_000,
  maxBytes: 4_000_000,
} as const;

export type Platform = "arcgis" | "socrata" | "manual";

export interface SourceField {
  name: string;
  type: string;
  label?: string;
  description?: string;
}

/** What the publisher says about itself, read alongside the fields. */
export interface Introspection {
  platform: Exclude<Platform, "manual">;
  schemaUrl: string;
  fields: SourceField[];
  title?: string;
  description?: string;
  geometryType?: string;
  license?: string;
  landingPage?: string;
}

export class SourceFetchError extends Error {}

/** GET a URL and parse JSON. Injected in tests, so nothing there touches the network. */
export type JsonFetcher = (url: string) => Promise<unknown>;

export const LABEL_MAX = 120;
export const DESCRIPTION_MAX = 400;

/**
 * Which platform a URL belongs to, and where its field list lives. Null for
 * anything this module cannot read, which is then a `manual` source.
 */
export function platformOf(accessUrl: string): { platform: Exclude<Platform, "manual">; schemaUrl: string } | null {
  let url: URL;
  try {
    url = new URL(accessUrl);
  } catch {
    return null;
  }
  const arcgis = url.pathname.match(/^(.*\/(?:FeatureServer|MapServer)\/\d+)\/?(?:query)?$/i);
  if (arcgis) return { platform: "arcgis", schemaUrl: `${url.origin}${arcgis[1]}?f=json` };
  const socrata =
    url.pathname.match(/^\/resource\/([a-z0-9]{4}-[a-z0-9]{4})(?:\.[a-z]+)?$/i) ??
    url.pathname.match(/^\/(?:api\/views\/|d\/|.*\/)([a-z0-9]{4}-[a-z0-9]{4})(?:\.json)?\/?$/i);
  if (socrata) return { platform: "socrata", schemaUrl: `${url.origin}/api/views/${socrata[1].toLowerCase()}.json` };
  return null;
}

/** Read and normalise a source's field list from its publisher. */
export async function introspect(accessUrl: string, fetchJson: JsonFetcher = safeFetchJson): Promise<Introspection | null> {
  const where = platformOf(accessUrl);
  if (!where) return null;
  const body = (await fetchOnceMore(fetchJson, where.schemaUrl)) as Record<string, unknown>;
  if (!body || typeof body !== "object") throw new SourceFetchError("the publisher returned no JSON object");
  if (body.error) {
    const e = body.error as { message?: string };
    throw new SourceFetchError(`the publisher returned an error: ${String(e.message ?? JSON.stringify(e)).slice(0, 200)}`);
  }

  if (where.platform === "arcgis") {
    const raw = body.fields;
    if (!Array.isArray(raw)) throw new SourceFetchError("not an ArcGIS layer: the response has no fields list");
    return {
      ...where,
      fields: raw.map((f: Record<string, unknown>) => field(f.name, arcgisType(f.type), f.alias)),
      title: clip(body.name, LABEL_MAX),
      description: clip(stripHtml(body.description), DESCRIPTION_MAX),
      geometryType: typeof body.geometryType === "string" ? body.geometryType : undefined,
      license: clip(stripHtml(body.copyrightText), LABEL_MAX),
    };
  }

  const columns = body.columns;
  if (!Array.isArray(columns)) throw new SourceFetchError("not a Socrata dataset: the response has no columns list");
  const id = typeof body.id === "string" ? body.id : "";
  const license = body.license as { name?: string } | undefined;
  return {
    ...where,
    fields: columns
      // Socrata's own bookkeeping columns start with ':'.
      .filter((c: Record<string, unknown>) => typeof c.fieldName === "string" && !(c.fieldName as string).startsWith(":"))
      .map((c: Record<string, unknown>) => field(c.fieldName, String(c.dataTypeName ?? "text"), c.name, c.description)),
    title: clip(body.name, LABEL_MAX),
    description: clip(body.description, DESCRIPTION_MAX),
    license: clip(license?.name, LABEL_MAX),
    landingPage: id ? `${new URL(where.schemaUrl).origin}/d/${id}` : undefined,
  };
}

/** Public GIS servers drop connections now and then; one retry for a dropped connection, never for an answer. */
async function fetchOnceMore(fetchJson: JsonFetcher, url: string): Promise<unknown> {
  try {
    return await fetchJson(url);
  } catch (err) {
    if (!(err instanceof SourceFetchError) || !/could not reach|did not answer/.test(err.message)) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    return fetchJson(url);
  }
}

function field(name: unknown, type: string, label?: unknown, description?: unknown): SourceField {
  if (typeof name !== "string" || name.length === 0) throw new SourceFetchError("a field in the publisher's list has no name");
  const out: SourceField = { name, type };
  const l = clip(label, LABEL_MAX);
  if (l && l !== name) out.label = l;
  const d = clip(stripHtml(description), DESCRIPTION_MAX);
  if (d) out.description = d;
  return out;
}

/** `esriFieldTypeDouble` → `double`; the rest of the name says nothing. */
function arcgisType(type: unknown): string {
  return typeof type === "string" ? type.replace(/^esriFieldType/, "").toLowerCase() : "unknown";
}

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : undefined;
}

function stripHtml(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") : value;
}

// --- the outbound request -----------------------------------------------------

/** True for addresses the server must never connect to on a caller's behalf. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.replace(/^::ffff:/i, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("fc") || v6.startsWith("fd") || // unique local
    /^fe[89ab]/.test(v6) || // link-local
    v6.startsWith("ff") // multicast
  );
}

/** A DNS lookup that refuses to hand the socket a private address. */
function publicOnlyLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: "EPRIVATE" }), "");
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function safeFetchJson(target: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return reject(new SourceFetchError("not a URL"));
    }
    if (url.protocol !== "https:") return reject(new SourceFetchError("only https:// sources can be read"));
    if (url.username || url.password) return reject(new SourceFetchError("URLs with credentials are refused"));
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new SourceFetchError("that address is not public"));
    }
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicOnlyLookup as never,
        headers: { accept: "application/json", "user-agent": "schemalattice-source-check/0.1 (+https://schemalattice.com)" },
        timeout: FETCH_LIMITS.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return reject(new SourceFetchError(`the publisher redirected (${status}); give the final URL instead`));
        }
        if (status !== 200) {
          res.resume();
          return reject(new SourceFetchError(`the publisher answered HTTP ${status}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > FETCH_LIMITS.maxBytes) {
            req.destroy();
            reject(new SourceFetchError("the publisher's response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new SourceFetchError("the publisher's response is not JSON"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new SourceFetchError("the publisher did not answer in time")));
    req.on("error", (err) =>
      reject(err instanceof SourceFetchError ? err : new SourceFetchError(`could not reach the publisher: ${err.message}`)),
    );
    req.end();
  });
}
