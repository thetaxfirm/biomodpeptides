"use client";
import { usePathname } from 'next/navigation';
import { Header } from './header';
import { Footer } from './content';
import styles from './store-chrome.module.css';

export function StoreChrome({ children }: { children: React.ReactNode }) {
    const path = usePathname();
    if (path !== '/admin' && path !== '/admin/') return <><Header/>{children}<Footer/></>;
    return <>
        <header className={styles.header}>
            <a href="/admin" aria-label="TryBiomod administration home"><img src="/brand/logo-navy-tm-v36.svg" alt="BIOMOD" width="200" height="65"/></a>
            <span>TryBiomod Administration</span>
            <a href="/">View storefront</a>
        </header>
        {children}
        <footer className={styles.footer}>trybiomod.com · Administrator access only</footer>
    </>;
}
