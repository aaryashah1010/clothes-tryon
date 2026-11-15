import type { Landmark } from "../pose";

// The messages between the page and the GPU server, typed in one place. No page, no socket: builders and parsers only.

// ---- page -> server ----
export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "garment"; image: string }
  | { type: "ping"; t: number };

export const encodeMessage = (m: ClientMessage): string => JSON.stringify(m);

/** A camera frame: 8 bytes (the capture time, float64 little-endian) followed by the JPEG. */
export function cameraPacket(ts: number, jpeg: ArrayBuffer): Blob {
  const head = new ArrayBuffer(8);
  new DataView(head).setFloat64(0, ts, true);
  return new Blob([head, jpeg]);
}

// ---- server -> page ----
export type ServerMessage =
  | { type: "ready"; width?: number; height?: number; info?: Record<string, unknown> }
  | { type: "ack"; ts: number }
  | { type: "stats"; [key: string]: unknown }
  | { type: "pong"; t: number }
  | { type: "busy" }
  | { type: "error"; message?: string }
  | { type: "unknown"; [key: string]: unknown };

const KNOWN = new Set(["ready", "ack", "stats", "pong", "busy", "error"]);

export function parseServerMessage(text: string): ServerMessage {
  const m = JSON.parse(text) as Record<string, unknown>;
  return (KNOWN.has(String(m.type)) ? m : { ...m, type: "unknown" }) as ServerMessage;
}

/**
 * An AI picture: 8 bytes capture time (the camera moment it was made from), then, when the server sends the body pose,
 * a uint32 byte count and that many bytes of float32 (x, y, z, visibility) per landmark, then the JPEG.
 * pose: undefined = the server didn't look (the browser has to), null = it looked and found nobody.
 */
export type ResultPacket = { ts: number; pose: Landmark[] | null | undefined; jpeg: ArrayBuffer };

export function parseResultPacket(data: ArrayBuffer, serverPose: boolean): ResultPacket {
  const view = new DataView(data);
  const ts = view.getFloat64(0, true);
  let jpegAt = 8;
  let pose: Landmark[] | null | undefined;
  if (serverPose) {
    const n = view.getUint32(8, true);
    pose = null;
    if (n) {
      const f = new Float32Array(data.slice(12, 12 + n));
      pose = [];
      for (let i = 0; i + 3 < f.length; i += 4) pose.push({ x: f[i]!, y: f[i + 1]!, z: f[i + 2]!, visibility: f[i + 3]! });
    }
    jpegAt = 12 + n;
  }
  return { ts, pose, jpeg: data.slice(jpegAt) };
}

/** The WebSocket address for a server base address and token (http -> ws, https -> wss). */
export function serverSocketUrl(base: string, token: string): string {
  const u = new URL(base.trim());
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.pathname = u.pathname.replace(/\/+$/, "") + "/ws";
  u.searchParams.set("token", token);
  return u.toString();
}
