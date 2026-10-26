import { pressReleases } from '@/lib/press-releases';
import type { Metadata } from "next";
import { StoreChrome } from "@/components/store/store-chrome";
import "./globals.css";
import "./storefront-v6.css";
import "./storefront-v7.css";
import "./storefront-v9.css";
import "./storefront-v10.css";
import "./storefront-v11.css";
import "./storefront-v12.css";
import "./storefront-v14.css";
import "./storefront-v18.css";
import "./storefront-v23.css";
import "./storefront-v24.css";
import "./storefront-v25.css";
import "./storefront-v34.css";
import "./storefront-v35.css";
import "./storefront-v36.css";
import {StoreProvider} from "@/components/store/provider";
import { publicCatalog } from '@/lib/public-catalog';
import { TrafficMeasurement } from '@/components/store/traffic-measurement';
import { trafficConfiguration } from '@/lib/traffic-metrics';
import { shoppingConfiguration } from '@/lib/shopping-metrics';
import { runtime } from '@/lib/runtime';
import searchPublication from '@/lib/seo-publication-v1.json';

export const metadata: Metadata={title:{default:"Biomod Research Supply Company | TryBiomod",template:"%s | Biomod Research Supply Company"},description:"Biomod Research Supply Company at TryBiomod.com. Research compound vials, product specifications and available lot-level documentation. For laboratory research only.",icons:{icon:"/favicon.svg"},robots:{index:false,follow:false}};
export default async function RootLayout({children}:{children:React.ReactNode}){const snapshot=await publicCatalog(); return <html lang="en"><body><StoreProvider initialCatalog={snapshot.products} shoppingMeasurementEnabled={shoppingConfiguration(runtime()).enabled}><TrafficMeasurement enabled={trafficConfiguration(runtime()).enabled} reviewedProductSlugs={searchPublication.productSlugs} publishedNewsSlugs={pressReleases.map(release => release.slug)}/><StoreChrome>{children}</StoreChrome></StoreProvider></body></html>}
