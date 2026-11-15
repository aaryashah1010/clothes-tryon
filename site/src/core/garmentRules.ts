import type { Garment } from "../garments";

/** Garments with a hood: the model leaves it out unless told, because it is a thin shape in the flat reference. */
export const hasHood = (g: Garment) => g.hood ?? /hoodie|hooded/i.test(g.name);
/** Regular patterns (checks, stripes): the model redraws them every frame, so the size and count drift unless told. */
export const hasPattern = (g: Garment) => g.pattern ?? /check|plaid|gingham|stripe/i.test(g.name);
/** Open-front garments (blazers, waistcoats, trench coats): the chest shows between the lapels, and the model fills it with skin unless told. */
export const isOpenFront = (g: Garment) => g.openFront ?? /blazer|waistcoat|trench|cardigan/i.test(g.name);
