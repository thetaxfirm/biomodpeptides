// Open BIOMOD stores as shown on /locations. Planned cities are not listed here.
// components/store/locations.tsx prints the same addresses; tests/store-locations-schema-v1.cjs keeps them in step.
export const storeLocations = [
  { id: 'las-vegas', name: 'BIOMOD Las Vegas', street: '6625 S Valley View Blvd, Suite D420', city: 'Las Vegas', region: 'NV', postalCode: '89118' },
  { id: 'st-george', name: 'BIOMOD St. George', street: '422 W Lamond Circle', city: 'Washington', region: 'UT', postalCode: '84780' },
  { id: 'el-paso', name: 'BIOMOD El Paso', street: '2079 Sun Bolt Way', city: 'El Paso', region: 'TX', postalCode: '79938' },
] as const;

// Store nodes for the /locations page. Only facts printed on the page: name and address. No hours or phone are published.
export const storeLocationNodes = (origin: string, organizationId: string) => storeLocations.map(s => ({
  '@type': 'Store', '@id': origin + '/locations#' + s.id, name: s.name, url: origin + '/locations',
  image: origin + '/brand/original-locations-v11.jpeg', parentOrganization: { '@id': organizationId },
  address: { '@type': 'PostalAddress', streetAddress: s.street, addressLocality: s.city, addressRegion: s.region, postalCode: s.postalCode, addressCountry: 'US' },
}));
