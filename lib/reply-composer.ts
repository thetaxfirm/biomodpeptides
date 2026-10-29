/** Shared evidence checks for the editor and server. No provider calls or stored content. */
export function matchedCoaReplyProblem(body: string): string | null {
  const plain = body.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (entity, hex, dec) => { const code = parseInt(hex || dec, hex ? 16 : 10); return code <= 0x10ffff ? String.fromCodePoint(code) : entity; }).replace(/&(?:apos|#39);/gi, "'").replace(/&nbsp;/gi, ' ').replace(/[’‘]/g, "'");
  const lot = '(?:lot|batch)(?:\\s+(?:number|format|code|entered|provided))?';
  const mismatch = new RegExp(`\\b${lot}[^.!?\\n]{0,100}\\b(?:does(?:n.t| not) match|does not correspond|does(?:n.t| not) correspond|mismatch|not match|incorrect|invalid|unrecognized|unrecognised|different|wrong)\\b`, 'i');
  const noMatch = /\b(?:no\s+(?:(?:matching|approved|correct|available|exact|laboratory|lab)\s+)*(?:report|coa|certificate)|(?:cannot find|can't find|could not find|couldn't find|unable to find|do not have|don't have|do not yet have|don't yet have)\b[^.!?\n]{0,65}\b(?:report|coa|certificate))\b/i;
  const missingReport = /\b(?:report|coa|certificate)\b[^.!?\n]{0,70}\b(?:not (?:available|on file|found)|unavailable|missing|cannot be (?:sent|attached)|can't be (?:sent|attached))\b/i;
  const requestLabel = /\b(?:(?:confirm|provide|re-enter|retype)\b[^.!?\n]{0,55}\b(?:exact lot|lot (?:number|printed)|dashes|spaces)|(?:could you|can you|please|would you|need you to)\s+(?:check|confirm)\b[^.!?\n]{0,55}\b(?:vial label|exact lot|lot (?:number|printed)|dashes|spaces)|(?:send|provide|need)\b[^.!?\n]{0,45}\b(?:label photo|photo of (?:your |the )?(?:vial|label)))\b/i;
  const asksForLabel = [...plain.matchAll(new RegExp(requestLabel.source, 'gi'))].some(match =>
    !/\b(?:no need to|(?:do not|don't|does not|doesn't) (?:need|have) to|need not|(?:not necessary|not required) to|not asking you to|do not|don't|does not|doesn't|no|not)\s*$/i.test(plain.slice(0, match.index)));
  const withholding = /\b(?:did(?:n.t| not)|have(?:n.t| not)|has(?:n.t| not)|cannot|can't|won't|will not)\b[^.!?\n]{0,35}\b(?:send|sent|attach|attached)\b[^.!?\n]{0,65}\b(?:report|coa|pdf|certificate)\b/i;
  return mismatch.test(plain) || noMatch.test(plain) || missingReport.test(plain) || asksForLabel || withholding.test(plain)
    ? 'This draft asks for a lot check or says the report is missing, but the matching PDF is verified. Use the matched-report reply or edit the text before sending.' : null;
}
export type ComposerCoa = { productName?: string; strength?: string; lot?: string; filename?: string; sha256?: string; extras?: ComposerCoa[] };
export function coaReplyProduct(coa: ComposerCoa): string {
  const name = coa.productName || 'your product', strength = coa.strength || '';
  return strength && !name.replace(/\s+/g, '').toLowerCase().includes(strength.replace(/\s+/g, '').toLowerCase()) ? `${name} ${strength}` : name;
}
/** This is a factual prepared response, not generated AI text. Identity is supplied by the sender footer. */
export function preparedCoaReply(coa: ComposerCoa): string {
  const reports = [coa, ...(coa.extras || [])];
  const description = reports.map(report => `${coaReplyProduct(report)}${report.lot ? `, lot ${report.lot}` : ''}`).join('; ');
  return `Hi,\n\nThank you for your request. I've attached the laboratory report${reports.length > 1 ? 's' : ''} for ${description}.\n\nIf you have any questions about the report, just reply to this email.\n\nThank you,`;
}
/** Offer only an enabled, server-provided code selected by staff. No invented expiry or single-use claim. */
export function appendNextPurchaseOffer(body: string, code: { code: string; percentOff: number }): string {
  if (!/^[A-Z0-9]{1,40}$/.test(code.code) || !Number.isInteger(code.percentOff) || code.percentOff < 1 || code.percentOff > 100) return body;
  if (new RegExp(`\\b${code.code}\\b`, 'i').test(body)) return body;
  const offer = `As a thank-you, use code ${code.code} for ${code.percentOff}% off your next purchase at trybiomod.com.`;
  const closing = /\n\n(?:Thank you|Thanks|Best|Kind regards|Regards),?[ \t]*(?:\n(?:Kim C\.?|BioMod Customer Care).*)?\s*$/i;
  return closing.test(body) ? body.replace(closing, match => `\n\n${offer}${match}`) : `${body.trim()}\n\n${offer}`.trim();
}
