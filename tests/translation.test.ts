import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../server/store.ts';import{fixture,audit}from'./fixture.ts';
function setup(){const store=new Store(':memory:');store.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:50},'test');const session=store.start(fixture.id);return{store,session};}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('translation denies transcript access before feedback/reveal and missing authorization makes zero calls',async()=>{
 const{TranslationService}=await import('../server/translation.ts');const{store,session}=setup();let n=0;const service=new TranslationService(store,{translate:async()=>{n++;return '这是一段中文翻译，用于测试。';}});
 assert.throws(()=>service.request(session.id));assert.equal(n,0);store.event(session.id,'ended');store.answer(session.id,'A','first');
 const blocked=new TranslationService(store);assert.equal(blocked.request(session.id).status,'blocked');assert.equal(store.budget().calls,0);store.close();
});
test('same exact script/language/version caches across sessions and concurrent opens',async()=>{
 const{TranslationService}=await import('../server/translation.ts');const{store,session}=setup();store.event(session.id,'ended');store.answer(session.id,'B','first');let n=0,resolve!:(s:string)=>void;
 const service=new TranslationService(store,{translate:async()=>{n++;return await new Promise<string>(r=>resolve=r);}});assert.equal(service.request(session.id).status,'pending');service.request(session.id);await tick();assert.equal(n,1);
 resolve('您好，这是汽车维修店的留言。车辆周四下午准备好，若无法关门前来，周五早上再来，并在收银台付款。');await tick();assert.equal(service.get(session.id).status,'ready');assert.match(service.get(session.id).text!,/车辆/);
 store.publish({...fixture,id:'same-script'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:50},'test');const second=store.start('same-script');store.event(second.id,'ended');store.event(second.id,'reveal');assert.equal(service.request(second.id).status,'ready');assert.equal(n,1);store.close();
});
test('failed translation stays error until explicit retry, malformed output never cached as ready',async()=>{
 const{TranslationService}=await import('../server/translation.ts');const{store,session}=setup();store.event(session.id,'ended');store.event(session.id,'reveal');let n=0;
 const service=new TranslationService(store,{translate:async()=>{n++;return n===1?'not Chinese':'这是经过重试的中文原文翻译。';}});
 service.request(session.id);await tick();assert.equal(service.get(session.id).status,'error');service.request(session.id);await tick();assert.equal(n,1);
 service.request(session.id,true);await tick();assert.equal(service.get(session.id).status,'ready');assert.equal(n,2);store.close();
});
