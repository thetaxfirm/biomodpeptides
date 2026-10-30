// Store staff roles. Shared by the server (authorization) and the admin UI (which tabs and
// controls to show). The server is the authority; hiding a control is only a convenience.
//
// Owners are the addresses in STORE_ADMIN_EMAILS (Cloudflare runtime setting). Owners add
// everyone else from the admin Team tab; those rows live in the D1 `staff` table and can
// never be owners, so a database row cannot lock an owner out or create a second owner.
export const staffRoles = ['owner', 'manager', 'fulfillment', 'support', 'catalog'] as const;
export type StaffRole = typeof staffRoles[number];
export const assignableRoles = ['manager', 'fulfillment', 'support', 'catalog'] as const;
export type AssignableRole = typeof assignableRoles[number];

export type StaffPermission =
  | 'orders:read'      // order list, customer shipping details, payment state
  | 'orders:fulfill'   // buy labels, tracking, shipped/delivered confirmation
  | 'orders:reconcile' // re-check a payment with the provider
  | 'requests:write'   // customer request inbox and sending original COAs
  | 'requests:send'    // send desk replies to customers directly (owner request Oct 30 2026; staff sends are blind-copied to the owner)
  | 'store:write'      // settings, presales, rewards, promos, affiliates, COA email settings
  | 'catalog:write'    // product editor: prices, pack prices, sales, lot and COA report links
  | 'reports:read'     // promo/affiliate, sales, traffic, search and change reports
  | 'team:manage';     // add, change or remove staff

const permissions: Record<StaffRole, readonly StaffPermission[]> = {
  owner: ['orders:read', 'orders:fulfill', 'orders:reconcile', 'requests:write', 'requests:send', 'store:write', 'catalog:write', 'reports:read', 'team:manage'],
  manager: ['orders:read', 'orders:fulfill', 'orders:reconcile', 'requests:write', 'store:write', 'catalog:write', 'reports:read'],
  fulfillment: ['orders:read', 'orders:fulfill', 'orders:reconcile'],
  support: ['orders:read', 'orders:reconcile', 'requests:write', 'requests:send'],
  // Owner request, Oct 30 2026: pricing and COA upkeep without orders, customers, reports or settings.
  catalog: ['catalog:write'],
};
/** Product fields the Catalog role may change. Everything else in a product save keeps its current value. */
export const catalogEditableFields = ['price', 'packPrices', 'sale', 'batch'] as const;

export const roleDetails: Record<StaffRole, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including staff access. Set in Cloudflare, not here.' },
  manager: { label: 'Manager', description: 'Runs the store: orders, products, prices, promos, reports and requests. Cannot manage staff.' },
  fulfillment: { label: 'Fulfillment', description: 'Sees orders and ships them: labels, tracking and delivery status.' },
  support: { label: 'Support', description: 'Sees orders and answers customer requests, and can send replies (the owner gets a blind copy). Cannot ship, edit products or see reports.' },
  catalog: { label: 'Catalog', description: 'Products only: prices, pack prices, sales and lot/COA links. Cannot see orders, customers, reports or settings, or change stock.' },
};

export const isStaffRole = (value: unknown): value is StaffRole => staffRoles.includes(value as StaffRole);
export const isAssignableRole = (value: unknown): value is AssignableRole => assignableRoles.includes(value as AssignableRole);
export const permissionsFor = (role: StaffRole | null | undefined): StaffPermission[] => role && isStaffRole(role) ? [...permissions[role]] : [];
export const can = (role: StaffRole | null | undefined, permission: StaffPermission) => permissionsFor(role).includes(permission);

// The permission each admin tab needs. A tab missing here is never shown.
export const tabPermission: Record<string, StaffPermission> = {
  overview: 'orders:read', orders: 'orders:read', requests: 'requests:write',
  promos: 'reports:read', contacts: 'reports:read', diagnostics: 'reports:read', traffic: 'reports:read', search: 'reports:read', changes: 'reports:read',
  affiliates: 'store:write', settings: 'store:write', products: 'catalog:write', presales: 'store:write', rewards: 'store:write',
  team: 'team:manage',
};
export const canSeeTab = (role: StaffRole | null | undefined, tab: string) => Boolean(tabPermission[tab]) && can(role, tabPermission[tab]);

export const normalizeStaffEmail = (email: string) => email.trim().toLowerCase();
export const validStaffEmail = (email: string) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email) && email.length <= 254;
