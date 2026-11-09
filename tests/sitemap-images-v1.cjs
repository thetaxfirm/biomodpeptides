/* Sitemap images: product photos render as SVG <image> elements that image crawlers do not
   pick up, so every product URL in the sitemap lists exactly one image:image, the same catalog
   file used for og:image and Product.image. Non-product pages carry none. Exercises the real route. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const { seoConfig, sitemapPaths, indexableProducts } = require('../lib/seo-policy.ts');
const { imagePath } = require('../lib/catalog.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });

const filename = path.join(root, 'app/sitemap.xml/route.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(root);
const originalRequire = loaded.require.bind(loaded);
loaded.require = id => id === '@/lib/seo' ? { seoForOrigin: () => config } : id.startsWith('@/lib/') ? originalRequire(path.join(root, id.slice(2)) + '.ts') : originalRequire(id);
loaded._compile(transpile(filename), filename);

(async () => {
  const xml = await loaded.exports.GET(new Request('https://trybiomod.com/sitemap.xml')).text();
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1">/, 'image namespace declared');
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  assert.equal(urls.length, sitemapPaths(config).length);
  const products = indexableProducts(config);
  assert(products.length >= 15, 'published products present in fixture');
  const bySlug = new Map(products.map(p => ['/product/' + p.slug, p]));
  let withImage = 0;
  for (const body of urls) {
    const loc = body.match(/<loc>([^<]+)<\/loc>/)[1];
    const route = loc.slice(release.origin.length) || '/';
    const imgs = [...body.matchAll(/<image:image><image:loc>([^<]+)<\/image:loc><\/image:image>/g)].map(m => m[1]);
    const p = bySlug.get(route);
    if (!p) { assert.equal(imgs.length, 0, route + ' is not a product and lists no image'); continue; }
    assert.deepEqual(imgs, [release.origin + imagePath(p)], route + ' lists its catalog image');
    assert(fs.existsSync(path.join(root, 'public', imagePath(p))), route + ' image file exists in public/');
    assert.doesNotMatch(imgs[0], /certificates|\.pdf/i, route + ' image is not a certificate');
    withImage++;
  }
  assert.equal(withImage, products.length, 'every published product URL carries one image');
  console.log('sitemap-images-v1: ' + withImage + ' product images listed');
})().catch(e => { console.error(e); process.exit(1); });
