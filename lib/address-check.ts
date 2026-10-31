// USPS delivery check for a shipping address, read from EasyPost's address verification.
//
// Why this exists (owner, Oct 31 2026): customers leave out apartment numbers, the order goes
// through, and nobody finds out until the parcel comes back. Checkout now asks USPS whether the
// address is deliverable as typed, and stops to ask the customer when it is not. A customer can
// still insist the address is right; that order then waits for a person before a label is bought.
//
// Pure functions only. The network call lives in easypost.ts so this file can be tested offline.

export type AddressCheckStatus =
    /** USPS confirms the address is deliverable as typed. */
    | 'verified'
    /** The building has units and no apartment, suite or unit number was given. */
    | 'unit_missing'
    /** A unit number was given, but USPS does not know it at this address. */
    | 'unit_invalid'
    /** USPS could not match the address at all. */
    | 'not_found'
    /** The check could not run (EasyPost off, unreachable, or USPS engine down). Never a customer's fault. */
    | 'unavailable';

export type AddressCheck = {
    status: AddressCheckStatus;
    at: number;
    /** The customer saw the warning and said the address is correct as typed. */
    confirmed?: boolean;
};

const STATUSES: AddressCheckStatus[] = ['verified', 'unit_missing', 'unit_invalid', 'not_found', 'unavailable'];
/** Statuses where USPS says something is wrong with what the customer typed. */
export const ADDRESS_PROBLEMS: AddressCheckStatus[] = ['unit_missing', 'unit_invalid', 'not_found'];
/** EasyPost codes that mean the verification engine failed, not the address. */
const ENGINE_CODES = new Set(['E.ENGINE.UNAVAILABLE', 'E.TIMED_OUT', 'E.QUERY.UNANSWERABLE', 'E.COUNTRY.UNSUPPORTED']);
/** Codes that never describe a delivery problem on their own. */
const IGNORED_CODES = new Set(['E.TIME_ZONE.UNAVAILABLE']);

/**
 * Classify an EasyPost Address object returned with `verify: true`.
 *
 * EasyPost documents that the secondary-information errors "may also appear on a successful
 * verification", so `success: true` alone is not trusted: the error codes are read first.
 */
export function classifyVerifiedAddress(address: unknown, hasUnit: boolean): AddressCheckStatus {
    const delivery = (address as { verifications?: { delivery?: { success?: unknown; errors?: unknown } } } | null)?.verifications?.delivery;
    if (!delivery || typeof delivery.success !== 'boolean') return 'unavailable';
    const codes = (Array.isArray(delivery.errors) ? delivery.errors : [])
        .map(e => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string') ? (e as { code: string }).code.toUpperCase() : '')
        .filter(code => code && !IGNORED_CODES.has(code));
    if (codes.includes('E.SECONDARY_INFORMATION.MISSING')) return hasUnit ? 'unit_invalid' : 'unit_missing';
    if (codes.includes('E.SECONDARY_INFORMATION.INVALID')) return 'unit_invalid';
    if (delivery.success) return 'verified';
    if (codes.length && codes.every(code => ENGINE_CODES.has(code))) return 'unavailable';
    return 'not_found';
}

/** Reads a saved check back off a quote or an order. Anything malformed reads as no check. */
export function savedAddressCheck(value: unknown): AddressCheck | null {
    const v = value as Partial<AddressCheck> | null;
    if (!v || typeof v !== 'object' || !STATUSES.includes(v.status as AddressCheckStatus) || !Number.isFinite(v.at)) return null;
    return { status: v.status as AddressCheckStatus, at: v.at as number, ...(v.confirmed === true ? { confirmed: true } : {}) };
}

export const addressProblem = (check: AddressCheck | null): boolean => Boolean(check && ADDRESS_PROBLEMS.includes(check.status));

/** What the customer is told at checkout. Plain, and says exactly what to do. */
export function customerAddressMessage(status: AddressCheckStatus): string {
    if (status === 'unit_missing') return 'USPS lists this address as a building with apartments or suites. Add your apartment, suite or unit number so your package is not returned.';
    if (status === 'unit_invalid') return 'USPS does not recognize that apartment, suite or unit number at this address. Check it and try again.';
    if (status === 'not_found') return 'USPS could not find this address. Check the street, city, state and ZIP code.';
    return '';
}

/** What staff see on the order. One sentence or two, without the final period. */
export function staffAddressLabel(check: AddressCheck | null): string {
    if (!check) return 'Address not checked with USPS';
    const confirmed = check.confirmed ? '. The customer confirmed it is correct as typed' : '';
    switch (check.status) {
        case 'verified': return 'USPS verified this address';
        case 'unit_missing': return 'USPS says this address needs an apartment or unit number, and none was given' + confirmed;
        case 'unit_invalid': return 'USPS does not recognize the apartment or unit number' + confirmed;
        case 'not_found': return 'USPS could not find this address' + confirmed;
        default: return 'The USPS address check was unavailable';
    }
}

/** Hold note written when the automatic label job stops for an address. */
export function addressHoldNote(check: AddressCheck): string {
    return staffAddressLabel(check) + '. Confirm the address with the customer, fix it if needed, then clear this hold to ship.';
}
