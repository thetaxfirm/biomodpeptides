'use client';
import { Shop, ProductPage, PackBuilder, Presales } from './catalog';
import { AuthPage, Cart, Checkout, Account, PaymentReturn } from './account';
import { Testing } from './testing';
import { Contact, ContentPage } from './content';
import { Admin } from './admin';
import { Blank } from './primitives';
export function Experience({ path, query }: {
    path: string;
    query: Record<string, string>;
}) { if (path === 'shop')
    return <Shop search={query.q || ''}/>; if (path.startsWith('product/'))
    return <ProductPage slug={path.slice(8)}/>; if (path === 'multi-pack')
    return <PackBuilder initialSize={Number(query.size || query.items) || 3}/>; if (path === 'presales')
    return <Presales />; if (path === 'testing' || path === 'coa' || path.startsWith('testing/'))
    return <Testing product={query.product} lot={path.startsWith('testing/') ? decodeURIComponent(path.slice(8)) : ''}/>; if (path === 'cart')
    return <Cart />; if (path === 'checkout')
    return <Checkout />; if (path === 'payment/return')
    return <PaymentReturn />; if (['login', 'register', 'forgot-password', 'reset-password'].includes(path))
    return <AuthPage mode={path} returnTo={query.redirect || '/account'}/>; if (path === 'account' || path.startsWith('account/'))
    return <Account section={path.slice(8)}/>; if (path === 'contact')
    return <Contact />; if (path === 'admin')
    return <Admin />; if (['about', 'quality-standard', 'research-use-only', 'shipping-policy', 'returns-refunds', 'terms-of-sale', 'privacy-policy', 'international-partners', 'faq'].includes(path))
    return <ContentPage path={path}/>; if (path === 'about-biomod')
    return <ContentPage path="about"/>; if (path === 'affiliate-program')
    return <Account section="affiliate"/>; return <Blank title="Page not found."><a href="/shop">Return to the catalog</a></Blank>; }
