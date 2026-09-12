// Isolated adapter checks. No financial network request is made.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=await fs.readFile(new URL('../lib/chase-payments.ts',import.meta.url),'utf8');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-payments-v1-'));
try{
 const file=path.join(temp,'adapter.mjs');await fs.writeFile(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const a=await import(file);const order={id:'isolated-payment-a',totalCents:4900,currency:'USD'};const reference=a.chaseOrderReference(order.id);
 const notification=(transaction,amount=49)=>({merchantOrderNumber:reference,requestId:reference,messageInfo:{messageId:'notification-'+transaction},orderNotification:{transactionReference:transaction,status:'STATUS_SUCCESS',checkoutIntent:'CHECKOUT_INTENT_AUTH_AND_CAPTURE',totalAmount:{amount:String(amount*100),decimalCount:2,currencyCode:'USD'}}});
 assert.equal(a.getChasePaymentStatus({}).checkoutEnabled,false);
 assert.throws(()=>a.validateChaseOrder({...order,totalCents:49.5}));
 assert.throws(()=>a.validateChaseHostedUrl('https://untrusted.invalid/pay','https://merchant.example'));
 assert.equal(a.reconcileChaseNotifications(order,[notification('a')],reference).state,'paid');
 assert.equal(a.reconcileChaseNotifications(order,[notification('a',48)],reference).state,'review');
 assert.equal(a.reconcileChaseNotifications(order,[notification('a'),notification('b')],reference).state,'review');
 assert.equal(a.reconcileChaseNotifications(order,[notification('a'),notification('b')],'a').state,'review');
 assert.equal(a.reconcileChaseNotifications(order,[],reference).state,'pending');
 console.log('PASS: checkout disabled without configuration, integer amounts, redirect allowlist, matching capture, amount mismatch, duplicate capture and wrong saved reference rejection');
}finally{await fs.rm(temp,{recursive:true,force:true})}
