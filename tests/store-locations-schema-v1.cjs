/* Store structured data and map links use the addresses printed on /locations.
 * No network, credentials, production bindings or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...rest);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
}
const { storeLocations, storeLocationNodes } = require('../lib/store-locations.ts');
const { Locations } = require('../components/store/locations.tsx');
const page = renderToStaticMarkup(React.createElement(Locations));
const nodes = storeLocationNodes('https://trybiomod.com', 'https://trybiomod.com/#organization');
const expectedDestinations = {
  'las-vegas': '6625 S Valley View Blvd, Suite D420, Las Vegas, NV 89118, USA',
  'st-george': '422 W Lamond Circle, Washington, UT 84780, USA',
  'el-paso': '2079 Sun Bolt Way, El Paso, TX 79938, USA',
};
assert.equal(nodes.length, 3);
// One schema store per "Current location" or "New location" on the page; planned cities are not stores.
assert.equal((page.match(/location-status">(Current|New) location</g) || []).length, storeLocations.length);
assert.equal((page.match(/href="https:\/\/www\.google\.com\/maps\/dir\//g) || []).length, nodes.length);
for (const [i, s] of storeLocations.entries()) {
  const section = [...page.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].find(match => match[0].includes(`id="${s.id}"`))?.[0];
  assert(section, s.id + ': directions and schema anchor point to a visible store');
  assert(section.includes(`<h2>${s.label}</h2>`));
  const node = nodes[i];
  const visibleAddress = section.match(/<address>(.*?)<\/address>/)?.[1].replaceAll('<br/>', ', ');
  const destination = `${node.address.streetAddress}, ${node.address.addressLocality}, ${node.address.addressRegion} ${node.address.postalCode}`;
  assert.equal(visibleAddress, destination, s.id + ': schema matches rendered address');
  const directionsLink = section.match(/href="(https:\/\/www\.google\.com\/maps\/dir\/[^\"]+)"[^>]*>Directions to /)?.[1];
  assert(directionsLink, s.id + ': directions link rendered with a descriptive label');
  const directions = new URL(directionsLink.replaceAll('&amp;', '&'));
  assert.equal(directions.searchParams.get('api'), '1');
  assert.equal(directions.searchParams.get('destination'), destination + ', USA');
  assert.equal(directions.searchParams.get('destination'), expectedDestinations[s.id]);
  assert(section.includes('/contact?subject=' + encodeURIComponent(s.contactRegion + ' location')), s.id + ': team contact retained');
  assert.equal(node['@type'], 'Store');
  assert.equal(node['@id'], 'https://trybiomod.com/locations#' + s.id);
  assert.equal(node.address.postalCode, s.postalCode);
  assert.equal(node.address.addressCountry, 'US');
  assert.equal(node.parentOrganization['@id'], 'https://trybiomod.com/#organization');
  for (const key of ['telephone', 'openingHours', 'openingHoursSpecification', 'aggregateRating', 'review', 'geo']) assert(!(key in node), s.id + ': no unpublished ' + key);
}
assert(!JSON.stringify(nodes).match(/Dallas|Los Angeles/), 'planned cities are not published as stores');
assert(fs.readFileSync(path.join(__dirname, '../lib/seo.ts'), 'utf8').includes("clean === '/locations'"), 'schema is limited to the locations page');
console.log('PASS: three open stores share exact rendered, structured and map addresses; planned cities and unknown hours/phones remain excluded');
