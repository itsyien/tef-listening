import {test} from 'node:test';import assert from 'node:assert/strict';import {Store} from '../server/store.ts';import {fixture,audit} from './fixture.ts';import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('HTTP hides answers until playback end, blocks foreign origins and keeps fixed marking',async()=>{
 const {createApp}=await import('../server/http.ts');const store=new Store(':memory:');store.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:50},'test');
 const server=createApp({store,dataDir:mkdtempSync(join(tmpdir(),'tef-http-')),origins:['http://localhost:8090']});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;const base='http://127.0.0.1:'+port;
 const post=(path:string,body:any,origin='http://localhost:8090')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 try{
 assert.equal((await post('/sessions',{questionId:fixture.id},'https://evil.example')).status,403);
 const s=await (await post('/sessions',{questionId:fixture.id})).json();assert.ok(s.id);assert.equal(JSON.stringify(s).includes(fixture.question),false);
 assert.equal((await fetch(base+'/sessions/'+s.id+'/question')).status,409);assert.equal((await fetch(base+'/sessions/'+s.id+'/feedback')).status,409);
 await post('/sessions/'+s.id+'/events',{kind:'ended'});const q=await (await fetch(base+'/sessions/'+s.id+'/question')).json();assert.equal(q.options.length,4);assert.equal('correctOptionId' in q,false);assert.equal('script' in q,false);
 const result=await (await post('/sessions/'+s.id+'/answers',{choice:'B',requestId:'http-one',correctOptionId:'B'})).json();assert.equal(result.first.correct,false);assert.equal(result.question.correctOptionId,'A');
 const reviews=await (await fetch(base+'/review')).json();assert.equal(reviews[0].first.choice,'B');
 assert.equal((await post('/generate',{})).status,404);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));store.close();}
});
test('empty production state reports not ready without fabricated fixture',async()=>{
 const {createApp}=await import('../server/http.ts');const store=new Store(':memory:');const server=createApp({store,dataDir:tmpdir()});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));try{const p=(server.address() as any).port;const status=await(await fetch('http://127.0.0.1:'+p+'/health')).json();assert.equal(status.readyCount,0);assert.equal(status.mode,'live');}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});


test('HTTP session entry starts exactly one next job before playback or answers, never recursively',async()=>{
 const{createApp}=await import('../server/http.ts');const store=new Store(':memory:');store.publish(fixture,audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:50},'test');store.approveContinuation(2,new Date().toISOString().slice(0,10));let calls=0,release!:(x:string)=>void;const server=createApp({store,dataDir:tmpdir(),nextWorker:{generate:async()=>{calls++;return new Promise<string>(r=>release=r);}}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;const post=(p:string,b:any)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{const s=await(await post('/sessions',{questionId:fixture.id})).json();assert.equal(calls,1);assert.equal(s.ended,false);assert.equal(s.first,null);await post('/sessions/'+s.id+'/next',{});const duplicate=await(await post('/sessions',{questionId:fixture.id})).json();assert.equal(calls,1);store.publish({...fixture,id:'http-ready-next'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:50},'test');release('http-ready-next');await new Promise(r=>setTimeout(r,0));assert.equal((await(await fetch(base+'/sessions/'+duplicate.id+'/next')).json()).questionId,'http-ready-next');assert.equal(calls,1);assert.equal(store.db.prepare('SELECT count(*) n FROM answers').get()!.n,0);assert.equal(store.continuationAllowance().used,1);}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
