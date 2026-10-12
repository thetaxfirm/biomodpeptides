import { cache } from 'react';
import { config } from './commerce';

import { shippingTerms } from './shipping-terms';

const publicShippingTerms = cache(async () => {
  try { return shippingTerms(await config()); }
  catch { return null; }
});

export async function merchantPolicies(origin: string) {
  const shipping = await publicShippingTerms();
  const hasMerchantReturnPolicy = {
    '@type': 'MerchantReturnPolicy',
    '@id': origin + '/returns-refunds#policy',
    merchantReturnLink: origin + '/returns-refunds',
  };
  const hasShippingService = shipping?.freeThreshold != null ? {
    '@type': 'ShippingService',
    '@id': origin + '/shipping-policy#standard-shipping',
    name: 'Standard U.S. shipping',
    description: shipping.standard + ' Shipping charges for lower order totals are shown at checkout before payment.',
    fulfillmentType: 'https://schema.org/FulfillmentTypeDelivery',
    shippingConditions: [{
      '@type': 'ShippingConditions',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
      orderValue: { '@type': 'MonetaryAmount', minValue: shipping.freeThreshold / 100, currency: 'USD' },
      shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
    }],
  } : null;
  return { hasMerchantReturnPolicy, hasShippingService };
}
