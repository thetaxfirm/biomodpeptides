/* Product and hero artwork weight. Reads repository files only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.join(__dirname, '..');
const branding = require('../lib/vial-branding-v37.json');
const frames = require('../lib/vial-image-frames-v14.json');
const LIMIT = 150 * 1024;

(async () => {
  // Every vial card on /shop and the homepage loads its artwork eagerly (an SVG <image> cannot lazy-load),
  // so each file must stay small. The base64-PNG SVG originals were 320-390 KB each, 8 MB on /shop.
  for (const [source, shown] of Object.entries(branding)) {
    const file = path.join(root, 'public/products', shown);
    assert(fs.existsSync(file), shown + ' exists');
    assert(!shown.endsWith('.svg'), shown + ' is a raster, not an embedded-PNG SVG');
    assert(fs.statSync(file).size <= LIMIT, shown + ' is at most 150 KB');
    const svg = path.join(root, 'public/products', shown.replace(/\.webp$/, '.svg'));
    if (fs.existsSync(svg)) {
      const [raster, original] = await Promise.all([sharp(file).metadata(), sharp(svg).metadata()]);
      assert.deepEqual([raster.width, raster.height], [original.width, original.height], shown + ' keeps the original artwork size');
      if (frames[source]) assert.deepEqual([raster.width, raster.height], frames[source].source, shown + ' still matches its measured vial frame');
    }
  }
  // The homepage hero is the largest contentful paint.
  const hero = '/brand/biomod-bpc-157-still-life-v37.webp';
  for (const file of ['app/page.tsx', 'lib/product-imagery.ts']) assert(fs.readFileSync(path.join(root, file), 'utf8').includes(hero), file + ' uses the WebP hero');
  const heroFile = path.join(root, 'public', hero);
  assert(fs.statSync(heroFile).size <= 250 * 1024, 'Hero is at most 250 KB');
  const meta = await sharp(heroFile).metadata();
  assert.deepEqual([meta.width, meta.height], [1448, 1086], 'Hero keeps the declared 1448x1086 size');
  console.log('PASS: vial and hero artwork are raster files at their original size and under the weight limits');
})().catch(error => { console.error(error); process.exit(1); });
