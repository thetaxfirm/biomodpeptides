/* Store structured data on /locations states only the addresses printed on the page.
 * No network, credentials, production bindings or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { storeLocations, storeLocationNodes } = require('../lib/store-locations.ts');
const page = fs.readFileSync(path.join(__dirname, '../components/store/locations.tsx'), 'utf8');
const nodes = storeLocationNodes('https://trybiomod.com', 'https://trybiomod.com/#organization');
assert.equal(nodes.length, 3);
// One schema store per "Current location" or "New location" on the page; planned cities are not stores.
assert.equal((page.match(/location-status">(Current|New) location</g) || []).length, storeLocations.length);
for (const [i, s] of storeLocations.entries()) {
  for (const part of s.street.split(', ')) assert(page.includes(part), s.id + ': street on page: ' + part);
  assert(page.includes(`${s.city}, ${s.region} ${s.postalCode}`), s.id + ': city line on page');
  const node = nodes[i];
  assert.equal(node['@type'], 'Store');
  assert.equal(node['@id'], 'https://trybiomod.com/locations#' + s.id);
  assert.equal(node.address.postalCode, s.postalCode);
  assert.equal(node.address.addressCountry, 'US');
  assert.equal(node.parentOrganization['@id'], 'https://trybiomod.com/#organization');
  for (const key of ['telephone', 'openingHours', 'openingHoursSpecification', 'aggregateRating', 'review', 'geo']) assert(!(key in node), s.id + ': no unpublished ' + key);
}
assert(!JSON.stringify(nodes).match(/Dallas|Los Angeles/), 'planned cities are not published as stores');
assert(fs.readFileSync(path.join(__dirname, '../lib/seo.ts'), 'utf8').includes("clean === '/locations'"), 'schema is limited to the locations page');
console.log('PASS: three open stores publish Store data with the exact page addresses on /locations only; no hours, phone, ratings or planned cities');
