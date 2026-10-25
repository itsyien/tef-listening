import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{Store}from'../server/store.ts';import{fixture,audit}from'./fixture.ts';
function publish(s:Store,id:string,step=0){s.publish({...fixture,id},audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:500},'test',step);}
function answer(s:Store,id:string,value:'A'|'B'|'not-heard',help=false){publish(s,id);const x=s.start(id);s.event(x.id,'ended');if(help)s.event(x.id,'replay');s.answer(x.id,value,'first');return x;}
test('adaptive setting defaults off, persists, and changes only after four independent distinct firsts',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'tef-settings-')),'state.sqlite');let s=new Store(file);assert.equal(s.settings().adaptiveDifficulty,false);
 s.setSettings({adaptiveDifficulty:true});for(let i=0;i<3;i++)answer(s,'correct-'+i,'A');assert.equal(s.settings().difficultyStep,0);assert.equal(s.settings().streak,3);
 answer(s,'correct-3','A');assert.equal(s.settings().difficultyStep,1);assert.equal(s.settings().streak,0);s.close();s=new Store(file);assert.equal(s.settings().adaptiveDifficulty,true);assert.equal(s.settings().effectiveStep,1);
 s.setSettings({adaptiveDifficulty:false});assert.equal(s.settings().effectiveStep,0);assert.equal(s.settings().streak,0);s.close();
});
test('opposite, not-heard and assisted firsts break streak; repeats and assisted retries cannot boost',()=>{
 const s=new Store(':memory:');s.setSettings({adaptiveDifficulty:true});answer(s,'mix-0','A');answer(s,'mix-1','A');answer(s,'mix-2','B');assert.equal(s.settings().streak,-1);
 answer(s,'mix-3','not-heard');assert.equal(s.settings().streak,0);answer(s,'mix-4','A');const x=answer(s,'mix-5','A',true);assert.equal(s.settings().streak,0);
 s.event(x.id,'replay');s.answer(x.id,'A','again');s.start('mix-5');assert.equal(s.settings().streak,0);assert.equal(s.settings().difficultyStep,0);s.close();
});
test('difficulty steps are bounded, four wrong lowers once and disabled attempts do not count later',()=>{
 const s=new Store(':memory:');answer(s,'off-first','A');s.setSettings({adaptiveDifficulty:true});
 for(let i=0;i<20;i++)answer(s,'up-'+i,'A');assert.equal(s.settings().difficultyStep,2);
 for(let i=0;i<4;i++)answer(s,'down-'+i,'B');assert.equal(s.settings().difficultyStep,1);
 for(let i=0;i<20;i++)answer(s,'bottom-'+i,'B');assert.equal(s.settings().difficultyStep,-2);assert.equal(s.settings().streak,0);s.close();
});
test('Continue returns closest eligible unseen question or honest exhaustion without creating content',()=>{
 const s=new Store(':memory:');publish(s,'seen-one');publish(s,'new-neutral',0);publish(s,'new-hard',2);const x=s.start('seen-one');s.event(x.id,'ended');s.answer(x.id,'B','first');assert.equal(s.nextQuestion('seen-one')?.id,'new-neutral');
 const y=s.start('new-neutral');s.event(y.id,'ended');s.answer(y.id,'A','first');assert.equal(s.nextQuestion('new-neutral')?.id,'new-hard');const z=s.start('new-hard');s.event(z.id,'ended');s.answer(z.id,'A','first');assert.equal(s.nextQuestion('new-hard'),null);s.close();
});
