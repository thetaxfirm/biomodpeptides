import {Experience} from '@/components/store/experience';
export default async function Page({params,searchParams}:{params:Promise<{path:string[]}>;searchParams:Promise<Record<string,string>>}){const {path}=await params;return <main id="main-content" className="wrap page-content"><Experience path={path.join('/')} query={await searchParams}/></main>}
