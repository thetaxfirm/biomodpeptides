// Submits the live sitemap to IndexNow (Bing, Yandex, Naver, Seznam, Yep share submissions).
// Run after a production deploy that adds or changes public pages: node scripts/indexnow-submit-v1.mjs
// The key is public by design; IndexNow verifies it at https://trybiomod.com/<key>.txt.
const host = 'trybiomod.com';
const key = '7a2a2775e1f5d580b51600e5e34016f1';
const origin = 'https://' + host;
const keyFile = await fetch(`${origin}/${key}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== key) throw new Error('Live key file missing or wrong; deploy first.');
const sitemap = await (await fetch(origin + '/sitemap.xml')).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => u.startsWith(origin + '/'));
if (!urlList.length) throw new Error('Live sitemap is empty; nothing submitted.');
const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }) });
console.log(`IndexNow ${res.status} ${res.statusText}: ${urlList.length} URLs submitted on ${new Date().toISOString()}`);
if (res.status >= 300) { console.log(await res.text()); process.exit(1); }
