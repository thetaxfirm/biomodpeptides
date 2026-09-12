import type { Metadata } from "next";
import { Header } from "@/components/store/header";
import "./globals.css";
import "./storefront-v6.css";
import "./storefront-v7.css";
import "./storefront-v9.css";
import "./storefront-v10.css";
import {AgeGate} from "@/components/store/age-gate";
import {StoreProvider} from "@/components/store/provider";
import {Footer} from "@/components/store/content";
export const metadata: Metadata={title:{default:"BIOMOD Peptides | Research Supplies",template:"%s | BIOMOD Peptides"},description:"Explore BIOMOD research peptides, softgels and sprays. Product specifications and lot-level research documentation.",icons:{icon:"/favicon.svg"},robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><StoreProvider><Header/>{children}<Footer/><AgeGate/></StoreProvider></body></html>}
