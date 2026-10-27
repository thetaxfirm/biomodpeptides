// New-order alerts into a Telegram group: token/chat validation, the exact message that is posted,
// chat discovery, and that a chat app can never delay or break an order. Telegram is always stubbed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const tg=load('lib/telegram.ts');

// --- A bot token is what BotFather gives out, and nothing else. ---
const good='1234567890:AAH1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
assert.equal(tg.validBotToken(good),good);
assert.equal(tg.validBotToken(' '+good+' '),good,'pasted whitespace is forgiven');
for(const bad of ['','not-a-token','1234567890','1234567890:short','abc:'+'A'.repeat(40),'12:'+'A'.repeat(40),null,undefined,{},'1234567890:'+'A'.repeat(200)])
  assert.equal(tg.validBotToken(bad),'','rejected: '+String(bad));

// --- Chat ids are integers, and a group's is negative. ---
assert.deepEqual(tg.cleanChatIds('-1001234567890'),['-1001234567890']);
assert.deepEqual(tg.cleanChatIds('-100123, 456; -789'),['-100123','456','-789'],'commas, semicolons and spaces all separate');
assert.deepEqual(tg.cleanChatIds('-100123, -100123'),['-100123'],'the same chat twice is one chat');
assert.deepEqual(tg.cleanChatIds('@mygroup, not-a-number, 12.5'),[],'a username or a decimal is not a chat id');
assert.deepEqual(tg.cleanChatIds(''),[]); assert.deepEqual(tg.cleanChatIds(null),[]);
assert.equal(tg.cleanChatIds(Array.from({length:30},(_,i)=>'-10'+i).join(',')).length,10,'ten is the cap');

// --- What the group actually sees. Never the catalogue. ---
const order={total:29254,address:{name:'Autumn Tatro',city:'Wells',state:'NV'},items:[{quantity:2,product:{name:'SECRET PRODUCT'}},{quantity:1,product:{name:'ALSO SECRET'}}]};
const text=tg.orderPushText('65402ce8-0000-4000-8000-000000000001',order);
assert.match(text,/^New order #65402CE8$/m);
assert.match(text,/^Autumn Tatro - Wells, NV$/m);
assert.match(text,/^3 items - \$292\.54$/m);
assert.match(text,/trybiomod\.com\/admin\?tab=orders/);
assert(!/SECRET/.test(text),'a lock screen never shows what was ordered');
assert.match(tg.orderPushText('abcdef01-0000-4000-8000-000000000001',{total:11101,address:{name:'Solo'},items:[{quantity:1}]}),/^1 item - \$111\.01$/m,'one item is singular');
assert.match(tg.orderPushText('abcdef01-0000-4000-8000-000000000001',{}),/^0 items - \$0\.00$/m,'a malformed order still produces a sane line');

function database(rows={}){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  for(const [k,v] of Object.entries(rows)) db.prepare('INSERT INTO settings VALUES(?,?)').run(k,v);
  return {raw:db,prepare(sql){return{bind(...v){return{async all(){return{results:db.prepare(sql).all(...v)};}};},async all(){return{results:db.prepare(sql).all()};}};}};}
const T=tg.TELEGRAM_TOKEN_KEY,C=tg.TELEGRAM_CHATS_KEY;
assert.equal(T,'telegram_bot_token_v1'); assert.equal(C,'telegram_chat_ids_v1');

(async()=>{
  // --- Reading what is configured. ---
  assert.deepEqual(await tg.readTelegramConfig({DB:database({[T]:good,[C]:'-100123, -100456'})}),{token:good,chats:['-100123','-100456']});
  assert.deepEqual(await tg.readTelegramConfig({DB:database()}),{token:'',chats:[]});
  assert.deepEqual(await tg.readTelegramConfig({DB:database({[T]:'rubbish',[C]:'-100123'})}),{token:'',chats:['-100123']},'a corrupted token is no token');
  assert.deepEqual(await tg.readTelegramConfig({DB:{prepare(){throw Error('down');}}}),{token:'',chats:[]},'a broken settings table is not a crash');
  assert.deepEqual(await tg.readTelegramConfig({}),{token:'',chats:[]});

  // --- Sending: one request per chat, to the right URL, with the right body. ---
  let posts=[];
  const ok=async(url,init)=>{posts.push({url,body:init?JSON.parse(init.body):null});return new Response('{"ok":true}',{status:200});};
  const env={DB:database({[T]:good,[C]:'-100123, -100456'})};
  assert.equal(await tg.sendOrderPush(env,'65402ce8-0000-4000-8000-000000000001',order,{fetch:ok}),2);
  assert.equal(posts.length,2);
  assert.equal(posts[0].url,'https://api.telegram.org/bot'+good+'/sendMessage');
  assert.deepEqual(posts.map(p=>p.body.chat_id),['-100123','-100456']);
  assert.equal(posts[0].body.text,text);
  assert.equal(posts[0].body.disable_web_page_preview,true);

  // Not configured is silence, not an error, and costs no request at all.
  posts=[];
  assert.equal(await tg.sendOrderPush({DB:database()},'x-0000-4000-8000-000000000001',order,{fetch:ok}),0);
  assert.equal(await tg.sendOrderPush({DB:database({[T]:good})},'x-0000-4000-8000-000000000001',order,{fetch:ok}),0,'a token with no chat goes nowhere');
  assert.equal(await tg.sendOrderPush({DB:database({[C]:'-100123'})},'x-0000-4000-8000-000000000001',order,{fetch:ok}),0,'a chat with no token goes nowhere');
  assert.deepEqual(posts,[],'nothing configured means Telegram is never called');

  // The same sender carries the second alert: one line a day about orders that have stopped moving.
  // It is the only other thing allowed to reach the chat (owner, Oct 27 2026).
  posts=[];
  assert.equal(await tg.sendTelegramText(env,'7 orders have not moved in 4 days\nhttps://trybiomod.com/admin?tab=orders',{fetch:ok}),2);
  assert.deepEqual(posts.map(p=>p.body.text),Array(2).fill('7 orders have not moved in 4 days\nhttps://trybiomod.com/admin?tab=orders'));
  posts=[];
  for(const blank of ['','   ','\n',null,undefined])
    assert.equal(await tg.sendTelegramText(env,blank,{fetch:ok}),0,'a push that would say nothing is never sent');
  assert.deepEqual(posts,[],'and costs no request');
  assert.equal(await tg.sendTelegramText({DB:database()},'anything',{fetch:ok}),0,'no bot configured is silence');

  // A refusal, an outage or a hang is counted and swallowed: the order is not a chat app's problem.
  assert.equal(await tg.sendOrderPush(env,'x-0000-4000-8000-000000000001',order,{fetch:async()=>new Response('{}',{status:403})}),0);
  assert.equal(await tg.sendOrderPush(env,'x-0000-4000-8000-000000000001',order,{fetch:async()=>{throw Error('network down');}}),0);
  let n=0;
  assert.equal(await tg.sendOrderPush(env,'x-0000-4000-8000-000000000001',order,{fetch:async()=>{n++;if(n===1)throw Error('one chat is unreachable');return new Response('{}',{status:200});}}),1,'one bad chat does not stop the others');

  // --- The test message says what it is and never implies an order happened. ---
  posts=[];
  const test=await tg.sendTelegramTest(env,{fetch:ok});
  assert.deepEqual(test,{sent:2,chats:2,configured:true,why:''});
  assert.match(posts[0].body.text,/test message/i);
  assert.match(posts[0].body.text,/Nothing was ordered and no customer was contacted/);
  assert.deepEqual(await tg.sendTelegramTest({DB:database()},{fetch:ok}),{sent:0,chats:0,configured:false,why:''});
  // Telegram explains every refusal; that explanation is the whole value of the test button.
  const kicked=async()=>new Response(JSON.stringify({ok:false,description:'Forbidden: bot was kicked from the group chat'}),{status:403});
  assert.deepEqual(await tg.sendTelegramTest(env,{fetch:kicked}),{sent:0,chats:2,configured:true,why:'Forbidden: bot was kicked from the group chat'});
  assert.deepEqual(await tg.sendTelegramTest(env,{fetch:async()=>new Response('not json',{status:400})}),{sent:0,chats:2,configured:true,why:'Telegram replied 400'},'a body with no description still says something');
  assert.deepEqual(await tg.sendTelegramTest(env,{fetch:async()=>{throw Error('offline');}}),{sent:0,chats:2,configured:true,why:'Telegram could not be reached.'});
  // A partial failure still reports why the bad one failed, and still counts the good one.
  let which=0;
  assert.deepEqual(await tg.sendTelegramTest(env,{fetch:async()=>{which++;return which===1?new Response(JSON.stringify({ok:false,description:'Bad Request: chat not found'}),{status:400}):new Response('{}',{status:200});}}),
    {sent:1,chats:2,configured:true,why:'Bad Request: chat not found'});

  // --- Chat discovery turns a raw API response into something a person can pick from. ---
  const updates={ok:true,result:[
    {message:{chat:{id:-1001234567890,title:'Biomod Orders',type:'supergroup'}}},
    {message:{chat:{id:-1001234567890,title:'Biomod Orders',type:'supergroup'}}},
    {message:{chat:{id:55512345,first_name:'Logan',type:'private'}}},
    {message:{chat:{title:'No id here',type:'group'}}},
    {},
  ]};
  const found=await tg.findTelegramChats(good,{fetch:async url=>{assert.match(url,/\/getUpdates/);return new Response(JSON.stringify(updates),{status:200});}});
  assert.deepEqual(found,[
    {id:'-1001234567890',title:'Biomod Orders',kind:'supergroup'},
    {id:'55512345',title:'Logan',kind:'private'},
  ],'duplicates collapse, a chat with no id is skipped, and a private chat falls back to the first name');
  assert.deepEqual(await tg.findTelegramChats('not-a-token',{fetch:ok}),[],'a bad token never reaches Telegram');
  assert.deepEqual(await tg.findTelegramChats(good,{fetch:async()=>new Response('{}',{status:401})}),[]);
  assert.deepEqual(await tg.findTelegramChats(good,{fetch:async()=>new Response('not json',{status:200})}),[]);
  assert.deepEqual(await tg.findTelegramChats(good,{fetch:async()=>{throw Error('down');}}),[]);

  // --- The probe: why discovery found nothing, said in the owner's terms rather than Telegram's. ---
  const reply=(method,map)=>async url=>{const m=String(url).split('/').pop().split('?')[0];
    if(!(m in map)) throw Error('unexpected method '+m);
    const v=map[m]; if(typeof v==='function') return v(); return new Response(JSON.stringify(v.body),{status:v.status});};
  const live={getMe:{status:200,body:{ok:true,result:{username:'biomod_orders_bot'}}}};
  const noHook={getWebhookInfo:{status:200,body:{ok:true,result:{url:''}}}};
  const oneChat={getUpdates:{status:200,body:{ok:true,result:[{message:{chat:{id:-100999,title:'Orders',type:'supergroup'}}}]}}};

  // A token Telegram refuses is never 'no chats yet'.
  assert.deepEqual(await tg.probeTelegram(good,{fetch:reply('',{getMe:{status:401,body:{ok:false}}})}),
    {problem:'unauthorized',username:'',webhookUrl:'',chats:[]});
  assert.deepEqual(await tg.probeTelegram('not-a-token',{fetch:ok}),{problem:'unauthorized',username:'',webhookUrl:'',chats:[]},'a malformed token never reaches Telegram');
  assert.deepEqual(await tg.probeTelegram(good,{fetch:async()=>{throw Error('offline');}}),
    {problem:'unreachable',username:'',webhookUrl:'',chats:[]},'an outage is not a bad credential');

  // A webhook silently steals every update, so discovery can never work until it goes.
  assert.deepEqual(await tg.probeTelegram(good,{fetch:reply('',{...live,getWebhookInfo:{status:200,body:{ok:true,result:{url:'https://example.invalid/hook'}}}})}),
    {problem:'webhook',username:'biomod_orders_bot',webhookUrl:'https://example.invalid/hook',chats:[]});

  // Healthy and empty: the bot is named, so the owner can check it is the one in the member list.
  assert.deepEqual(await tg.probeTelegram(good,{fetch:reply('',{...live,...noHook,getUpdates:{status:200,body:{ok:true,result:[]}}})}),
    {problem:'',username:'biomod_orders_bot',webhookUrl:'',chats:[]});
  assert.deepEqual(await tg.probeTelegram(good,{fetch:reply('',{...live,...noHook,...oneChat})}),
    {problem:'',username:'biomod_orders_bot',webhookUrl:'',chats:[{id:'-100999',title:'Orders',kind:'supergroup'}]});
  // A webhook report that cannot be read is not a reason to stop looking.
  assert.deepEqual((await tg.probeTelegram(good,{fetch:reply('',{...live,getWebhookInfo:()=>{throw Error('down');},...oneChat})})).chats,
    [{id:'-100999',title:'Orders',kind:'supergroup'}]);

  // The route turns each of those into one plain sentence, and never into the wrong one.
  const routeText=fs.readFileSync(path.join(root,'app/api/admin/order-alerts/route.ts'),'utf8');
  assert.match(routeText,/Telegram rejected this token/,'a dead credential says so');
  assert.match(routeText,/webhook registered/,'a webhook says so');
  assert.match(routeText,/could not be reached/,'an outage says so');
  assert.match(routeText,/'\/start@' \+ probe\.username/,'and an empty queue names the exact command to send');

  // A refusal reaches the panel through `error`, which is the only field it reads on a bad status.
  // Putting the explanation in `message` turned 'bot was kicked from the group' into 'Request failed.'
  const testRoute=fs.readFileSync(path.join(root,'app/api/admin/order-alerts/route.ts'),'utf8');
  assert.match(testRoute,/if \(!result\.sent\) return j\(\{ error: 'Telegram refused the message'/,'a refused test answers in the error field');
  assert.match(testRoute,/result\.why \? ': ' \+ result\.why/,'and repeats what Telegram actually said');
  const callPanel=fs.readFileSync(path.join(root,'components/store/admin-order-alerts.tsx'),'utf8');
  assert.match(callPanel,/d\.error \|\| d\.message \|\| 'Request failed\.'/,'and the panel falls back to message before giving up');

  // --- Saving a chat id must never destroy the credential. ---
  // The token box is blank on every load because the token is write-only, so an empty box meaning
  // 'clear it' made every chat-id save quietly wipe the token. It bit the owner live (Oct 20 2026).
  const saveRoute=fs.readFileSync(path.join(root,'app/api/admin/order-alerts/route.ts'),'utf8');
  assert.match(saveRoute,/typeof body\.botToken === 'string' && body\.botToken\.trim\(\)/,'an empty token box is not a token change');
  assert.match(saveRoute,/body\.clearToken === true/,'removing a token is its own explicit request');
  assert(!/if \(body\.botToken !== undefined\) \{[\s\S]{0,200}validBotToken\(raw\)\);[\s\S]{0,80}bot token cleared/.test(saveRoute),'the old blank-clears-it branch is gone');
  const savePanel=fs.readFileSync(path.join(root,'components/store/admin-order-alerts.tsx'),'utf8');
  assert.match(savePanel,/\.\.\.\(token\.trim\(\) \? \{ botToken: token \} : \{\}\)/,'the panel omits the token entirely when the box is empty');
  assert.match(savePanel,/clearToken: true/,'and offers an explicit way to remove it');
  assert.match(savePanel,/leaving this box empty keeps it as it is/,'and says so where the owner reads it');

  // --- Wiring: the push rides the paid-order notification, and the token never leaves the server. ---
  const summary=fs.readFileSync(path.join(root,'lib/order-summary.ts'),'utf8');
  assert.match(summary,/await sendOrderPush\(env as never, orderId, data\)/,'a paid order posts to the group');
  assert(summary.indexOf('sendOrderPush')<summary.indexOf("const key = (env.RESEND_API_KEY"),'the push goes first, so a store with no mail provider is still told');
  const route=fs.readFileSync(path.join(root,'app/api/admin/order-alerts/route.ts'),'utf8');
  assert.match(route,/telegram: \{ configured: Boolean\(telegram\.token\), chats: telegram\.chats \}/,'the browser learns whether a token exists, never the token');
  assert(!/token: telegram\.token|botToken: telegram|value: token/.test(route),'the token is never returned');
  assert.match(route,/summary: 'Telegram order alerts updated: ' \+ changed\.join\(', '\)/,'history records what changed, never the credential');
  assert(!/recordChange[\s\S]{0,400}botToken/.test(route),'the token never reaches change history');
  const panel=fs.readFileSync(path.join(root,'components/store/admin-order-alerts.tsx'),'utf8');
  assert.match(panel,/type="password"/,'the token box is masked');
  assert.match(panel,/@BotFather/,'the panel explains where a token comes from');
  assert.match(panel,/Find my chats/,'and finds the group id for you');

  console.log('PASS: bot token and chat id validation, the exact lock-screen message (never the catalogue), one request per chat with correct URL and body, silence when unconfigured, refusals/outages/partial failures swallowed so an order is never blocked, an honest test message that repeats the refusal Telegram gave, chat discovery from a raw API response, a probe that tells a rejected token, a webhook and an outage apart from an empty queue, a token that is written but never returned or logged, and an empty token box that leaves the saved credential alone rather than destroying it. Telegram is always stubbed.');
})().catch(e=>{console.error(e);process.exitCode=1});
