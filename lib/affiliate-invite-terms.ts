// Invitation terms: the name a partner agrees to (LUPE10), what their customers get and what the
// partner earns, set by the owner when inviting them (owner, Nov 21 2026).
//
// Wording and arithmetic only, with no imports. The owner's form, the partner's own page and the
// invitation email all read the same sentences from here, so one set of terms can never be
// described three different ways.

export const MAX_DISCOUNT_PERCENT = 90;
export const INVITE_LINK = 'https://trybiomod.com/account/affiliate';
// The terms the owner does not have to think about for each person. They were the starting values
// on the older per-partner offer form, and each stays editable under "Payment terms".
export const DEFAULT_HOLD_DAYS = 30;
export const DEFAULT_PAYOUT_METHODS = 'Check or ACH';
export const DEFAULT_CHANNELS: readonly string[] = ['online', 'in_person'];
export const MAX_NOTE_LENGTH = 600;

export type InviteTerms = {
    name: string;
    code: string;
    discountPercent: number;
    commissionBps: number;
    holdDays: number;
    payoutMethods: string;
    channels: string[];
};
/** The two figures every partner shares, read from the published agreement rather than typed here. */
export type ProgramTerms = { minimumPayoutCents: number; payoutSchedule: string };

/**
 * The name and the customer discount as one code: "Lupe" at 10% is LUPE10, "Dr. Matt" at 15% is
 * DRMATT15. Returns '' when the name cannot make a code, so the caller asks for one instead of
 * inventing it.
 */
export function partnerCode(name: unknown, discountPercent: unknown, max = 40): string {
    const percent = Number(discountPercent);
    const suffix = Number.isInteger(percent) && percent >= 1 && percent <= MAX_DISCOUNT_PERCENT ? String(percent) : '';
    // NFKD first, so "José" keeps its e and loses only the accent.
    const letters = String(name ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, max - suffix.length);
    const code = letters + suffix;
    return letters && code.length >= 3 ? code : '';
}

/** 1500 -> "15", 1250 -> "12.5". Commission is stored in hundredths of a percent. */
export const percentText = (bps: number): string => String(Math.round(bps) / 100);
/** What the owner typed, as stored: "15" -> 1500. NaN when it is not a number. */
export const commissionBps = (percent: unknown): number => Math.round(Number(percent) * 100);

export function channelsText(channels: readonly string[]): string {
    const online = channels.includes('online'), inPerson = channels.includes('in_person');
    return online && inPerson ? 'online and in person' : inPerson ? 'in person' : 'online';
}
const dollars = (cents: number): string => '$' + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** One line for the owner's screen: what was agreed, in the order they think of it. */
export function termsSentence(terms: Pick<InviteTerms, 'code' | 'discountPercent' | 'commissionBps'>): string {
    return 'Code ' + terms.code + ' · customers get ' + terms.discountPercent + '% off · partner earns ' + percentText(terms.commissionBps) + '% of each sale';
}

/** The terms as the partner reads them. The same four lines appear on their page and in the email. */
export function termsLines(terms: InviteTerms, program: ProgramTerms): string[] {
    return [
        'Your code: ' + terms.code,
        'Your customers get ' + terms.discountPercent + '% off at trybiomod.com, ' + channelsText(terms.channels) + '.',
        'You earn ' + percentText(terms.commissionBps) + '% of each sale made with your code. That is figured on the products after the discount, not on shipping or tax.',
        'Earnings are paid ' + program.payoutSchedule.toLowerCase() + ' by ' + terms.payoutMethods + ' once they reach ' + dollars(program.minimumPayoutCents) + ', after a ' + terms.holdDays + '-day hold.',
    ];
}

export type InvitationMessage = { subject: string; greeting: string; note: string; intro: string; terms: string[]; stepsTitle: string; steps: string[]; closing: string[]; signature: string[]; text: string };

/**
 * The invitation the owner sends. Built here so the preview on the owner's screen is the email that
 * goes out, word for word. `note` is the owner's own optional line; everything else comes from the
 * saved terms and the published agreement.
 */
export function invitationMessage(input: { terms: InviteTerms; program: ProgramTerms; email: string; note?: string }): InvitationMessage {
    const { terms, program, email } = input;
    const note = String(input.note ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTE_LENGTH);
    const subject = 'Your Biomod partner invitation: code ' + terms.code;
    const greeting = 'Hi ' + terms.name + ',';
    const intro = 'You are invited to the Biomod partner program. These are your terms:';
    const lines = termsLines(terms, program);
    const stepsTitle = 'To accept:';
    const steps = [
        'Open ' + INVITE_LINK,
        'Sign in or create an account with this email address (' + email + '). Your invitation is tied to it.',
        'Apply, add your tax details and a photo of your driver’s license, then sign your offer.',
    ];
    const closing = [
        'Your code starts earning once Biomod approves your setup. Your account also has the one-page guide to what partners can say. Please read it before you share your code.',
        'Questions? Reply to this email.',
    ];
    const signature = ['Biomod', 'trybiomod.com'];
    const text = [
        greeting, '',
        ...(note ? [note, ''] : []),
        intro, '',
        ...lines, '',
        stepsTitle,
        ...steps.map((step, index) => (index + 1) + '. ' + step), '',
        ...closing.flatMap(line => [line, '']),
        ...signature,
    ].join('\n');
    return { subject, greeting, note, intro, terms: lines, stepsTitle, steps, closing, signature, text };
}
