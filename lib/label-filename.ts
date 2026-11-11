/**
 * What a downloaded label is called on disk.
 *
 * A folder of files called label-A8D80C15-4x6.pdf tells you nothing while you are matching printed
 * labels to boxes. The recipient's name does, so that leads (owner, Nov 11 2026).
 *
 * The order number stays on the end, because two orders for one person in one day is not unusual --
 * it has already happened here -- and two files called "Sam Miklosko.pdf" become "Sam Miklosko.pdf"
 * and "Sam Miklosko (1).pdf", which is exactly the confusion this is meant to remove.
 */
const ILLEGAL = /[\\/:*?"<>|]/g;          // rejected by Windows, awkward everywhere else
const CONTROL = /[\u0000-\u001f\u007f]/g; // a newline here would split the header in two

/** A person's name, reduced to something every operating system will accept as a file name. */
export function safeNamePart(value: unknown, max = 60): string {
    const name = String(value ?? '')
        .replace(CONTROL, ' ')
        .replace(ILLEGAL, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        // Windows refuses a name ending in a dot or a space, and a leading dot hides the file.
        .replace(/^[.\s]+|[.\s]+$/g, '');
    return name.slice(0, max).trim();
}

export const orderNumber = (id: string) => String(id || '').slice(0, 8).toUpperCase();

/**
 * "Kim Leader A8D80C15.pdf". Falls back to the order number alone when the address carries no
 * usable name, which is better than a file called ".pdf" or one named after an empty string.
 */
export function labelFileName(id: string, name: unknown, extension: string): string {
    const number = orderNumber(id);
    const person = safeNamePart(name);
    return (person ? person + ' ' + number : 'Order ' + number + ' label') + '.' + extension;
}

/**
 * A Content-Disposition value carrying the name twice: a plain ASCII form every client understands,
 * and an RFC 5987 form so an accented name survives intact in the browsers that read it. The quoted
 * form is stripped to ASCII rather than mangled, because a stray byte there breaks the header.
 */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
    const stripped = fileName.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim();
    // A name written entirely in another alphabet strips to nothing, or to a bare ".pdf" -- which is
    // a hidden file on Unix and no name at all. Keep the extension and give it something to hold.
    const dot = stripped.lastIndexOf('.');
    const ascii = dot > 0 ? stripped : 'label' + (dot === 0 ? stripped : '');
    const encoded = encodeURIComponent(fileName).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return kind + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encoded;
}
