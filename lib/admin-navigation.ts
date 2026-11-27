// Every page administration can open. Each keeps its own address (?tab=traffic), whether it is
// reached directly or from a section's dropdown.
//
// Businesses still answers at ?tab=restaurants. The programme was named for restaurants when it
// was built and widened on Nov 17 2026 to med spas, clinics and anyone else; the label is what the
// owner reads, and changing the address would break links already saved for no gain.
export const adminTabs = [
    ['overview', 'Today'], ['orders', 'Orders'], ['requests', 'Requests'], ['products', 'Products'],
    ['affiliates', 'Affiliate program'], ['restaurants', 'Businesses'],
    ['contacts', 'Contacts'], ['promos', 'Promo codes'], ['presales', 'Presales'], ['rewards', 'Rewards'], ['settings', 'Settings'], ['team', 'Team'], ['updates', 'Website updates'],
    ['diagnostics', 'Sales reports'], ['traffic', 'Traffic'], ['search', 'Search'], ['changes', 'Change log'],
] as const;
/**
 * The sections down the side, in the order the day runs (owner, Nov 13 2026).
 *
 * A section holding one page is that page. A section holding several opens a dropdown and its
 * pages are real destinations, so Businesses is its own screen rather than a fold buried in the
 * middle of the affiliate page. Pressing the section itself opens the page it is showing, which is
 * what a touch screen does with a hover menu.
 */
export const adminSections: readonly { label: string; tabs: readonly string[] }[] = [
    { label: 'Today', tabs: ['overview'] },
    { label: 'Orders', tabs: ['orders'] },
    { label: 'Requests', tabs: ['requests'] },
    { label: 'Products', tabs: ['products', 'presales'] },
    { label: 'Website updates', tabs: ['updates'] },
    { label: 'Affiliates', tabs: ['affiliates', 'restaurants'] },
    { label: 'Customers', tabs: ['contacts', 'rewards'] },
    { label: 'Promo codes', tabs: ['promos'] },
    { label: 'Settings', tabs: ['settings', 'team', 'changes'] },
    { label: 'Reports', tabs: ['diagnostics', 'traffic', 'search'] },
];
export const tabLabel = (tab: string) => adminTabs.find(([value]) => value === tab)?.[1] || tab;
export function validAdminTab(value?: string) { return adminTabs.some(([tab]) => tab === value) ? value! : 'overview'; }
