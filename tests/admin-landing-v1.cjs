// Real route and navigation components with isolated identities. No live auth or records.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), Module=require('node:module'), ts=require('typescript');
const root=path.resolve(__dirname,'..');
let user=null, authReads=0, cookieReads=0;
const isAdminEmail=email=>['ash@biomodcompounds.com','chris@biomodcompounds.com'].includes(email.trim().toLowerCase());
// Routes resolve roles asynchronously; a synthetic staff member lands in the backend like an owner.
const staffRole=async email=>isAdminEmail(email)?'owner':email.trim().toLowerCase()==='packer@example.invalid'?'fulfillment':null;
const dependencies={
 '@/lib/auth':{customer:async()=>{authReads++;return user;},isAdminEmail,staffRole},
 'next/headers':{cookies:async()=>{cookieReads++;return{get:()=>undefined}}},
 'next/navigation':{redirect:to=>{throw Object.assign(new Error('redirect'),{destination:to})},permanentRedirect:()=>{throw Error('unexpected legacy redirect')},notFound:()=>{throw Error('unexpected missing page')}},
 '@/lib/legacy-routes':{legacyRoutes:{}},
 '@/lib/auth-return':{AUTH_RETURN_COOKIE:'fixture',authRoutes:['login','register','forgot-password','reset-password'],safeAuthReturn:v=>v||'/account'},
 '@/components/store/experience':{Experience:()=>null},
 '@/lib/seo-policy':{pageRecords:{},productAt:()=>null,mayIndex:()=>false},
 '@/lib/seo':{requestSEO:async()=>({}),routeMetadata:()=>({})},
 '@/lib/testing':{batchRecords:[]},
};
function load(file,overrides={}){const f=path.join(root,file),m=new Module(f,module);m.filename=f;m.paths=module.paths;m.require=id=>{if(id in overrides)return overrides[id];if(id in dependencies)return dependencies[id];if(id==='@/lib/preorders')return load('lib/preorders.ts');if(id==='react/jsx-runtime')return require(id);throw Error('Unexpected dependency '+id)};m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,f);return m.exports;}
function nodes(t,out=[]){if(Array.isArray(t))t.forEach(x=>nodes(x,out));else if(t?.props){out.push(t);nodes(t.props.children,out)}return out}
(async()=>{
 dependencies['@/lib/auth-return']=load('lib/auth-return.ts');
 const Page=load('app/[...path]/page.tsx').default;
 const visit=(route,query={})=>Page({params:Promise.resolve({path:route.split('/')}),searchParams:Promise.resolve(query)});
 for(const email of ['ash@biomodcompounds.com','chris@biomodcompounds.com','ASH@BIOMODCOMPOUNDS.COM']){
  user={id:'isolated-admin',email};await assert.rejects(visit('account'),e=>e.destination==='/admin');
  for(const route of ['account/orders','account/profile','account/wishlist']){const before=authReads;await visit(route);assert.equal(authReads,before,'Explicit destinations are preserved; admin guards remain in Admin/API');}
 }
 user=null; await assert.rejects(visit('admin'),e=>e.destination==='/admin/login?returnTo=%2Fadmin');
 await visit('admin/login');
 await assert.rejects(visit('admin',{tab:'promos'}),e=>e.destination==='/admin/login?returnTo=%2Fadmin%3Ftab%3Dpromos');
 for(const email of ['ash@biomodcompounds.com','chris@biomodcompounds.com']){user={email};await assert.rejects(visit('admin/login'),e=>e.destination==='/admin');await visit('admin');}
 // Staff an owner added in the Team tab land in the backend exactly like owners.
 user={id:'packer',email:'Packer@Example.invalid'};await assert.rejects(visit('account'),e=>e.destination==='/admin');await assert.rejects(visit('admin/login'),e=>e.destination==='/admin');
 for(const destination of ['https://evil.example','//evil.example','/account','/admin/login','/%2fevil.example']) await assert.rejects(visit('admin/login',{returnTo:destination}),e=>e.destination==='/admin');
 await assert.rejects(visit('admin/login',{returnTo:'/admin?tab=promos'}),e=>e.destination==='/admin?tab=promos');
 for(const identity of [null,{id:'buyer',email:'buyer@example.invalid'},{id:'lookalike',email:'ash@biomodcompounds.com.evil.invalid'}]){user=identity;await visit('account');}
 let store={customer:null,admin:false,cart:[]};
 const Header=load('components/store/header.tsx',{'./provider':{useStore:()=>({store})},'./product-image':{ProductImage:'img'},'lucide-react':new Proxy({},{get:()=>()=>null}),'@/components/ui/sheet':new Proxy({},{get:()=>()=>null}),'@/lib/catalog':{money:String}}).Header;
 for(const [identity,admin,label,href] of [[null,false,'Sign in','/login'],[{email:'buyer@example.invalid'},false,'My account','/account'],[{email:'ash@biomodcompounds.com'},true,'Store administration','/admin'],[{email:'chris@biomodcompounds.com'},true,'Store administration','/admin']]){store={customer:identity,admin,cart:[]};assert(nodes(Header()).some(n=>n.type==='a'&&n.props['aria-label']===label&&n.props.href===href));}
 // OAuth provider identity, not query/input email, controls the admin destination.
 let providerEmail='buyer@example.invalid', fail=false;
 const GET=load('app/auth/return/route.ts',{'next/server':{NextResponse:{redirect:url=>url.pathname}},'next/headers':{cookies:async()=>({get:()=>({value:'isolated-verifier'}),delete(){}})},'@/lib/auth':{isAdminEmail,staffRole,authCall:async()=>{if(fail)throw Error('isolated auth failure');return {user:{email:providerEmail}}},storeAuth:async()=>{}}}).GET;
 const req={url:'https://example.invalid/auth/return?code=fixture',nextUrl:new URL('https://example.invalid/auth/return?code=fixture')};
 for(const email of ['ash@biomodcompounds.com','chris@biomodcompounds.com']){providerEmail=email;assert.equal(await GET(req),'/admin');}
 providerEmail='packer@example.invalid';assert.equal(await GET(req),'/admin');
 providerEmail='buyer@example.invalid';assert.equal(await GET(req),'/account/profile');fail=true;assert.equal(await GET(req),'/login');
 console.log('PASS: both approved admins land in backend; buyers and lookalikes retain customer landing; explicit customer paths preserved; header links and OAuth authenticated identity route correctly; auth failures fail closed.');
})().catch(e=>{console.error(e);process.exitCode=1});
