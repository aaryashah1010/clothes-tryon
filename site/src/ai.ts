/** Talks to the GPU try-on server (server/tryon_server.py). */

export type AiConfig = { url: string; token: string };

const KEY = "fynd-studio-ai";

function clean(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Reads the server address from ?ai=…&token=… (and remembers it), else from local storage. */
export function loadConfig(): AiConfig | null {
  const q = new URLSearchParams(location.search);
  const fromUrl = q.get("ai");
  if (fromUrl) {
    const cfg = { url: clean(fromUrl), token: q.get("token") ?? "" };
    saveConfig(cfg);
    // keep the token out of the address bar and browser history
    history.replaceState(null, "", location.pathname + location.hash);
    return cfg;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as AiConfig;
    return cfg.url ? cfg : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ url: clean(cfg.url), token: cfg.token }));
  } catch {
    /* private mode: the setting just won't be remembered */
  }
}

export async function checkHealth(cfg: AiConfig): Promise<"ready" | "loading" | "unreachable"> {
  try {
    const res = await fetch(`${clean(cfg.url)}/health`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return "unreachable";
    const body = (await res.json()) as { model_loaded?: boolean };
    return body.model_loaded ? "ready" : "loading";
  } catch {
    return "unreachable";
  }
}

export class AiError extends Error {}

/** Sends the photo and garment, returns the realistic picture. */
export async function renderTryOn(cfg: AiConfig, person: Blob, garment: Blob): Promise<Blob> {
  const form = new FormData();
  form.append("person", person, "person.jpg");
  form.append("garment", garment, "garment.png");
  let res: Response;
  try {
    res = await fetch(`${clean(cfg.url)}/tryon`, {
      method: "POST",
      headers: cfg.token ? { "X-Token": cfg.token } : {},
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new AiError("Couldn't reach the AI server. Check the address and that the server is running.");
  }
  if (res.status === 401) throw new AiError("The access token is wrong or missing.");
  if (res.status === 503) throw new AiError("The AI model is still starting. Try again in a minute.");
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      /* not json */
    }
    throw new AiError(detail || `The AI server returned an error (${res.status}).`);
  }
  return res.blob();
}
