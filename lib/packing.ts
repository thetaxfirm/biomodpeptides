// Which shipping box holds how many gel caps, and which box an order needs.
//
// The capacities are a measurement, not a calculation. The owner counted them with the boxes and
// the product in front of him (Nov 25 2026): "in a med box you can fir in 15 gel caps with a little
// room in there in the large size box you can fit 25 boxes and in the 7x7x6 box you can fit 9
// perfectly". Medium and large are the USPS Priority Mail Flat Rate boxes. Nothing here divides one
// volume by another to re-derive those numbers: a box is only as full as a person can actually
// close, and when the arithmetic disagrees with the shelf the shelf is right.
//
// What is sent to the carrier is the box's size and the parcel's weight. The two flat rate boxes
// are deliberately NOT yet quoted at their flat rate: EasyPost prices a flat rate box only when it
// is named as a predefined package, and naming it drops every UPS service from the quote, because
// UPS has no opinion about a USPS box. That trade has money on both sides and is the owner's to
// make, so until he makes it these boxes are rated the ordinary way, by size and weight, exactly as
// the single 8x6x4 estimate was.

export type ShipBox = {
    id: string;
    /** What to say to the person packing it. */
    label: string;
    length: number;
    width: number;
    height: number;
    /** The empty box on the scale. Estimated; replace with a weighed figure when there is one. */
    emptyOz: number;
    /** Gel cap bottles that fit, as counted. */
    softgels: number;
    /** EasyPost's name for this box when it is quoted at the USPS flat rate. Not used yet; see above. */
    usps?: string;
};

/** Smallest first. Every lookup below depends on that order. */
export const shipBoxes: readonly ShipBox[] = Object.freeze([
    { id: 'cube7', label: '7x7x6 box', length: 7, width: 7, height: 6, emptyOz: 5, softgels: 9 },
    { id: 'flat-rate-medium', label: 'USPS Medium Flat Rate', length: 11, width: 8.5, height: 5.5, emptyOz: 4, softgels: 15, usps: 'MediumFlatRateBox' },
    { id: 'flat-rate-large', label: 'USPS Large Flat Rate', length: 12, width: 12, height: 5.5, emptyOz: 6, softgels: 25, usps: 'LargeFlatRateBox' },
]);
export const largestBox = shipBoxes[shipBoxes.length - 1];
export const boxById = (id: string) => shipBoxes.find(b => b.id === id) || null;

type PackItem = { quantity: number; product: { categories?: { slug: string }[] } };
const isSoftgel = (item: PackItem) => (item?.product?.categories || []).some(c => c?.slug === 'softgels');
const count = (item: PackItem) => Math.max(0, Math.floor(Number(item?.quantity) || 0));

/** Gel cap bottles in an order. A pack of three is three bottles: the cart stores the bottle count. */
export const softgelUnits = (items: PackItem[]) => (items || []).filter(isSoftgel).reduce((n, i) => n + count(i), 0);
/** True only when every line is a gel cap. Anything else keeps the order on the general estimate. */
export const onlySoftgels = (items: PackItem[]) =>
    Array.isArray(items) && items.length > 0 && items.every(i => isSoftgel(i) && count(i) > 0);

/**
 * The boxes a gel cap order needs, largest first, filling the big box before reaching for a smaller
 * one. The last box is the smallest one the remainder fits in, so 40 bottles is a large and a
 * medium rather than two larges with a half-empty second box.
 */
export function packSoftgels(units: number): ShipBox[] {
    let left = Math.max(0, Math.floor(Number(units) || 0));
    if (!left) return [];
    const boxes: ShipBox[] = [];
    while (left > largestBox.softgels) { boxes.push(largestBox); left -= largestBox.softgels; }
    boxes.push(shipBoxes.find(b => b.softgels >= left) || largestBox);
    return boxes;
}

export type PackingPlan = { units: number; boxes: ShipBox[]; ounces: number; split: boolean };

/**
 * How this order ships, or null when it is not a gel-cap-only order. `ounces` is every box plus
 * every bottle; `split` says a single label cannot cover it.
 */
export function packingPlan(items: PackItem[], bottleOz: number): PackingPlan | null {
    if (!onlySoftgels(items)) return null;
    const units = softgelUnits(items);
    if (!units) return null;
    const boxes = packSoftgels(units);
    const perBottle = Number.isFinite(bottleOz) && bottleOz > 0 ? bottleOz : 5;
    const ounces = boxes.reduce((oz, b) => oz + b.emptyOz, 0) + units * perBottle;
    return { units, boxes, ounces: Math.round(ounces * 10) / 10, split: boxes.length > 1 };
}

/**
 * One parcel standing for the whole plan. A single box is itself. Several boxes are quoted as the
 * stack they make -- same footprint, heights added -- so the price climbs with the second box
 * instead of pretending one box took the lot. It is an approximation, and it errs high rather than
 * leaving the store short.
 */
export function planParcel(plan: PackingPlan) {
    const length = Math.max(...plan.boxes.map(b => b.length));
    const width = Math.max(...plan.boxes.map(b => b.width));
    const height = plan.boxes.reduce((h, b) => h + b.height, 0);
    return { length, width, height: Math.round(height * 10) / 10, weight: plan.ounces };
}

/** The boxes in words, for a packing sheet: "2 x USPS Large Flat Rate + 1 x 7x7x6 box". */
export function boxesInWords(boxes: ShipBox[]): string {
    const counted: { box: ShipBox; n: number }[] = [];
    for (const box of boxes) {
        const seen = counted.find(c => c.box.id === box.id);
        if (seen) seen.n += 1; else counted.push({ box, n: 1 });
    }
    return counted.map(c => c.n + ' x ' + c.box.label).join(' + ');
}
