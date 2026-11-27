// Real Chrome + built Worker. Fresh profile, isolated D1 and synthetic records only.
// Build the chosen root first with BIOMOD_DEPLOY=true npm run build. No automatic build/install.
// PLAYWRIGHT_MODULE points to an externally installed Playwright index.mjs; CHROME_EXECUTABLE overrides Chrome.
// BIOMOD_BROWSER_SCREENSHOTS overrides the synthetic screenshots/report destination.
// BIOMOD_BROWSER_CASE selects scenario names by regular expression for diagnosis.
// Example: BIOMOD_BROWSER_ROOT=/path/to/build PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/admin-browser-v1.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';
const root = path.resolve(process.env.BIOMOD_BROWSER_ROOT || process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const screenshots = process.env.BIOMOD_BROWSER_SCREENSHOTS || path.join(os.homedir(), 'Documents/AI Workspace/Temp/codex/trybiomod-admin-fixes-20261127');
await fs.mkdir(screenshots, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-admin-browser-'));
const files = (await fs.readdir(built, { recursive: true })).filter(n => /\.(?:m?js)$/.test(n));
const origin = 'https://trybiomod.com';
const owner = '10000000-0000-4000-8000-000000000001', session = '10000000-0000-4000-8000-000000000002';
const buyer = '10000000-0000-4000-8000-000000000003', order = '10000000-0000-4000-8000-000000000004', request = '10000000-0000-4000-8000-000000000005';
const preorder = '20000000-0000-4000-8000-000000000006';
const email = 'admin-browser-fixture@example.invalid';
const providerCalls = [], browserBlocked = [], pageErrors = [], consoleErrors = [], consoleWarnings = [], apiFailures = [], results = [];
const mf = new Miniflare({ name: 'isolated-admin-browser', cf: false,
    modules: [config.main, ...files.filter(n => n !== config.main)].map(n => ({ type: 'ESModule', path: path.join(built, n) })), modulesRoot: built,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: { directory: path.join(root, 'dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: false } },
    bindings: { SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_ANON_KEY: 'fixture-only', STORE_ADMIN_EMAILS: email },
    d1Databases: { DB: 'isolated-browser' }, d1Persist: path.join(temporary, 'd1'),
    outboundService: async req => {
        providerCalls.push({ url: req.url, method: req.method });
        if (req.method === 'GET' && req.url === 'https://auth.example.invalid/auth/v1/user') return Response.json({ id: owner, email, email_confirmed_at: '2026-01-01', user_metadata: { name: 'Synthetic browser administrator' } });
        throw Error('Unmocked outbound request forbidden in browser fixture');
    }, log: new Log(LogLevel.ERROR),
});
let browser;
try {
    await mf.ready;
    const db = await mf.getD1Database('DB');
    for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(n => n.endsWith('.sql')).sort()) await db.batch(migrationStatements(await fs.readFile(path.join(root, 'drizzle', name), 'utf8')).map(sql => db.prepare(sql)));
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'lib/catalog-facts-v2.json'), 'utf8'));
    const product = catalog.find(p => p.slug === 'bpc-157-10mg'); assert(product);
    for (const p of catalog.filter(p => p.purchasable)) await db.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(p.id, JSON.stringify({ stockQuantity: p.id === product.id ? 3 : 25, ...(p.id === product.id ? { price: 10000, inStock: true, purchasable: true, maxQuantity: 25, sale: null, packPrices: { 3: 27000, 5: 42500, 10: 80000 } } : {}) })).run();
    await db.prepare('INSERT INTO sessions(id,cart,wishlist,updated) VALUES(?,?,?,?)').bind(session, '[]', '[]', Date.now()).run();
    await db.prepare('INSERT INTO customer_carts(id,cart,updated) VALUES(?,?,?)').bind(owner, JSON.stringify([{ id: product.id, quantity: 1 }]), Date.now()).run();
    for (const [id, name] of [[owner, 'Synthetic browser administrator'], [buyer, 'Synthetic Browser Customer']]) await db.prepare('INSERT INTO profiles(id,name,research_accepted,created) VALUES(?,?,1,?)').bind(id, name, Date.now()).run();
    const orderData = { email: 'buyer-browser-fixture@example.invalid', items: [{ id: product.id, quantity: 1, lineTotal: 10000, product: { id: product.id, name: product.name, price: 10000 } }], total: 10000, subtotal: 10000, discount: 0, environment: 'live', internalTest: false, address: { name: 'Synthetic Browser Customer', line1: '1 Example Road', city: 'Las Vegas', state: 'NV', zip: '89101', country: 'US' } };
    await db.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(order, buyer, 'browser-fixture-order', 'paid', 10000, JSON.stringify(orderData), Date.now(), Date.now()).run();
    const preorderData = { ...orderData, items: [{ ...orderData.items[0], product: { ...orderData.items[0].product, activePreorder: { percentOff: 15, ships: 'early November 2026', basePrice: 10000 } } }] };
    await db.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(preorder, buyer, 'browser-fixture-preorder', 'paid', 10000, JSON.stringify(preorderData), Date.now(), Date.now()).run();
    await db.prepare('INSERT INTO requests(id,owner,kind,status,data,created) VALUES(?,?,?,?,?,?)').bind(request, buyer, 'contact', 'new', JSON.stringify({ name: 'Synthetic Browser Customer', email: 'buyer-browser-fixture@example.invalid', message: 'Isolated browser test: please help with the shipping estimate.' }), Date.now()).run();
    const store = { packDiscounts: { 1: 0, 3: 10, 5: 15, 10: 20 }, shippingCents: 700, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: false, affiliateEnabled: false, shippingOptions: { standardEnabled: true, expeditedEnabled: true, overnightEnabled: false, freeStandardEnabled: true, standardHandlingCents: 0, expeditedHandlingCents: 0, overnightHandlingCents: 1000, carriers: ['USPS','UPS'] } };
    await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('store', JSON.stringify(store)).run();
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'bm_access', value: 'isolated-browser-fixture', domain: 'trybiomod.com', path: '/', secure: true, httpOnly: true }, { name: 'bm_session', value: session, domain: 'trybiomod.com', path: '/', secure: true, httpOnly: true }]);
    let pauseAlert = null;
    await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { browserBlocked.push({ origin: url.origin, method: req.method() }); return route.abort('blockedbyclient'); }
        try {
            const headers = await req.allHeaders();
            const response = await mf.dispatchFetch(req.url(), { method: req.method(), headers, ...(req.postDataBuffer() ? { body: req.postDataBuffer() } : {}) });
            if (url.pathname.startsWith('/api/') && response.status >= 400) apiFailures.push({ path: url.pathname, status: response.status, error: (await response.clone().json().catch(() => ({}))).error || '' });
            if (pauseAlert && url.pathname === '/api/admin/order-alerts' && req.method() === 'POST') { const hold = pauseAlert; pauseAlert = null; hold.started(); await hold.untilReleased; }
            await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        } catch (e) { apiFailures.push({ path: url.pathname, error: e.message }); await route.abort('failed'); }
    });
    let currentStep='setup';
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', message => { if(message.type()==='error')consoleErrors.push(message.text());if(message.type()==='warning'){const warning={step:currentStep,text:message.text(),location:message.location()};consoleWarnings.push(warning);void page.locator('input[type=number]').evaluateAll(inputs=>inputs.filter(el=>el.getAttribute('value')==='NaN').map(el=>({name:el.name,label:el.labels?.[0]?.textContent,value:el.getAttribute('value')}))).then(inputs=>{warning.inputs=inputs;}).catch(()=>{});} });
    page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    async function shot(name) { await page.screenshot({ path: path.join(screenshots, name + '.png'), fullPage: true }); }
    async function step(name, fn) {
        if(process.env.BIOMOD_BROWSER_CASE&&!new RegExp(process.env.BIOMOD_BROWSER_CASE).test(name))return;
        currentStep=name;console.log('RUN ' + name);
        try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
        catch (e) { results.push({ name, passed: false, error: e.message }); console.error('FAIL ' + name + ': ' + e.message); await shot('failure-' + results.length).catch(() => {}); }
    }
    async function admin(tab, marker) {
        // Independent full-page scenarios must not exhaust the real per-session rate limiter.
        await db.prepare('DELETE FROM rate_limits').run();
        await page.goto(origin + '/admin?tab=' + tab + '&measurement=off', { waitUntil: 'domcontentloaded' });
        if(tab.includes('&order=')){await page.getByRole('dialog').waitFor();return;}
        await page.getByRole('heading', { name: 'TryBiomod Administration', exact: true }).waitFor();
        if (marker) await page.getByRole('heading', { name: marker, exact: true }).waitFor();
        await page.getByRole('button', { name: 'Refresh administration', exact: true }).waitFor();
    }
    const sections = [['overview','Today'],['orders','Orders'],['requests','Customer requests'],['products','Products'],['affiliates',null],['restaurants',null],['contacts',null],['promos','Promo codes'],['presales','Presale campaigns'],['rewards','Reward ledger'],['settings','Mix-and-match discounts'],['team',null],['updates',null],['diagnostics',null],['traffic',null],['search',null],['changes',null]];
    for (const [tab, marker] of sections) await step('desktop section ' + tab, async () => {
        await admin(tab, marker); await page.waitForLoadState('networkidle');
        const text = await page.locator('main').innerText(); assert(!/This section could not load|We could not load administration/.test(text), text.slice(-600));
        await shot('desktop-' + tab);
    });
    await step('shipping draft survives alert save; alert and shipping saves clear their own drafts', async () => {
        await admin('settings','Mix-and-match discounts');
        const threshold = page.getByLabel('Minimum order, after discounts ($)', { exact: true }); await threshold.fill('275');
        await page.getByLabel('Wait after payment (minutes)', { exact: true }).fill('37');
        assert(await page.getByRole('button',{name:'Refresh administration',exact:true}).isDisabled());
        await page.getByLabel(/^Send alerts to/).fill('alerts-browser-fixture@example.invalid');
        await page.getByRole('button',{name:'Save alert list',exact:true}).click();
        await page.waitForLoadState('networkidle');
        assert.equal(await threshold.inputValue(),'275'); assert(await page.getByRole('button',{name:'Refresh administration',exact:true}).isDisabled());
        await page.getByRole('button',{name:'Save shipping and check it',exact:true}).click();
        await page.getByRole('button',{name:'Refresh administration',exact:true}).waitFor();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh administration')?.disabled);
        assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='store'").first()).value).freeShippingAt,27500);
        assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='store'").first()).value).autoLabel.delayMinutes,37);
        await page.getByLabel('Chat IDs',{exact:true}).fill('123456'); await page.getByRole('button',{name:'Save Telegram settings',exact:true}).click();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh administration')?.disabled);
        await shot('settings-saved');
    });
    await step('alert save locks its draft and unlocks cleanly', async () => {
        await admin('settings','Mix-and-match discounts');
        const savedConfig=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='store'").first()).value);
        assert.equal(await page.getByLabel('Wait after payment (minutes)', { exact: true }).inputValue(),String(savedConfig.autoLabel?.delayMinutes??20),'Reload must preserve the saved shipping wait');
        const recipients = page.getByLabel(/^Send alerts to/);
        await recipients.fill('first-browser-fixture@example.invalid');
        let signal, release; const started=new Promise(resolve=>{signal=resolve;}); const untilReleased=new Promise(resolve=>{release=resolve;});
        pauseAlert={started:signal,untilReleased};
        try { await page.getByRole('button',{name:'Save alert list',exact:true}).click(); await started; assert(await recipients.isDisabled(),'An in-flight alert save protects its submitted input'); } finally { release(); }
        await page.getByRole('button',{name:'Save alert list',exact:true}).waitFor();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh administration')?.disabled);
        await recipients.fill('newer-browser-fixture@example.invalid');
        assert.equal(await recipients.inputValue(),'newer-browser-fixture@example.invalid');
        assert(await page.getByRole('button',{name:'Refresh administration',exact:true}).isDisabled());
        await page.getByRole('button',{name:'Save alert list',exact:true}).click();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh administration')?.disabled);
        await shot('settings-late-save');
    });
    await step('product deep link and Today low-stock filter', async () => {
        await admin('products&product='+product.slug); await page.getByRole('button',{name:'Discard product draft',exact:true}).waitFor();
        await page.getByRole('button',{name:'Discard product draft',exact:true}).click();
        await admin('overview','Today'); const card=page.getByRole('listitem').filter({hasText:/low on stock/}).getByRole('button',{name:'Open Products',exact:true}).first(); await card.click();
        await page.getByRole('heading',{name:'Products',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:/Low stock/}).getAttribute('aria-pressed'),'true'); await shot('products-filter');
    });
    await step('real checkout price preview', async () => {
        await admin('products','Products'); await page.getByText('Preview customer pricing',{exact:true}).click();
        await page.getByLabel(/^Product 1/).selectOption(String(product.id)); await page.getByLabel(/^Purchase type/).selectOption('fixed');
        await page.getByLabel('Promo code (optional)',{exact:true}).fill('BM10'); await page.getByRole('button',{name:'Calculate price',exact:true}).click();
        await page.getByText('Product total: $243.00',{exact:true}).waitFor(); await shot('pricing-preview');
    });
    await step('campaign create edit archive restore', async () => {
        await admin('presales','Presale campaigns'); await page.getByLabel('Campaign title',{exact:true}).fill('Synthetic Browser Campaign');
        await page.getByLabel('Opens',{exact:true}).fill('2099-01-01T10:00'); await page.getByLabel('Closes',{exact:true}).fill('2099-02-01T10:00');
        await page.getByLabel('Expected shipping',{exact:true}).fill('February 2099');
        await page.getByRole('checkbox',{name:new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first().check();
        await page.getByRole('button',{name:'Save disabled campaign',exact:true}).click(); await page.getByRole('heading',{name:'Synthetic Browser Campaign',exact:true}).waitFor();
        await page.getByRole('button',{name:'Edit campaign',exact:true}).click(); await page.getByLabel('Expected shipping',{exact:true}).fill('March 2099');
        await page.getByRole('button',{name:'Save campaign changes',exact:true}).click(); await page.getByText(/Expected shipping: March 2099/).waitFor();
        await page.getByRole('button',{name:'Enable',exact:true}).click(); await page.getByText(/Upcoming ·/).waitFor();
        await page.getByRole('button',{name:'Archive',exact:true}).click(); await page.getByRole('heading',{name:'Synthetic Browser Campaign',exact:true}).waitFor({state:'hidden'}); await page.getByLabel(/^Show campaigns/).selectOption('Archived');
        await page.getByRole('button',{name:'Restore as disabled',exact:true}).click(); await page.getByRole('button',{name:'Restore as disabled',exact:true}).waitFor({state:'hidden'}); await page.getByLabel(/^Show campaigns/).selectOption('Disabled'); await page.getByRole('heading',{name:'Synthetic Browser Campaign',exact:true}).waitFor(); await shot('campaigns');
    });
    await step('customer lookup and append-only rewards adjustment', async () => {
        await admin('rewards','Reward ledger'); await page.getByLabel('Find customer',{exact:true}).fill('Synthetic Browser Customer'); await page.getByRole('button',{name:'Search customers',exact:true}).click();
        await page.getByRole('button',{name:/Synthetic Browser Customer.*points/}).click(); await page.getByLabel('Adjustment in points',{exact:true}).fill('25'); await page.getByLabel('Reason',{exact:true}).fill('Synthetic browser regression adjustment');
        await page.getByRole('button',{name:'Record adjustment',exact:true}).click(); await page.getByRole('heading',{name:'Synthetic Browser Customer · 25 points',exact:true}).waitFor(); assert.equal((await db.prepare('SELECT SUM(points) points FROM rewards WHERE owner=?').bind(buyer).first()).points,25); await shot('rewards');
    });
    await step('manual promo and built-in owner controls', async () => {
        await admin('promos','Promo codes'); await page.getByRole('button',{name:'Add a promo code',exact:true}).click();
        await page.getByLabel('Code',{exact:true}).fill('BROWSER15'); await page.getByLabel('Discount (%)',{exact:true}).fill('15'); await page.getByLabel('Reason for change',{exact:true}).fill('Synthetic browser promotion test');
        await page.getByRole('button',{name:'Save code',exact:true}).click();
        const manual=page.getByRole('listitem').filter({has:page.locator('strong',{hasText:'BROWSER15'})}); await manual.waitFor(); assert((await manual.innerText()).includes('Active'));
        await manual.getByRole('button',{name:'Edit',exact:true}).click(); await page.getByLabel('Active for new orders',{exact:true}).uncheck(); await page.getByLabel('Reason for change',{exact:true}).fill('Synthetic browser retirement test'); await page.getByRole('button',{name:'Save code',exact:true}).click(); await manual.getByText(/Retired/).waitFor();
        const builtin=page.getByRole('listitem').filter({has:page.locator('strong',{hasText:/^COMEBACK10$/})}); await builtin.getByRole('button',{name:'Edit',exact:true}).click();
        await page.getByLabel('Discount (%)',{exact:true}).fill('12'); await page.getByLabel('Expires (local time, optional)',{exact:true}).fill('2099-01-01T12:00'); await page.getByLabel('Reason for change',{exact:true}).fill('Synthetic owner reviewed override'); await page.getByRole('button',{name:'Save code',exact:true}).click(); await builtin.getByText(/12% off/).waitFor(); await shot('promo-controls');
    });
    await step('business slot saves and switches its owned code', async () => {
        await admin('restaurants'); const slot=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Slot 1 · empty',exact:true})}); await slot.waitFor();
        await slot.getByLabel('Business name',{exact:true}).fill('Synthetic Browser Business'); await slot.getByLabel('Discount (%)',{exact:true}).fill('11'); await slot.getByRole('button',{name:'Save',exact:true}).click();
        const saved=page.getByRole('article').filter({has:page.getByRole('heading',{name:/^Slot 1 · Synthetic Browser Business/})}); await saved.getByRole('button',{name:'Switch on',exact:true}).click(); await saved.getByRole('button',{name:'Switch off',exact:true}).waitFor();
        const slots=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='restaurant_partners_v1'").first()).value);const promos=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='promo_codes_v1'").first()).value);assert(slots[0].active);assert(promos.some(p=>p.code===slots[0].code&&p.active&&p.percentOff===11));await shot('business-controls');
    });
    await step('requests open synthetic customer conversation', async () => {
        await admin('requests','Customer requests'); await page.getByRole('button').filter({hasText:'Synthetic Browser Customer'}).first().click(); await page.getByRole('region',{name:'Reply to Synthetic Browser Customer',exact:true}).waitFor(); await shot('request-detail');
    });
    await step('preorder estimate ownership save and reload preserves purchase terms', async () => {
        await admin('orders&order='+preorder,'Orders');
        await page.getByLabel('Revised dispatch estimate (UTC)',{exact:true}).fill('2099-04-15');
        await page.getByLabel('Estimate check notes',{exact:true}).fill('Synthetic supplier confirmation for browser regression.');
        await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/store/admin-preorder-plan'&&response.request().method()==='POST'),page.getByRole('button',{name:'Save estimate and take ownership',exact:true}).click()]);
        const saved=JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(preorder).first()).data);
        assert.equal(saved.preorderPlan.dispatchDate,'2099-04-15');
        assert.equal(saved.preorderPlan.owner,email);assert.equal(saved.preorderPlan.confirmedBy,email);assert(saved.preorderPlan.confirmedAt>0);
        assert.deepEqual(saved.items,preorderData.items,'Purchase price and promised terms remain unchanged');
        assert.equal(saved.preorderRelease,undefined,'Updating the estimate does not release stock');
        await admin('orders&order='+preorder,'Orders');
        await page.getByLabel('Revised dispatch estimate (UTC)',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('Revised dispatch estimate (UTC)',{exact:true}).inputValue(),'2099-04-15');
        await page.getByText('Current dispatch estimate',{exact:true}).waitFor();
        await page.getByText('Estimate owner',{exact:true}).waitFor();
        await page.getByText('Last checked (UTC)',{exact:true}).waitFor();
        await shot('preorder-estimate');
    });
    await step('public product cart and checkout rendering', async () => {
        await page.goto(origin+'/product/'+product.slug+'?measurement=off',{waitUntil:'networkidle'}); assert.equal((await page.locator('body').innerText()).includes('404'),false); await shot('public-product');
        await page.goto(origin+'/cart?measurement=off',{waitUntil:'networkidle'}); await page.getByRole('heading',{name:'Your Cart',exact:true}).waitFor(); await shot('public-cart');
        await page.goto(origin+'/checkout?measurement=off',{waitUntil:'networkidle'}); await page.getByRole('heading',{name:/^Checkout/}).waitFor(); await shot('public-checkout');
    });
    await page.setViewportSize({width:390,height:844});
    for(const tab of ['overview','products','requests','settings','promos']) await step('mobile layout '+tab, async()=>{
        await admin(tab); await page.waitForLoadState('networkidle');
        const overflow=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth,offenders:Array.from(document.querySelectorAll('main *')).map(el=>({el,rect:el.getBoundingClientRect()})).filter(({el,rect})=>rect.width&&rect.height&&rect.right>innerWidth+1&&getComputedStyle(el).visibility!=='hidden').slice(-12).map(({el,rect})=>({tag:el.tagName,class:el.className,right:Math.round(rect.right),text:el.textContent.slice(0,90)}))}));
        assert(overflow.body<=overflow.viewport+1,`${tab} page overflow ${JSON.stringify(overflow)}`);await shot('mobile-'+tab);
    });
    await step('mobile request conversation and pricing form fit', async()=>{
        await admin('requests','Customer requests');await page.getByRole('button').filter({hasText:'Synthetic Browser Customer'}).first().click();await page.getByRole('region',{name:'Reply to Synthetic Browser Customer',exact:true}).waitFor();
        assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1),'Open mobile request conversation must fit');await shot('mobile-request-detail');
        await admin('products','Products');await page.getByText('Preview customer pricing',{exact:true}).click();await page.getByLabel(/^Product 1/).selectOption(String(product.id));
        const previewWidth=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth,offenders:Array.from(document.querySelectorAll('details[open] *')).map(el=>({el,rect:el.getBoundingClientRect(),style:getComputedStyle(el)})).filter(({rect})=>rect.width&&rect.height&&rect.right>innerWidth+1).map(({el,rect,style})=>({tag:el.tagName,width:rect.width,right:rect.right,minWidth:style.minWidth,maxWidth:style.maxWidth,display:style.display,text:el.textContent.slice(0,60)}))}));
        assert(previewWidth.body<=previewWidth.viewport+1,'Open mobile price preview must fit '+JSON.stringify(previewWidth));await page.getByLabel(/^Product 1/).scrollIntoViewIfNeeded();await shot('mobile-price-preview');
    });
    await step('mobile preorder estimate editor fits',async()=>{
        await admin('orders&order='+preorder,'Orders');await page.getByLabel('Revised dispatch estimate (UTC)',{exact:true}).waitFor();
        await page.getByLabel('Revised dispatch estimate (UTC)',{exact:true}).scrollIntoViewIfNeeded();
        assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1),'Open preorder editor must fit');await shot('mobile-preorder-estimate');
        const cellWidths=await page.locator('table:has(td[data-label="Payment"])').evaluate(table=>({table:table.getBoundingClientRect().width,cells:Array.from(table.querySelectorAll('tbody td')).map(cell=>cell.getBoundingClientRect().width)}));
        assert(cellWidths.cells.every(width=>width>=cellWidths.table-2),'Stacked order cells need the full row '+JSON.stringify(cellWidths));
    });
    await step('mobile night mode toggles without page overflow',async()=>{
        await admin('settings','Mix-and-match discounts');await page.getByRole('switch',{name:'Night mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
        await page.getByRole('tab',{name:'Settings',exact:true}).evaluate(async el=>{await new Promise(requestAnimationFrame);await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
        assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+1));await shot('mobile-night-settings');await page.getByRole('switch',{name:'Night mode',exact:true}).click();await admin('promos','Promo codes');
    });
    await step('mobile keyboard navigation',async()=>{await admin('promos','Promo codes');await page.getByRole('tab',{name:'Promo codes',exact:true}).focus();await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement?.tagName!=='BODY'),'Keyboard focus reaches a real control');});
    assert(providerCalls.every(c=>c.method==='GET'&&c.url==='https://auth.example.invalid/auth/v1/user'),'Only the isolated auth provider was called');
    const report={root,workerSha256:createHash('sha256').update(await fs.readFile(path.join(built,config.main))).digest('hex'),results,pageErrors,consoleErrors,consoleWarnings,apiFailures,browserBlocked,providerRequests:providerCalls.length,screenshots};
    await fs.writeFile(path.join(screenshots,'browser-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,pageErrors,consoleErrors,consoleWarnings,apiFailures,browserBlocked,screenshots},null,2));
    if(results.some(r=>!r.passed)||pageErrors.length||consoleErrors.length||consoleWarnings.length||apiFailures.length||browserBlocked.length)process.exitCode=1;
}finally{await browser?.close();await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
