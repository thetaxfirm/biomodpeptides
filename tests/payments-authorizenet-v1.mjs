// Isolated Authorize.net adapter checks. No network request is made; fetch is replaced with a fake.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import ts from 'typescript';
const source = await fs.readFile(new URL('../lib/authorizenet-payments.ts', import.meta.url), 'utf8');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'biomod-anet-v1-'));
try {
  const file = path.join(temp, 'adapter.mjs');
  await fs.writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const a = await import(file);
  const order = { id: '6f1d2c3b-0000-4000-8000-000000000001', totalCents: 4900, currency: 'USD' };
  const ref = a.anetOrderReference(order.id);
  const signatureKey = 'A'.repeat(128);
  const env = { AUTHORIZENET_ENVIRONMENT: 'sandbox', AUTHORIZENET_API_LOGIN_ID: 'testLogin123', AUTHORIZENET_TRANSACTION_KEY: 'abcdEFGH12345678', AUTHORIZENET_SIGNATURE_KEY: signatureKey, AUTHORIZENET_RETURN_URL: 'https://trybiomod.com/payment/return', AUTHORIZENET_CONNECTION_VERIFIED: 'true', COMMERCE_MODE: 'sandbox' };
  const tx = (transId, over = {}) => ({ transId, transactionType: 'authCaptureTransaction', transactionStatus: 'capturedPendingSettlement', responseCode: 1, authAmount: 49, settleAmount: 49, order: { invoiceNumber: ref }, ...over });

  // Configuration gating
  assert.equal(a.getAnetPaymentStatus({}).checkoutEnabled, false);
  assert.equal(a.getAnetPaymentStatus({ ...env, COMMERCE_MODE: 'preview' }).checkoutEnabled, false);
  assert.equal(a.getAnetPaymentStatus({ ...env, AUTHORIZENET_CONNECTION_VERIFIED: '' }).checkoutEnabled, false);
  assert.equal(a.getAnetPaymentStatus({ ...env, AUTHORIZENET_ENVIRONMENT: 'live', COMMERCE_MODE: 'live' }).checkoutEnabled, false, 'live requires verified fulfillment');
  assert.equal(a.getAnetPaymentStatus(env).checkoutEnabled, true);

  // Reference and amounts
  assert.match(ref, /^[A-F0-9]{20}$/);
  assert.equal(a.anetOrderReference(order.id), ref);
  assert.equal(a.centsToAmount(4900), '49.00');
  assert.equal(a.centsToAmount(5), '0.05');
  assert.equal(a.amountToCents('49.5'), 4950);
  assert.equal(a.amountToCents(49), 4900);
  assert.equal(a.amountToCents('abc'), null);
  assert.throws(() => a.validateAnetOrder({ ...order, totalCents: 49.5 }));

  // Hosted payment request keeps the schema element order
  const payload = a.anetHostedPaymentPayload({ name: 'x', transactionKey: 'y' }, order, env.AUTHORIZENET_RETURN_URL, { email: 'a@b.co', name: 'Ada Lovelace', line1: '1 Main', city: 'LA', state: 'CA', zip: '90001' }).getHostedPaymentPageRequest;
  assert.deepEqual(Object.keys(payload), ['merchantAuthentication', 'refId', 'transactionRequest', 'hostedPaymentSettings']);
  assert.deepEqual(Object.keys(payload.transactionRequest), ['transactionType', 'amount', 'order', 'customer', 'shipTo', 'transactionSettings']);
  assert.equal(payload.transactionRequest.amount, '49.00');
  assert.equal(payload.transactionRequest.order.invoiceNumber, ref);

  // Reconciliation
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001')], ref).state, 'paid');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001')], ref).notificationId, 'anet:1001');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { settleAmount: 48, authAmount: 48 })], ref).state, 'review', 'amount mismatch');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001'), tx('1002')], ref).state, 'review', 'duplicate capture');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { order: { invoiceNumber: 'OTHER' } })], ref).state, 'pending', 'other invoice ignored');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { transactionStatus: 'declined', responseCode: 2 })], ref).state, 'failed');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { transactionStatus: 'declined', responseCode: 2 }), tx('1002')], ref).state, 'paid', 'decline then success');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { transactionStatus: 'FDSPendingReview' })], ref).underReview, true);
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001', { transactionType: 'authOnlyTransaction' })], ref).state, 'review');
  assert.equal(a.reconcileAnetTransactions(order, [], ref).state, 'pending');
  assert.equal(a.reconcileAnetTransactions(order, [tx('1001')], 'wrong-ref').state, 'review');

  // Webhook signatures
  const body = JSON.stringify({ eventType: 'net.authorize.payment.authcapture.created', payload: { entityName: 'transaction', id: '1001' } });
  const sig = 'sha512=' + createHmac('sha512', signatureKey).update(body).digest('hex').toUpperCase();
  assert.equal(a.verifyAnetWebhookSignature(body, sig, signatureKey), true);
  assert.equal(a.verifyAnetWebhookSignature(body + ' ', sig, signatureKey), false);
  assert.equal(a.verifyAnetWebhookSignature(body, null, signatureKey), false);
  assert.equal(a.verifyAnetWebhookSignature(body, sig, 'B'.repeat(128)), false);

  // Adapter with fake network (responses carry the BOM Authorize.net sends)
  const calls = [];
  const ok = (extra) => new Response('﻿' + JSON.stringify({ ...extra, messages: { resultCode: 'Ok', message: [{ code: 'I00001', text: 'Successful.' }] } }), { status: 200 });
  const fake = async (url, init) => {
    const req = JSON.parse(init.body); const kind = Object.keys(req)[0]; calls.push([url, kind]);
    if (kind === 'getHostedPaymentPageRequest') return ok({ token: 'TOKEN123' });
    if (kind === 'getUnsettledTransactionListRequest') return ok({ transactions: [{ transId: '1001', invoiceNumber: ref }, { transId: '9999', invoiceNumber: 'ELSEWHERE' }] });
    if (kind === 'getTransactionDetailsRequest') return ok({ transaction: tx(req[kind].transId) });
    throw new Error('unexpected ' + kind);
  };
  const adapter = a.createAnetAdapter(env, fake);
  const start = await adapter.createCheckout(order, env.AUTHORIZENET_RETURN_URL);
  assert.equal(start.url, '/api/store/pay?id=' + order.id);
  await assert.rejects(adapter.createCheckout(order, 'https://evil.example/return'));
  const form = await adapter.hostedForm(order);
  assert.deepEqual(form, { action: 'https://test.authorize.net/payment/payment', token: 'TOKEN123' });
  const verified = await adapter.verifyPayment(order, ref, [], Date.now());
  assert.equal(verified.state, 'paid');
  assert.equal(verified.providerReference, '1001');
  assert.ok(calls.every(([url]) => url === 'https://apitest.authorize.net/xml/v1/request.api'));
  await assert.rejects(a.createAnetAdapter({}, fake).hostedForm(order), /pending merchant setup/);
  console.log('PASS: configuration gating, stable references, cent amounts, schema-ordered hosted request, capture/amount/duplicate/decline/fraud-review reconciliation, webhook signature, BOM-safe responses, sandbox endpoints');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
