import { cache } from 'react';
import { config } from './commerce';
import { catalogService, freeShippingService, normalizeShippingOptions } from './shipping-options';
import { shippingCutoffTime, shippingTerms } from './shipping-terms';

const publicShippingTerms = cache(async () => {
  try {
    const current = await config();
    return { terms: shippingTerms(current), free: current ? freeShippingService(normalizeShippingOptions(current.shippingOptions)) : null };
  }
  catch { return null; }
});

const days = (minValue: number, maxValue: number) => ({ '@type': 'QuantitativeValue', minValue, maxValue, unitCode: 'DAY' });
const businessDays = { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => 'https://schema.org/' + day) };

/** Carrier transit estimate from the service catalog, e.g. "Usually 1 to 3 business days". Only a single named service has one. */
function transitDays(key: string | null | undefined) {
  const match = key ? /(\d+) to (\d+) business days/.exec(catalogService(key)?.detail || '') : null;
  return match ? days(Number(match[1]), Number(match[2])) : null;
}

export async function merchantPolicies(origin: string) {
  const current = await publicShippingTerms();
  const shipping = current?.terms;
  const hasMerchantReturnPolicy = {
    '@type': 'MerchantReturnPolicy',
    '@id': origin + '/returns-refunds#policy',
    merchantReturnLink: origin + '/returns-refunds',
  };
  const transit = transitDays(current?.free?.key);
  const hasShippingService = shipping?.freeThreshold != null ? {
    '@type': 'ShippingService',
    '@id': origin + '/shipping-policy#standard-shipping',
    name: current?.free?.tier === 'expedited' ? current.free.label : 'Standard U.S. shipping',
    description: shipping.standard + ' Shipping charges for lower order totals are shown at checkout before payment.',
    fulfillmentType: 'https://schema.org/FulfillmentTypeDelivery',
    // Same-day processing before 2 p.m. Pacific on weekdays is the published shipping policy (FAQ and shipping page).
    handlingTime: { '@type': 'ServicePeriod', duration: days(0, 1), businessDays, cutoffTime: shippingCutoffTime() },
    shippingConditions: [{
      '@type': 'ShippingConditions',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
      orderValue: { '@type': 'MonetaryAmount', minValue: shipping.freeThreshold / 100, currency: 'USD' },
      shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
      ...(transit ? { transitTime: { '@type': 'ServicePeriod', duration: transit, businessDays } } : {}),
    }],
  } : null;
  return { hasMerchantReturnPolicy, hasShippingService };
}
