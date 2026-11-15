/** Tunable numbers in one place. Nothing here depends on the page or the browser. */

/** The GPU server cuts the instruction at this many characters. */
export const PROMPT_MAX_CHARS = 600;

/**
 * The garment preparation service's /prepare address. Empty = the feature is off and an upload is only cleaned up in the
 * browser. Set it to what `modal deploy cloud_modal/prepare_garment.py` prints (plus "/prepare"), or try one without
 * rebuilding by opening the page with ?prep=<address>.
 */
export const PREPARE_URL = "";
/** Give up on the service after this long (the picture work takes 10 to 40 seconds). */
export const PREPARE_TIMEOUT_MS = 120_000;
/** The picture sent to the service: its longer side is shrunk to at most this (the garment stays clear, the upload small). */
export const PREPARE_MAX_SIDE = 1024;

/** How often the live camera is checked for "is someone in view" (the check is cheap; a few times a second is enough). */
export const PRESENCE_EVERY_MS = 150;
/** Shoulders wider than this share of the picture: the person is too close to the camera. */
export const CLOSE_SPAN = 0.72;
/** A picture that fails the bare arm/leg check is held back for at most this long; then the newest is shown anyway. */
export const HOLD_MAX_MS = 700;
/** How long the camera's presence history is kept. */
export const PRESENCE_HISTORY_MS = 5000;
/** A presence record older than this (relative to the picture it judges) means the tracker stalled: do not judge. */
export const PRESENCE_STALE_MS = 1000;
