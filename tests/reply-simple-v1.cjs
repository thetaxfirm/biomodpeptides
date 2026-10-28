// Simple reply box: the box empties after a send, a clear "You replied" line, and the
// extra tools sit under one More options toggle. Source-level checks, no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const src=fs.readFileSync(path.join(__dirname,'..','components/store/request-inbox.tsx'),'utf8');
const take=name=>{const m=src.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n}\\n'));assert(m,name+' exists');return ts.transpileModule(m[0],{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;};
const seedBody=new Function(take('seedBody')+';return seedBody;')();
const newDraft=new Function(take('seedBody')+take('newDraft')+';return newDraft;')();

// After a send the box is empty for the next message; drafts and AI drafts keep their text.
assert.equal(seedBody({status:'sent',body:'Hi Albert, here is 15% off'}),'');
assert.equal(seedBody({status:'ready',body:'Draft text'}),'Draft text');
assert.equal(seedBody(undefined),'');
assert.equal(newDraft({status:'sent',body:'sent text',revision:4}).body,'');
assert.equal(newDraft({status:'sent',body:'sent text',revision:4}).revision,4,'The next message builds on the sent revision');
// The clean-draft sync compares against the same seed, so a sent reply is not pushed back into the box.
assert.match(src,/draft\.body !== seedBody\(reply\)/);

// Replied line from any channel, above the box; the old ambiguous status line is gone.
assert.match(src,/Already emailed \{when\(lastReplied\.at\)\}/);
assert.match(src,/wrote back since/);
assert.doesNotMatch(src,/'Sent ' \+ when\(reply\.updated\) \+ '\. Accepted by the mail provider\.'/);
assert.doesNotMatch(src,/Last reply sent \{when/);
assert.match(src,/Write a new message to \$\{firstName\}/);

// Send sits right under the box; every extra tool is inside one More options section.
const sendAt=src.indexOf("onClick={() => onSubmit('staff', true)}"),moreAt=src.indexOf('<details className={styles.more}');
assert(sendAt>0&&moreAt>sendAt,'Send comes before More options');
const more=src.slice(moreAt,src.indexOf('</details>',moreAt));
for(const tool of ['Win-back emails','replyInstruction','Dictate','Rewrite','Tailor','Remember this instruction','Insert code','Insert COA link','Attach COA PDF'])assert(more.includes(tool),tool+' is inside More options');
assert.match(src,/const moreOpen = listening \|\| writing/,'Opens for active AI or dictation; COA tools stay optional');
console.log('reply-simple-v1: ok');
