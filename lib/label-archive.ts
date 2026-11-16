/**
 * A folder of print-ready labels, downloaded in one press (owner, Nov 16 2026).
 *
 * The old button opened an HTML sheet of <img> tags: bordered, scaled to whatever paper the
 * printer guessed at, and useless for a 4x6 label printer. This builds the same thing the single
 * label route already serves -- one borderless four-by-six PDF per parcel -- and puts them in a zip.
 *
 * A browser cannot be handed a folder, so the zip IS the folder: every entry sits under one
 * directory named for the day, so unzipping always produces `biomod-labels-2026-11-16/` rather
 * than scattering loose files into Downloads.
 *
 * Entries are STORED, not deflated. A PDF carrying an already-compressed image does not shrink,
 * and storing keeps this small enough to read in one sitting -- which matters more here than a few
 * per cent, because a wrong byte in an archive is a day of parcels nobody can post.
 */
import { pacific } from './ship-cutoff';

export const ARCHIVE_PREFIX = 'biomod-labels';
/** The folder inside the archive, and the archive's own stem: the Pacific shipping day. */
export const archiveFolder = (at: number): string => ARCHIVE_PREFIX + '-' + pacific(at).day;
export const archiveName = (at: number): string => archiveFolder(at) + '.zip';

export type ArchiveEntry = { name: string; bytes: Uint8Array };

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * A name that cannot escape the archive's own folder. Everything outside the allowed set goes,
 * including the separators and dots that make `../` mean something, because these names are built
 * from saved customer data.
 */
export function safeEntryName(value: unknown, fallback: string): string {
    const clean = String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '').slice(0, 100);
    return clean || fallback;
}

/** DOS date and time, which is what a zip entry records. Out-of-range years clamp to 1980. */
function dosStamp(at: number): { time: number; date: number } {
    const d = new Date(at);
    const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
    return {
        time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    };
}

/**
 * The archive. Names are made unique before anything is written, because two parcels for the same
 * person on the same day would otherwise collide and the second would quietly win on extraction.
 */
export function zipArchive(entries: readonly ArchiveEntry[], at: number): Uint8Array {
    const folder = archiveFolder(at);
    const { time, date } = dosStamp(at);
    const used = new Set<string>();
    const files = entries.map((entry, index) => {
        const base = safeEntryName(entry.name, 'label-' + (index + 1) + '.pdf');
        let name = base, n = 2;
        while (used.has(name.toLowerCase())) {
            const dot = base.lastIndexOf('.');
            name = dot > 0 ? base.slice(0, dot) + '-' + n + base.slice(dot) : base + '-' + n;
            n++;
        }
        used.add(name.toLowerCase());
        return { path: folder + '/' + name, bytes: entry.bytes, crc: crc32(entry.bytes) };
    });

    const encoder = new TextEncoder();
    const named = files.map(file => ({ ...file, raw: encoder.encode(file.path) }));
    const local = named.reduce((sum, f) => sum + 30 + f.raw.length + f.bytes.length, 0);
    const central = named.reduce((sum, f) => sum + 46 + f.raw.length, 0);
    const out = new Uint8Array(local + central + 22);
    const view = new DataView(out.buffer);
    let at16 = 0;
    const u16 = (v: number) => { view.setUint16(at16, v, true); at16 += 2; };
    const u32 = (v: number) => { view.setUint32(at16, v >>> 0, true); at16 += 4; };
    const raw = (v: Uint8Array) => { out.set(v, at16); at16 += v.length; };

    const offsets: number[] = [];
    for (const file of named) {
        offsets.push(at16);
        u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(time); u16(date);
        u32(file.crc); u32(file.bytes.length); u32(file.bytes.length);
        u16(file.raw.length); u16(0);
        raw(file.raw); raw(file.bytes);
    }
    const centralAt = at16;
    named.forEach((file, i) => {
        u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(time); u16(date);
        u32(file.crc); u32(file.bytes.length); u32(file.bytes.length);
        u16(file.raw.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
        raw(file.raw);
    });
    // Captured before the record is written: once writing starts, at16 has moved past the central
    // directory and reporting its size from there overstates it by the length of this record.
    const centralEnd = at16;
    u32(0x06054b50); u16(0); u16(0); u16(named.length); u16(named.length);
    u32(centralEnd - centralAt); u32(centralAt); u16(0);
    return out;
}
