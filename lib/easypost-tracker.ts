import { ShippingError, easypostReady } from './easypost';

/**
 * The carrier's own view of a tracking number this store did not buy (owner, Nov 17 2026: a resend
 * posted outside the system, "verify the correct tracking info").
 *
 * Deliberately its own module. Everything in easypost.ts is about shipments this store created --
 * quoting rates, buying postage, insuring it. This asks about a parcel bought somewhere else, it
 * spends no money, and keeping it separate means a change here can never disturb the label path.
 * It takes the two things it needs from there, both already public: the error type and the
 * is-it-configured check.
 *
 * EasyPost's tracker endpoint is the only way to ask about a bare tracking number: the readShipment
 * helpers both need a shp_ reference, which a label bought elsewhere does not have. Posting the
 * same code twice is safe -- EasyPost returns the tracker it already holds rather than billing for
 * another.
 */
const API = 'https://api.easypost.com/v2';
const CARRIER_STATUSES = ['unknown', 'pre_transit', 'in_transit', 'out_for_delivery', 'delivered', 'available_for_pickup', 'return_to_sender', 'failure', 'cancelled', 'error'];

export type TrackedCode = { tracking: string; status: string; carrier: string; trackingUrl: string; shipmentId: string | null };

export async function readTrackingCode(env: Record<string, string | undefined>, trackingCode: string, carrier?: string): Promise<TrackedCode> {
    if (!easypostReady(env)) throw new ShippingError('EasyPost is not connected.');
    const code = String(trackingCode || '').trim().toUpperCase();
    // Deliberately narrow: a tracking number is letters and digits. Anything else is a typo or a
    // pasted URL, and sending it on would only ask EasyPost about nonsense.
    if (!/^[A-Z0-9]{8,40}$/.test(code)) throw new ShippingError('That is not a usable tracking number.');
    const wanted = (carrier || '').trim();
    if (wanted && !/^[A-Za-z0-9]{2,30}$/.test(wanted)) throw new ShippingError('That is not a usable carrier name.');

    let response: Response;
    try {
        response = await fetch(API + '/trackers', {
            method: 'POST',
            headers: { Authorization: 'Basic ' + btoa(env.EASYPOST_API_KEY!.trim() + ':'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracker: { tracking_code: code, ...(wanted ? { carrier: wanted } : {}) } }),
            redirect: 'manual', // Workers reject 'error'; a 3xx is not ok and is rejected below.
            signal: AbortSignal.timeout(15000),
        });
    }
    catch { throw new ShippingError('EasyPost could not be reached.'); }
    let tracker: Record<string, any> = {};
    try { tracker = await response.json() as Record<string, any>; } catch { /* handled below */ }
    if (!response.ok) {
        const message = typeof tracker?.error?.message === 'string' ? tracker.error.message.slice(0, 200) : 'request failed (' + response.status + ')';
        throw new ShippingError('EasyPost: ' + message);
    }

    if (tracker.object !== 'Tracker') throw new ShippingError('EasyPost did not return a tracker for that number.');
    // Production only, and the number that comes back must be the number that was asked about. A
    // test-mode tracker reports a fabricated status, which is the worst possible thing to record
    // against a customer's parcel.
    if (tracker.mode !== 'production') throw new ShippingError('That tracker is not a production tracker. No order changes were saved.');
    if (String(tracker.tracking_code || '').toUpperCase() !== code) throw new ShippingError('EasyPost returned a different tracking number. No order changes were saved.');
    const status = String(tracker.status || '');
    if (!CARRIER_STATUSES.includes(status)) throw new ShippingError('Carrier tracking status is unavailable for that number.');
    return {
        tracking: code,
        status,
        carrier: String(tracker.carrier || wanted || ''),
        trackingUrl: String(tracker.public_url || ''),
        shipmentId: typeof tracker.shipment_id === 'string' && /^shp_[a-zA-Z0-9]+$/.test(tracker.shipment_id) ? tracker.shipment_id : null,
    };
}
