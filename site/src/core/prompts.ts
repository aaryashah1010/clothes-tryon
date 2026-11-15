import type { Garment } from "../garments";
import { PROMPT_MAX_CHARS } from "./config";
import { hasHood, hasPattern, isOpenFront } from "./garmentRules";

// The instruction the model gets with every frame. The server takes a new one at any time ({"type":"prompt"}), so the
// page sends the one that fits the garment: tops (with extra lines for sleeves, hoods, open fronts, patterns) or bottoms.
const TOPS_PROMPT =
  "Replace the person's entire upper-body clothing with the garment in the reference image. Remove the original shirt, " +
  "collar and sleeves completely. Only the new garment's own neckline should be visible. Keep the face, pose and " +
  "background unchanged.";
const LONG_SLEEVES = " The garment has long sleeves: they cover both arms fully down to the wrists in every frame, with no bare forearms and no original clothing showing.";
const HOODED =
  " The garment is a hoodie: the hood is always drawn, hanging down behind the neck and resting on the shoulders and upper back, in every frame, even when the person sits still.";
const OPEN_FRONT =
  " The garment is worn open at the front over a plain shirt: a shirt is always visible between the lapels, the chest and neck are never bare skin.";
const PATTERNED =
  " The garment has a regular pattern (check or stripes): keep exactly the same pattern, the same number of squares or lines and the same size, in every frame; do not change, blur or shift it.";
const BOTTOMS_PROMPT =
  "Replace the person's trousers, skirt or shorts with the garment in the reference image, as it is worn in the reference. " +
  "Keep the person's top, face, pose and background unchanged.";
const FULL_LENGTH =
  " These are full-length trousers: both legs are covered all the way down to the ankles in every frame. Never shorten " +
  "them to shorts and never end them at the knee.";
const MIDI_LENGTH = " The garment ends just below the knee and stays that length in every frame.";
const SHORT_LENGTH = " These are shorts: they end above the knee in every frame, and the lower legs below them are bare.";

const lengthLine = (g: Garment) => (g.length === "midi" ? MIDI_LENGTH : g.length === "short" ? SHORT_LENGTH : FULL_LENGTH);

export function promptFor(g: Garment): string {
  if (g.category === "bottoms") return BOTTOMS_PROMPT + lengthLine(g);
  return (
    TOPS_PROMPT +
    (g.sleeves === "long" ? LONG_SLEEVES : "") +
    (hasHood(g) ? HOODED : "") +
    (isOpenFront(g) ? OPEN_FRONT : "") +
    (hasPattern(g) ? PATTERNED : "")
  );
}

// Outfit mode: both pictures go into ONE reference image (top above, bottoms below) with one instruction.
const OUTFIT_PROMPT =
  "Dress the person in the outfit shown in the reference image: the top (upper half of the reference) on the upper body " +
  "and the trousers (lower half) on the legs. Remove the person's original shirt, sleeves and trousers completely. " +
  "Keep the face, pose and background unchanged.";

export function outfitPromptFor(top: Garment, bottom: Garment): string {
  const parts = [OUTFIT_PROMPT];
  if (top.sleeves === "long") parts.push("The top has long sleeves covering both arms to the wrists in every frame.");
  if (hasHood(top)) parts.push("The top is a hoodie: its hood is always drawn, hanging behind the neck.");
  if (isOpenFront(top)) parts.push("The top is worn open over a plain shirt; the chest is never bare skin.");
  parts.push(
    bottom.length === "midi"
      ? "The bottoms end just below the knee."
      : bottom.length === "short"
        ? "The bottoms are shorts ending above the knee."
        : "The trousers reach the ankles in every frame; never shorten them to shorts.",
  );
  return parts.join(" ").slice(0, PROMPT_MAX_CHARS);
}
