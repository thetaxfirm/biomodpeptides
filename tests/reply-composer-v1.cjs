const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/reply-composer.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleExport = {exports:{}}; new Function('module','exports',code)(moduleExport,moduleExport.exports);
const {matchedCoaReplyProblem: problem, preparedCoaReply, appendNextPurchaseOffer} = moduleExport.exports;
for(const body of [
 'The lot entered was QA100 which does not match the lot format on file. Could you confirm the exact lot, including dashes or spaces?',
 "The lot doesn't match. Please send a photo of the vial label.",
 'There is no matching report on file.',
 "We don't have the laboratory report yet.",
 'The COA is not available.',
 "We didn't send a report that may not correspond to your vial.",
 '<p>The lot doesn&#39;t match the lot format.</p>',
 'Could you check the vial label and confirm the exact lot printed on it?'
]) assert(problem(body), body);
for(const body of [
 'No problem, I attached the report.',
 "I've attached the laboratory report for Sample 30mg, lot QA-100.",
 'If you have any questions about the report, please reply.',
 'Please see the attached PDF for lot QA-100.',
 '<p>The report is attached.</p><blockquote>The lot does not match.</blockquote>',
 'No further action is needed. The report is attached.'
]) assert.equal(problem(body),null,body);
const coa={productName:'Sample 30mg',strength:'30 mg',lot:'QA-100',filename:'Sample.pdf'};
const body=preparedCoaReply(coa);
assert(body.includes('Sample 30mg, lot QA-100'));
assert(!body.includes('30mg 30 mg'));
assert.equal(problem(body),null);
const offer=appendNextPurchaseOffer(body,{code:'BIOMOD15',percentOff:15});
assert(offer.includes('15% off your next purchase'));
assert(offer.indexOf('BIOMOD15')<offer.lastIndexOf('Thank you,'));
assert.equal(appendNextPurchaseOffer(offer,{code:'BIOMOD15',percentOff:15}),offer);
assert.equal(appendNextPurchaseOffer(body,{code:'invented code',percentOff:15}),body);
console.log('reply-composer-v1: verified report wording, contradictions and explicit offer passed');

for (const text of ["There is no need to re-enter the lot number; the matching report is attached.", "You do not need to send a label photo. The report is attached."]) assert.equal(problem(text), null);

assert(problem("No need to re-enter the lot number, but please send a label photo."));
