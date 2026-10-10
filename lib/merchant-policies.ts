import { cache } from 'react';
import { config } from './commerce';

// Matches the published shipping policy. Suppress shipping markup if a store
// setting changes until its customer-facing policy is updated in the same release.
const publishedFreeShippingAt = 20000;
const publicShippingTerms = cache(async () => {
  try {
    const current = await config();
    if (!Number.isSafeInteger(current.freeShippingAt) || current.freeShippingAt !== publishedFreeShippingAt) return null;
    return { freeShippingAt: current.freeShippingAt };
  } catch {
    // An unavailable store configuration cannot establish a free-shipping offer.
    return null;
  }
});

export async function merchantPolicies(origin: string) {
  const shipping = await publicShippingTerms();
  const hasMerchantReturnPolicy = {
    '@type': 'MerchantReturnPolicy',
    '@id': origin + '/returns-refunds#policy',
    merchantReturnLink: origin + '/returns-refunds',
  };
  const hasShippingService = shipping ? {
    '@type': 'ShippingService',
    '@id': origin + '/shipping-policy#standard-shipping',
    name: 'Standard U.S. shipping',
    description: 'Standard U.S. shipping is free on orders of $200 or more after discounts and before tax. Shipping charges for lower order totals are shown at checkout before payment.',
    fulfillmentType: 'https://schema.org/FulfillmentTypeDelivery',
    shippingConditions: [{
      '@type': 'ShippingConditions',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
      orderValue: { '@type': 'MonetaryAmount', minValue: shipping.freeShippingAt / 100, currency: 'USD' },
      shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
    }],
  } : null;
  return { hasMerchantReturnPolicy, hasShippingService };
}
