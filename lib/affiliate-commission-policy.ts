/** Shared eligibility policy. This reports obligations; it never records or initiates a payout. */
export type CommissionEvidence = {
  status: string; payment_ref: string | null; notification_id: string | null;
  recorded_at: number | null; updated: number; hold_days: number;
  basis_cents: number; net_cents: number | null; commission_bps: number; review_state: string | null;
};
export function commissionEligibility(row: CommissionEvidence, now: number) {
  const paymentRecorded = ['paid', 'labeling', 'shipped', 'delivered'].includes(row.status) && Boolean(row.payment_ref?.trim() && row.notification_id?.trim() && row.recorded_at !== null);
  const availableAt = (row.recorded_at ?? row.updated) + row.hold_days * 86400000;
  const basisCents = row.net_cents ?? row.basis_cents;
  const state = row.review_state === 'excluded' ? 'excluded' : row.review_state === 'held' ? 'held' : paymentRecorded ? now >= availableAt ? 'eligible' : 'held' : 'excluded';
  return { originalBasisCents: row.basis_cents, basisCents, commissionCents: Math.round(basisCents * row.commission_bps / 10000), state, availableAt } as const;
}
