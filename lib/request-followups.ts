/** Apply only after freshly verified incoming messages are inserted in the same batch.
 * Duplicate imports pass an empty id list. This never sends or rewrites message history. */
export function followupStateStatements(db: Pick<D1Database, 'prepare'>, requestId: string, incomingIds: string[], now: number): D1PreparedStatement[] {
  const ids = [...new Set(incomingIds)].filter(Boolean).slice(0, 20);
  if (!ids.length) return [];
  const freshUnanswered = `EXISTS(SELECT 1 FROM request_reply_messages incoming WHERE incoming.request_id=? AND incoming.id IN (${ids.map(() => '?').join(',')}) AND incoming.direction='incoming' AND incoming.created>=MAX(COALESCE((SELECT MAX(outgoing.created) FROM request_reply_messages outgoing WHERE outgoing.request_id=incoming.request_id AND outgoing.direction='outgoing'),0),COALESCE((SELECT MAX(outside.sent_at) FROM request_external_replies outside WHERE outside.request_id=incoming.request_id AND (outside.source='manual' OR outside.recorded_by='Jarvis exact conversation check')),0)))`;
  return [
    db.prepare(`UPDATE requests SET status='in_progress' WHERE id=? AND status='resolved' AND ${freshUnanswered}`).bind(requestId, requestId, ...ids),
    // New source material invalidates approval, including a preparation lease. Keep the
    // old body visible for review and leave an in-flight provider outcome untouched.
    db.prepare(`UPDATE request_reply_drafts SET status='needs_review',revision=revision+1,ready_id=NULL,approved_at=NULL,approved_by=NULL,lease_token=NULL,lease_until=NULL,reason='customer_replied',updated=? WHERE request_id=? AND status IN ('queued','preparing','ready','needs_review') AND reason IS NOT 'local_sent_without_provider_receipt' AND send_locked_at IS NULL AND ${freshUnanswered}`).bind(now, requestId, requestId, ...ids),
  ];
}

/** A newly discovered sent message can answer only its already-bound conversation.
 * Run after insertion with the same batch. Equal timestamps remain open for review. */
export function answeredFollowupStateStatements(db: Pick<D1Database, 'prepare'>, requestId: string, outgoingIds: string[], now: number): D1PreparedStatement[] {
  const ids = [...new Set(outgoingIds)].filter(Boolean).slice(0, 20);
  if (!ids.length) return [];
  const answered = `EXISTS(SELECT 1 FROM request_reply_messages outgoing JOIN requests request ON request.id=outgoing.request_id WHERE outgoing.request_id=? AND outgoing.id IN (${ids.map(() => '?').join(',')}) AND outgoing.direction='outgoing' AND outgoing.created>request.created AND NOT EXISTS(SELECT 1 FROM request_reply_messages incoming WHERE incoming.request_id=outgoing.request_id AND incoming.direction='incoming' AND incoming.created>=outgoing.created))`;
  return [
    db.prepare(`UPDATE request_reply_drafts SET status='needs_review',revision=revision+1,ready_id=NULL,approved_at=NULL,approved_by=NULL,lease_token=NULL,lease_until=NULL,reason='answered_elsewhere',updated=? WHERE request_id=? AND status IN ('queued','preparing','ready','needs_review') AND reason IS NOT 'local_sent_without_provider_receipt' AND send_locked_at IS NULL AND ${answered}`).bind(now, requestId, requestId, ...ids),
    db.prepare(`UPDATE requests SET status='resolved' WHERE id=? AND status NOT IN ('spam','deleted','resolved') AND ${answered}`).bind(requestId, requestId, ...ids),
  ];
}
