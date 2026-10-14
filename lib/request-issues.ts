// Issue types and resolutions for customer cases. Shared by the server and the admin desk.
export const issueTypes = [
  ['unfinished_checkout', 'Did not finish checkout'], ['out_of_stock', 'Item not in stock yet'], ['website', 'Website or cart problem'], ['coa', 'COA request'],
  ['shipping', 'Shipping or delivery'], ['refund', 'Refund or cancellation'], ['wrong_damaged', 'Wrong or damaged item'],
  ['product_question', 'Product question'], ['partner', 'Partner or affiliate'], ['vendor', 'Vendor pitch'], ['other', 'Other'],
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

// Supplier and vendor sales pitches, not customers. Only a suggestion; tagging the issue overrides it.
const PITCH = /\b(manufactur\w*|supplier|factory|wholesale|OEM|ODM|private label|bulk (?:order|price)|competitive pric\w*|price list|MOQ|our company|we are a (?:leading|professional)|we (?:can )?(?:supply|provide) (?:high|all)|high quality peptides?|sarms)\b/i;
export const looksLikePitchText = (subject: string, message: string) => PITCH.test(subject + ' ' + message);
