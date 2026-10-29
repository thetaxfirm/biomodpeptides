// Simple reply box: the box empties after a send, a clear "You replied" line, and the
// AI creation and verified COAs are visible before sending. Source-level checks, no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const src=fs.readFileSync(path.join(__dirname,'..','components/store/request-inbox.tsx'),'utf8');
const take=name=>{const m=src.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n}\\n'));assert(m,name+' exists');return ts.transpileModule(m[0],{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;};
const seedBody=new Function(take('seedBody')+';return seedBody;')();
const newDraft=new Function(take('seedBody')+take('newDraft')+';return newDraft;')();

// After a send the box is empty for the next message; drafts and AI drafts keep their text.
assert.equal(seedBody({status:'sent',body:'Hi Albert, here is 15% off'}),'');
assert.equal(seedBody({status:'ready',body:'Draft text'}),'Draft text');
assert.equal(seedBody(undefined),'');
assert.equal(seedBody({status:'cancelled',body:'Stale draft'}),'','Retired drafts never reappear in the composer');
assert.equal(newDraft({status:'sent',body:'sent text',revision:4}).body,'');
assert.equal(newDraft({status:'sent',body:'sent text',revision:4}).revision,4,'The next message builds on the sent revision');
// The clean-draft sync compares against the same seed, so a sent reply is not pushed back into the box.
assert.match(src,/draft\.body !== seedBody\(reply\)/);

// Replied line from any channel, above the box; the old ambiguous status line is gone.
assert.match(src,/Last recorded reply: \{when\(lastReplied\.at\)\}/);
assert.match(src,/wrote back since/);
assert.doesNotMatch(src,/'Sent ' \+ when\(reply\.updated\) \+ '\. Accepted by the mail provider\.'/);
assert.doesNotMatch(src,/Last reply sent \{when/);
assert.match(src,/Write a new message to \$\{firstName\}/);

// The draft action is visible before the editor, outside optional tools.
const sendAt=src.indexOf("onClick={() => onSubmit('staff', true)}"),moreAt=src.indexOf('<details className={styles.more}');
assert(sendAt>0&&moreAt>sendAt);
assert(src.indexOf('Create AI draft')<src.indexOf('name="replyBody"'));
assert(src.indexOf('aria-label="COA attachments"')<sendAt);
const label=new Function(take('coaProductLabel')+';return coaProductLabel;')();
assert.equal(label({productName:'Fixture 30mg',strength:'30 mg'}),'Fixture 30mg');
assert.equal(label({productName:'Fixture',strength:'30 mg'}),'Fixture 30 mg');
assert.equal(newDraft({status:'sent',revision:2,coaChoice:'old-sha'}).coa,'','A sent attachment is not silently reused');
console.log('reply-simple-v1: ok');
