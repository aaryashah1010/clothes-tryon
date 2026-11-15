import { PREPARE_TIMEOUT_MS } from "../core/config";
import { parseInfo, type PreparedInfo } from "../core/prepare";

// The call to the garment preparation service (cloud_modal/prepare_garment.py): a picture in, the garment alone out.
// Only the garment picture is sent. No page, no DOM: a function and an error type.

export class PrepareError extends Error {}

export type PrepareResult = { info: PreparedInfo; image: Blob };

export type PrepareOptions = {
  /** Full address of the service's /prepare endpoint. */
  url: string;
  /** The access token (the same one the live link carries). */
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** "data:image/png;base64,...." -> Blob, without a network request. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new PrepareError("The service returned a picture the page cannot read.");
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function prepareGarment(picture: Blob, opts: PrepareOptions): Promise<PrepareResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? PREPARE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(opts.url, { method: "POST", headers: { "X-Token": opts.token }, body: picture, signal: ctl.signal });
  } catch (e) {
    throw new PrepareError(
      (e as Error).name === "AbortError" ? "Preparing the garment took too long." : "Could not reach the garment service.",
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PrepareError("The garment service gave an unreadable answer.");
  }
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!res.ok || o.ok !== true) {
    throw new PrepareError(typeof o.error === "string" && o.error ? o.error : `The garment service refused the picture (${res.status}).`);
  }
  const info = parseInfo(o.info);
  if (!info || typeof o.image !== "string") throw new PrepareError("The garment service gave an incomplete answer.");
  return { info, image: dataUrlToBlob(o.image) };
}
