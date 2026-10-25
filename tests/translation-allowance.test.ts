import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../server/store.ts';
test('one separate authorized translation reservation preserves old caps and total ceiling',()=>{
 const s=new Store(':memory:');for(let i=0;i<4;i++)s.reserve('deepseek',0.1);for(let i=0;i<2;i++)s.reserve('tts',0.1);
 assert.throws(()=>s.reserveTranslation(0.1));assert.equal(s.budget().calls,6);
 s.authorizeTranslationOnce();s.reserveTranslation(0.1);s.authorizeTranslationOnce();assert.throws(()=>s.reserveTranslation(0.1));assert.throws(()=>s.reserve('deepseek',0.1));assert.throws(()=>s.reserve('tts',0.1));assert.equal(s.budget().calls,7);assert.equal(s.translationAllowance().used,1);s.close();
 const x=new Store(':memory:');x.reserve('deepseek',4.95);x.authorizeTranslationOnce();assert.throws(()=>x.reserveTranslation(0.1));assert.equal(x.translationAllowance().used,0);x.close();
});
test('translation adapter makes only one request, records usage, never auto-retries',async()=>{
 const{deepseekTranslationProvider}=await import('../server/translation-provider.ts');const s=new Store(':memory:');s.authorizeTranslationOnce();let n=0;
 const p=deepseekTranslationProvider(s,{key:'test-only-key',pricingDate:new Date().toISOString().slice(0,10),request:async(url,init)=>{n++;assert.equal(String(url),'https://api.deepseek.com/chat/completions');const b=JSON.parse(String(init?.body));assert.equal(b.response_format.type,'json_object');assert.equal(b.max_tokens,1200);return Response.json({id:'test-id',choices:[{finish_reason:'stop',message:{content:JSON.stringify({translationZh:'这是一段仅用于隔离测试的中文翻译。'})}}],usage:{prompt_tokens:100,completion_tokens:30}});}});
 assert.equal(p.available!(),true);assert.match(await p.translate('Bonjour. '.repeat(20)),/中文/);assert.equal(p.available!(),false);await assert.rejects(p.translate('Bonjour. '.repeat(20)));assert.equal(n,1);assert.equal(s.budget().calls,1);s.close();
});
