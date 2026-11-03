'use client';
import { Newsroom, PressReleasePage } from './newsroom';
import { Shop, ProductPage, PackBuilder, Presales } from './catalog';
import { AuthPage, Cart, Checkout, Account, PaymentReturn } from './account';
import { Testing } from './testing';
import { Contact, ContentPage } from './content';
import { Admin } from './admin';
import { Locations } from './locations';
import { Softgels } from './softgels';
import { Blank } from './primitives';
import { CompoundIndex, CompoundPage, ComparisonPage, VerifyCoa } from './compound-reference';
import { compoundAt, comparisonAt } from '@/lib/compound-reference';
import { CollectionIndex, CollectionPage } from './collections';
import { collectionAt } from '@/lib/collections';
export function Experience({ path, query }: {
    path: string;
    query: Record<string, string>;
}) { if (path === 'admin/login') return <AuthPage returnTo={query.returnTo || '/admin'}/>; if (path === 'softgels') return <Softgels/>; if (path === 'locations') return <Locations/>; if (path === 'shop')
    return <Shop search={query.q || ''} category={query.category === 'research-peptides' || (!query.category && !query.q) ? 'research-compounds' : (query.category || '')}/>; if (path.startsWith('product/'))
    return <ProductPage slug={path.slice(8)}/>; if (path === 'multi-pack')
    return <PackBuilder initialSize={Number(query.size || query.items) || 3}/>; if (path === 'presales')
    return <Presales />; if (path === 'testing' || path === 'coa' || path.startsWith('testing/'))
    return <Testing product={query.product} lot={path.startsWith('testing/') ? decodeURIComponent(path.slice(8)) : ''}/>; if (path === 'cart')
    return <Cart />; if (path === 'checkout')
    return <Checkout />; if (path === 'payment/return')
    return <PaymentReturn />; if (['login', 'register', 'forgot-password', 'reset-password'].includes(path))
    return <AuthPage mode={path} returnTo={query.returnTo || query.redirect || '/account'}/>; if (path === 'account' || path.startsWith('account/'))
    return <Account section={path.slice(8)}/>; if (path === 'contact')
    return <Contact subject={query.subject||''}/>; if (path === 'admin')
    return <Admin initialTab={query.tab} initialRequest={query.request}/>; if (['about', 'quality-standard', 'choosing-a-research-supplier', 'research-use-only', 'shipping-policy', 'returns-refunds', 'terms-of-sale', 'privacy-policy', 'international-partners', 'faq'].includes(path))
    return <ContentPage path={path}/>; if (path === 'compounds')
    return <CompoundIndex/>; if (path.startsWith('compounds/') && compoundAt(path.slice(10)))
    return <CompoundPage slug={path.slice(10)}/>; if (path.startsWith('compare/') && comparisonAt(path.slice(8)))
    return <ComparisonPage slug={path.slice(8)}/>; if (path === 'verify')
    return <VerifyCoa/>; if (path === 'collections')
    return <CollectionIndex/>; if (path.startsWith('collections/') && collectionAt(path.slice(12)))
    return <CollectionPage slug={path.slice(12)}/>; if (path === 'news')
    return <Newsroom/>; if (path.startsWith('news/'))
    return <PressReleasePage slug={path.slice(5)}/>; if (path === 'about-biomod')
    return <ContentPage path="about"/>; if (path === 'affiliate-program')
    return <Account section="affiliate"/>; return <Blank title="Page not found."><a href="/shop">Return to the catalog</a></Blank>; }
