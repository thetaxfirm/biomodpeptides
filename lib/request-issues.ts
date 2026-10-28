// Issue types and resolutions for customer cases. Shared by the server and the admin desk.
export const issueTypes = [
  ['unfinished_checkout', 'Did not finish checkout'], ['out_of_stock', 'Item not in stock yet'], ['website', 'Website or cart problem'], ['coa', 'COA request'],
  ['shipping', 'Shipping or delivery'], ['refund', 'Refund or cancellation'], ['wrong_damaged', 'Wrong or damaged item'],
  ['owner_review', 'Owner review required'], ['product_question', 'Product question'], ['partner', 'Partner or affiliate'], ['vendor', 'Vendor pitch'], ['other', 'Other'],
] as const;
export const resolutionTypes = [
  ['waiting', 'Customer will wait'], ['free_item', 'Free item of their choice if they wait'], ['refund', 'Refunded'], ['store_credit', 'Store credit'], ['substitute', 'Sent something else meanwhile'],
  ['discount', 'Discount on next order'], ['replacement', 'Replacement sent'], ['answered', 'Answered'], ['other', 'Other'],
] as const;
export type IssueType = typeof issueTypes[number][0];
export type ResolutionType = typeof resolutionTypes[number][0];
export type RequestIssue = { issue: IssueType; resolutions: ResolutionType[]; note: string; updated: number; updatedBy: string };
export const issueLabel = (value: string) => issueTypes.find(([key]) => key === value)?.[1] || value;
export const resolutionLabel = (value: string) => resolutionTypes.find(([key]) => key === value)?.[1] || value;
export const isIssue = (value: unknown): value is IssueType => issueTypes.some(([key]) => key === value);
export const isResolution = (value: unknown): value is ResolutionType => resolutionTypes.some(([key]) => key === value);

// Suggest a sales pitch only when the writer presents themselves as a seller or offers
// their own goods. Manufacturing, purity and wholesale questions are customer questions.
// A staff issue tag still overrides this suggestion in the reply desk.
const SELLER_INTRO = /\b(?:we(?:'re| are)|i(?:'m| am))\s+(?:(?:a|an|the|leading|professional|peptide|peptides|research|experienced|trusted|global|direct)\s+){0,6}(?:manufacturers?|suppliers?|factory)\b/i;
const SELLER_OFFER = /\b(?:we|our (?:company|factory|team))\s+(?:can\s+)?(?:supply|provide|offer|sell|manufacture)\b[^.!?\n]{0,100}\b(?:peptides?|raw materials?|raws|sarms|OEM|ODM|private label)\b/i;
const OWN_CATALOG = /\b(?:our|my)\s+(?:(?:latest|new|updated|wholesale|product|full)\s+){0,3}(?:catalog(?:ue)?|price[ -]?list)\b/i;
const CATALOG_INVITATION = /\b(?:would you|are you|let me|may i|can i)\b[^.!?\n]{0,100}\b(?:interested|review|receive|send|share|see)\b/i;
const BUYING_INTENT = /\b(?:(?:i|we)\s+(?:(?:am|are)\s+)?(?:want to|need to|would like to|looking to|interested in)\s+(?:buy(?:ing)?|purchas(?:e|ing)|order(?:ing)?)|(?:i|we)(?:'d| would)\s+like to\s+(?:buy|purchase|order))\b/i;
export function looksLikePitchText(subject: string, message: string): boolean {
  const value = subject + '\n' + message;
  // An explicit purchasing request should stay visible for a person to answer.
  if (BUYING_INTENT.test(value)) return false;
  return SELLER_INTRO.test(value) || SELLER_OFFER.test(value)
    || (OWN_CATALOG.test(value) && CATALOG_INVITATION.test(value));
}
