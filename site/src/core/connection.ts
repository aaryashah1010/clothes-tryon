// What to do when the connection to the GPU server closes. Pure: close details in, a decision out.

export const MAX_RECONNECTS = 3;

/** Close codes the server uses on purpose. */
export const CLOSE_WRONG_TOKEN = 4401;
export const CLOSE_BUSY = 4409;
export const CLOSE_TAKEN_OVER = 4410;

export type CloseOutcome =
  | { kind: "reconnect" }
  /** Stop the session; show `message` to the person (null: show nothing). */
  | { kind: "stop"; message: string | null };

/**
 * @param wasLive   the stage was already showing the live view (not the first connection attempt)
 * @param hasStream the camera is still on
 */
export function closeOutcome(code: number, wasLive: boolean, reconnects: number, hasStream: boolean): CloseOutcome {
  const deliberate = code === CLOSE_WRONG_TOKEN || code === CLOSE_TAKEN_OVER || code === CLOSE_BUSY;
  if (wasLive && !deliberate && reconnects < MAX_RECONNECTS && hasStream) return { kind: "reconnect" };
  if (code === CLOSE_WRONG_TOKEN) return { kind: "stop", message: "Wrong access token." };
  if (code === CLOSE_TAKEN_OVER)
    return { kind: "stop", message: "Another tab or device connected to this GPU and took over. Close the other one, then press Start." };
  if (code === CLOSE_BUSY) return { kind: "stop", message: null };
  return {
    kind: "stop",
    message: `${wasLive ? "The connection to the GPU server dropped" : "Couldn't reach the GPU server. Is it running?"} (code ${code}).`,
  };
}
