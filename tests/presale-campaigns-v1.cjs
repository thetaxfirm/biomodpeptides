// Real campaign persistence and version checks against isolated SQLite. No customer/provider calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const file=path.resolve(__dirname,'../lib/presale-campaigns.ts'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:9,module:1}}).outputText,file);
const {listPresaleCampaigns,savePresaleCampaign,presaleStatus,CampaignConflict}=m.exports;
const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE campaigns(id TEXT PRIMARY KEY,data TEXT,active INTEGER); CREATE TABLE orders(id TEXT,data TEXT)');
raw.prepare('INSERT INTO orders VALUES(?,?)').run('historical','unchanged-terms');
let race=false;
const db={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return raw.prepare(sql).get(...args)||null;},async all(){return{results:raw.prepare(sql).all(...args)};},async run(){if(race&&sql.startsWith('UPDATE campaigns')){race=false;raw.prepare('UPDATE campaigns SET active=0 WHERE id=?').run(args[2]);}return{meta:{changes:raw.prepare(sql).run(...args).changes}};}};}};
const base={title:'Isolated campaign',starts:'2099-01-01T00:00:00.000Z',ends:'2099-02-01T00:00:00.000Z',ships:'February 2099',productIds:[1],maxPerCustomer:2,active:false};
(async()=>{
 const created=await savePresaleCampaign(db,base,[1]);let [c]=await listPresaleCampaigns(db);assert.equal(c.id,created.id);assert.equal(presaleStatus(c),'Disabled');
 await savePresaleCampaign(db,{...c,active:true},[1]);await assert.rejects(()=>savePresaleCampaign(db,{...c,title:'Stale editor'},[1]),CampaignConflict);
 [c]=await listPresaleCampaigns(db);assert.equal(presaleStatus(c),'Upcoming');assert.equal(presaleStatus(c,Date.parse('2099-01-10')),'Open');assert.equal(presaleStatus(c,Date.parse(c.ends)),'Ended');
 await assert.rejects(()=>savePresaleCampaign(db,{...c,productIds:[2]},[1]),/current catalog/);
 await assert.rejects(()=>savePresaleCampaign(db,{...c,ends:c.starts},[1]),/Closing date/);
 await savePresaleCampaign(db,{...c,archived:true,active:true},[1]);[c]=await listPresaleCampaigns(db);assert.equal(c.active,false);assert.equal(presaleStatus(c),'Archived');
 await savePresaleCampaign(db,{...c,archived:false,active:true},[1]);[c]=await listPresaleCampaigns(db);
 race=true;await assert.rejects(()=>savePresaleCampaign(db,{...c,title:'Lost race'},[1]),CampaignConflict);assert.equal((await listPresaleCampaigns(db))[0].title,base.title);
 assert.equal(raw.prepare('SELECT data FROM orders').get().data,'unchanged-terms');
 console.log('PASS: campaign creation, edit, archive/restore, current-product validation, dates and boundary statuses, stale-client and concurrent-save rejection, immutable historical terms.');
})().catch(e=>{console.error(e);process.exitCode=1;});
