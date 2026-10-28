// Customer-facing BioMod identity only. Staff audit actors and transport addresses stay separate.
export const CUSTOMER_MAIL_NAME = 'Kim C.';
export const CUSTOMER_MAIL_TEAM = 'BioMod Customer Care';
export const CUSTOMER_MAIL_DISPLAY_NAME = CUSTOMER_MAIL_NAME + ' | ' + CUSTOMER_MAIL_TEAM;
export const CUSTOMER_MAIL_SIGNATURE_TEXT = CUSTOMER_MAIL_NAME + '\n' + CUSTOMER_MAIL_TEAM;
export const CUSTOMER_MAIL_SIGNATURE_HTML = '<p>' + CUSTOMER_MAIL_NAME + '<br>' + CUSTOMER_MAIL_TEAM + '</p>';
/** Replace only the display name. Preserve the configured mailbox and existing transport validation. */
export function customerMailFrom(sender: string): string {
    const match = /^(?:[^<>]+ <([^<>]+)>|([^<>]+))$/.exec(sender.trim());
    const address = match?.[1] || match?.[2];
    if (/[\x00-\x1f\x7f]/.test(sender) || !address || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) return sender;
    return CUSTOMER_MAIL_DISPLAY_NAME + ' <' + address + '>';
}
