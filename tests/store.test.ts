import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fixture,audit} from './fixture.ts';
test('fixed marking freezes first answer, persists across reopen, appends assisted answer',async()=>{
 const {Store}=await import('../server/store.ts');const path=join(mkdtempSync(join(tmpdir(),'tef-store-')),'state.sqlite');let s=new Store(path);
 s.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:500},'test');const session=s.start(fixture.id);
 assert.throws(()=>s.question(session.id));assert.throws(()=>s.answer(session.id,'B','one'));
 s.event(session.id,'ended');assert.equal(s.question(session.id).options.length,4);
 const first=s.answer(session.id,'B','one');assert.equal(first.first.correct,false);
 assert.deepEqual(s.answer(session.id,'B','one'),first);assert.throws(()=>s.answer(session.id,'A','one'));
 s.event(session.id,'replay');const assisted=s.answer(session.id,'A','two');assert.equal(assisted.first.choice,'B');assert.equal(assisted.latest.correct,true);assert.equal(assisted.latest.assisted,true);
 s.close();s=new Store(path);assert.equal(s.review()[0].first.choice,'B');assert.equal(s.feedback(session.id).first.choice,'B');s.close();
});
test('did-not-hear and reveal preserve an unanswered first attempt independently',async()=>{
 const {Store}=await import('../server/store.ts');const s=new Store(':memory:');s.publish(fixture,audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:500},'test');
 const x=s.start(fixture.id);s.event(x.id,'ended');let r=s.answer(x.id,'not-heard','first');assert.equal(r.first.result,'not-heard');assert.equal(r.first.correct,null);
 s.event(x.id,'reveal');r=s.answer(x.id,'A','second');assert.equal(r.first.result,'not-heard');assert.equal(r.latest.assisted,true);assert.equal(s.review().length,1);s.close();
});
test('budget reservations survive restart and never allow totals over RMB5 or call caps',async()=>{
 const {Store}=await import('../server/store.ts');const s=new Store(':memory:');s.reserve('deepseek',4.9);assert.throws(()=>s.reserve('tts',0.11));assert.equal(s.budget().reserved,4.9);s.close();
 const x=new Store(':memory:');for(let i=0;i<4;i++)x.reserve('deepseek',0.01);assert.throws(()=>x.reserve('deepseek',0.01));x.close();
});


test('second session cannot reset the first attempt for an existing item',async()=>{
 const {Store}=await import('../server/store.ts');const s=new Store(':memory:');s.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:50},'test');
 const one=s.start(fixture.id);s.event(one.id,'ended');s.answer(one.id,'B','first');
 const again=s.start(fixture.id);assert.equal(again.id,one.id);assert.equal(again.first.choice,'B');assert.equal(s.review().length,1);s.close();
});


test('session restores prior assistance even before an answer exists',async()=>{
 const {Store}=await import('../server/store.ts');const s=new Store(':memory:');s.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:50},'test');const x=s.start(fixture.id);s.event(x.id,'ended');s.event(x.id,'replay');assert.equal(s.session(x.id).assisted,true);assert.equal(s.session(x.id).first,null);s.close();
});

