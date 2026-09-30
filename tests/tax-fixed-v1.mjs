// Fixed-rate sales tax checks. No network.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = await fs.readFile(new URL('../lib/tax.ts', import.meta.url), 'utf8');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'biomod-tax-v1-'));
try {
  const file = path.join(temp, 'tax.mjs');
  await fs.writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const t = await import(file);
  const nv = t.fixedTaxConfig({ FIXED_TAX_STATE: 'nv', FIXED_TAX_RATE: '8.375' });
  assert.deepEqual(nv, { state: 'NV', rateThousandths: 8375 });
  assert.equal(t.fixedTaxConfig({}), null);
  assert.equal(t.fixedTaxConfig({ FIXED_TAX_STATE: 'NV', FIXED_TAX_RATE: 'abc' }), null);
  assert.equal(t.fixedTaxConfig({ FIXED_TAX_STATE: 'Nevada', FIXED_TAX_RATE: '8.375' }), null);
  assert.equal(t.fixedTaxConfig({ FIXED_TAX_STATE: 'NV', FIXED_TAX_RATE: '0' }), null);
  assert.equal(t.fixedTaxCents(nv, 'NV', 10000), 838);   // $100.00 -> $8.375 -> $8.38
  assert.equal(t.fixedTaxCents(nv, 'NV', 4900), 410);    // $49.00 -> $4.10375 -> $4.10
  assert.equal(t.fixedTaxCents(nv, 'nv', 20000), 1675);  // $200.00 -> $16.75
  assert.equal(t.fixedTaxCents(nv, 'CA', 10000), 0);     // out of state
  assert.equal(t.fixedTaxCents(nv, 'NV', 0), 0);
  const all = t.fixedTaxConfig({ FIXED_TAX_RATE: '8.375' });
  assert.deepEqual(all, { state: null, rateThousandths: 8375 });
  assert.deepEqual(t.fixedTaxConfig({ FIXED_TAX_STATE: 'all', FIXED_TAX_RATE: '8.375' }), all);
  assert.equal(t.fixedTaxCents(all, 'CA', 10000), 838);  // every destination taxed
  assert.equal(t.fixedTaxCents(all, 'NV', 10000), 838);
  assert.throws(() => t.fixedTaxCents(nv, 'NV', 10.5));
  console.log('PASS: fixed-rate config parsing, Nevada rounding, state-limited and all-orders modes, invalid input rejection');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
