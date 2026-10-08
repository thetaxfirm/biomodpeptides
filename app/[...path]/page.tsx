import { legacyRoutes } from '@/lib/legacy-routes';
import { cookies } from 'next/headers';
import { AUTH_RETURN_COOKIE, authRoutes, safeAuthReturn } from '@/lib/auth-return';
import { Experience } from '@/components/store/experience';
import { notFound, permanentRedirect } from 'next/navigation';
import { pageRecords, productAt, mayIndex } from '@/lib/seo-policy';
import { routeMetadata, requestSEO, routeStructuredData, jsonLd } from '@/lib/seo';
import { batchRecords } from '@/lib/testing';

type Props = { params: Promise<{ path: string[] }>; searchParams: Promise<Record<string, string | string[]>> };
export const dynamic = 'force-dynamic';
const queryParams = (query: Record<string, string | string[]>) => new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => [key, v])));
function validPath(path: string) {
  if (pageRecords['/' + path] || productAt('/' + path)) return true;
  if (['cart', 'checkout', 'payment/return', 'login', 'register', 'forgot-password', 'reset-password', 'admin', 'account', 'about-biomod', 'coa', 'affiliate-program'].includes(path)) return true;
  if (/^account\/(orders|addresses|wishlist|rewards|affiliate|notifications|profile)$/.test(path)) return true;
  if (path.startsWith('testing/')) return batchRecords.some(record => record.record_id === path.slice(8) || record.product_lot === path.slice(8));
  return false;
}
export async function generateMetadata({ params, searchParams }: Props) {
  const { path } = await params;
  if (legacyRoutes[path.join('/')]) permanentRedirect(legacyRoutes[path.join('/')]);
  if (!validPath(path.join('/'))) notFound();
  return routeMetadata('/' + path.join('/'), queryParams(await searchParams), await requestSEO());
}
export default async function Page({ params, searchParams }: Props) {
  const { path } = await params, route = path.join('/');
  if (legacyRoutes[route]) permanentRedirect(legacyRoutes[route]);
  if (!validPath(route)) notFound();
  if (route === 'about-biomod') permanentRedirect('/about');
  if (route === 'coa') permanentRedirect('/testing');
  if (route === 'affiliate-program') permanentRedirect('/account/affiliate');
  const query = { ...await searchParams };
  if (authRoutes.some(authRoute => authRoute === route)) {
    const requested = query.returnTo ?? query.redirect;
    const destination = Array.isArray(requested) ? requested[0] : requested;
    query.returnTo = safeAuthReturn(destination ?? (await cookies()).get(AUTH_RETURN_COOKIE)?.value);
  }
  const seo = await requestSEO();
  const data = mayIndex('/' + route, queryParams(query), seo) ? await routeStructuredData('/' + route, seo) : null;
  return <main id="main-content" className="wrap page-content">{data && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }}/>}<Experience path={route} query={Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] || '' : value]))}/></main>;
}
