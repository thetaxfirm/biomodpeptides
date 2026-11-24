type StoreLocation = {
  id: string;
  label: string;
  state: string;
  status: 'Current location' | 'New location';
  street: string;
  suite?: string;
  city: string;
  region: string;
  postalCode: string;
  contactRegion: string;
};

// Published BIOMOD stores. The Locations page, directions and Store markup share these addresses.
export const storeLocations: readonly StoreLocation[] = [
  {
    id: 'las-vegas', label: 'Las Vegas', state: 'Nevada', status: 'Current location',
    street: '6625 S Valley View Blvd', suite: 'Suite D420', city: 'Las Vegas', region: 'NV', postalCode: '89118',
    contactRegion: 'Las Vegas',
  },
  {
    id: 'st-george', label: 'St. George', state: 'Utah', status: 'Current location',
    street: '422 W Lamond Circle', city: 'Washington', region: 'UT', postalCode: '84780',
    contactRegion: 'Utah',
  },
  {
    id: 'el-paso', label: 'El Paso', state: 'Texas', status: 'New location',
    street: '2079 Sun Bolt Way', city: 'El Paso', region: 'TX', postalCode: '79938',
    contactRegion: 'El Paso',
  },
];

const streetAddress = (store: StoreLocation) => [store.street, store.suite].filter(Boolean).join(', ');
export const storeLocality = (store: StoreLocation) => `${store.city}, ${store.region} ${store.postalCode}`;

export function storeDirectionsUrl(store: StoreLocation) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${streetAddress(store)}, ${storeLocality(store)}, USA`);
  return url.href;
}

// Store nodes for the /locations page. Only facts printed on the page: name and address. No hours or phone are published.
export const storeLocationNodes = (origin: string, organizationId: string) => storeLocations.map(s => ({
  '@type': 'Store', '@id': origin + '/locations#' + s.id, name: 'BIOMOD ' + s.label, url: origin + '/locations',
  image: origin + '/brand/original-locations-v11.jpeg', parentOrganization: { '@id': organizationId },
  address: { '@type': 'PostalAddress', streetAddress: streetAddress(s), addressLocality: s.city, addressRegion: s.region, postalCode: s.postalCode, addressCountry: 'US' },
}));
