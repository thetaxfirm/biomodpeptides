/**
 * Night mode for administration (owner, Nov 13 2026).
 *
 * Deliberately a device preference, not a store setting: it is kept in this browser's local
 * storage and never sent anywhere, so switching it on changes nothing for another administrator,
 * for staff, or for a customer. There is no server field to get out of step with.
 *
 * Every function here tolerates having no browser at all (server rendering, a test harness) and
 * storage that refuses to answer (private browsing, blocked site data), because a preference that
 * cannot be read must never stop administration from loading.
 */
export const THEME_KEY = 'bm_admin_theme';
export type Theme = 'dark' | 'light';

/** The saved preference for this browser, or 'light' when there is none or it cannot be read. */
export function readTheme(): Theme {
    try {
        if (typeof localStorage === 'undefined') return 'light';
        return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch { return 'light'; }
}

/** Remembers the choice for this browser only. A refusal is not an error worth showing. */
export function saveTheme(theme: Theme): void {
    try {
        if (typeof localStorage === 'undefined') return;
        if (theme === 'dark') localStorage.setItem(THEME_KEY, 'dark');
        else localStorage.removeItem(THEME_KEY);
    } catch { /* storage is a convenience here, never a requirement */ }
}

/**
 * Marks the document so the stylesheet can answer. The attribute lives on <html> rather than on a
 * wrapper so the page background changes too, and is removed outright in light mode so there is
 * no dark rule left to win a later cascade.
 */
export function applyTheme(theme: Theme): void {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
}
