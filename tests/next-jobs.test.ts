import{test}from'node:test';import assert from'node:assert/strict';import{Store}from'../server/store.ts';import{fixture,audit}from'./fixture.ts';
function make(s:Store,id='origin'){s.publish({...fixture,id},audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:100},'test');const x=s.start(id);s.event(x.id,'ended');return x;}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('new provider output requires a descriptive Chinese title; legacy review title is persisted',async()=>{
 const{validateQuestion}=await import('../shared/question.ts');assert.equal(validateQuestion({...fixture,titleZh:'图书馆通知领取预订图书'}).titleZh,'图书馆通知领取预订图书');assert.throws(()=>validateQuestion({...fixture,titleZh:'答错'}));assert.throws(()=>validateQuestion({...fixture,titleZh:undefined}));
 const s=new Store(':memory:');const x=make(s);s.answer(x.id,'B','first');assert.equal(s.review()[0].titleZh,'图书馆通知领取预订图书');s.close();
});
test('no grant queues waiting approval with zero worker calls; repeated Continue deduplicates origin',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:'),x=make(s);s.answer(x.id,'A','first');let calls=0;const jobs=new NextJobs(s,{generate:async()=>{calls++;return 'never';}});
 const a=jobs.ensure(x.id),b=jobs.ensure(x.id);await tick();assert.equal(a.jobId,b.jobId);assert.equal(jobs.status(x.id).state,'waiting-approval');assert.equal(calls,0);assert.equal(s.budget().calls,0);s.close();
});
test('approved fixture worker is once-only and uses profile after four first answers',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:');s.setSettings({adaptiveDifficulty:true});let x:any;for(let i=0;i<4;i++){x=make(s,'independent-'+i);s.answer(x.id,'A','first');}
 s.approveContinuation(2,new Date().toISOString().slice(0,10));let n=0;let release!:(id:string)=>void;
 const jobs=new NextJobs(s,{generate:async attempt=>{n++;assert.equal(attempt.profile.effectiveStep,1);return await new Promise<string>(r=>release=r);}});
 jobs.ensure(x.id);jobs.ensure(x.id);await tick();assert.equal(n,1);assert.equal(jobs.status(x.id).state,'preparing');
 s.publish({...fixture,id:'generated-next',titleZh:'药房通知领取订购药品'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:100},'test',1);release('generated-next');await tick();assert.equal(jobs.status(x.id).state,'ready');assert.equal(jobs.ensure(x.id).questionId,'generated-next');assert.equal(n,1);s.close();
});
test('assistance does not auto-queue; explicit next can queue once; failures require explicit retry and slots count',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:'),x=make(s);s.event(x.id,'replay');s.answer(x.id,'A','first');s.approveContinuation(1,new Date().toISOString().slice(0,10));let n=0;
 const jobs=new NextJobs(s,{generate:async()=>{n++;throw Error('quality rejected');}});jobs.afterFirst(x.id,false);await tick();assert.equal(n,0);jobs.ensure(x.id);await tick();assert.equal(jobs.status(x.id).state,'failed');jobs.ensure(x.id);await tick();assert.equal(n,1);jobs.retry(x.id);await tick();assert.equal(n,1);assert.equal(jobs.status(x.id).state,'paused-quota');s.close();
});
test('continuation reservation preserves original caps and includes internal audit/TTS calls in global RMB5',()=>{
 const s=new Store(':memory:'),x=make(s);s.answer(x.id,'B','first');for(let i=0;i<4;i++)s.reserve('deepseek',0.1);for(let i=0;i<2;i++)s.reserve('tts',0.1);
 s.approveContinuation(1,new Date().toISOString().slice(0,10));const job=s.ensureNextJob(x.id),attempt=s.claimNextJob(job.jobId)!;
 for(let i=0;i<3;i++)s.reserveContinuation(attempt.id,'deepseek',0.05);assert.throws(()=>s.reserveContinuation(attempt.id,'deepseek',0.05));s.reserveContinuation(attempt.id,'tts',0.05);assert.throws(()=>s.reserveContinuation(attempt.id,'tts',0.05));assert.throws(()=>s.reserve('deepseek',0.01));assert.equal(s.budget().calls,10);s.close();
});



test('prefetch before answering stays one ahead across refresh, review and advancement',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:'),x=make(s);s.activatePractice(x.questionId);s.approveContinuation(3,new Date().toISOString().slice(0,10));let count=0;
 const jobs=new NextJobs(s,{generate:async()=>{count++;const id='next-'+count;s.publish({...fixture,id},audit,{file:'test.wav',sha256:'a'.repeat(64),bytes:100},'test');return id;}});
 jobs.ensure(x.id);await tick();assert.equal(count,1);assert.equal(s.session(x.id).first,null);jobs.ensure(x.id);await tick();assert.equal(count,1);
 const ready=jobs.status(x.id).questionId!;const y=s.start(ready);assert.equal(jobs.ensure(y.id).state,'review-only');assert.equal(count,1);
 s.activatePractice(ready);jobs.ensure(y.id);await tick();assert.equal(count,2);jobs.ensure(x.id);await tick();assert.equal(count,2);s.close();
});


test('second database connection does not interrupt live work; orphan saved output recovers without calls',async()=>{
 const{mkdtempSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'tef-job-'));const file=join(dir,'test.sqlite');
 const s=new Store(file),x=make(s);s.approveContinuation(2,new Date().toISOString().slice(0,10));const job=s.ensureNextJob(x.id),attempt=s.claimNextJob(job.jobId)!;
 const second=new Store(file);second.recoverNextJobs();assert.equal(second.nextJobStatus(x.id).state,'preparing');assert.equal(second.continuationAllowance().used,1);second.close();
 s.publishContinuation(attempt.id,{...fixture,id:'recovered-output'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:100},0);
 s.db.prepare('UPDATE continuation_attempts SET owner=0 WHERE id=?').run(attempt.id);s.close();
 const restored=new Store(file);restored.recoverNextJobs();assert.equal(restored.nextJobStatus(x.id).state,'retryable-quality');assert.equal(restored.get('recovered-output')!.accepted,false);assert.equal(restored.continuationAllowance().used,1);assert.equal(restored.budget().calls,0);restored.close();rmSync(dir,{recursive:true,force:true});
});
test('verified repricing resumes pause without resetting slots or budget',()=>{
 const s=new Store(':memory:'),x=make(s);s.approveContinuation(2,new Date().toISOString().slice(0,10));s.db.prepare("UPDATE continuation_authorization SET pricing_date='2000-01-01'").run();const job=s.ensureNextJob(x.id);assert.equal(s.claimNextJob(job.jobId),null);assert.equal(s.nextJobStatus(x.id).state,'paused-pricing');
 s.refreshContinuationPricing(new Date().toISOString().slice(0,10));assert.ok(s.claimNextJob(job.jobId));assert.equal(s.continuationAllowance().granted,2);assert.equal(s.continuationAllowance().used,1);s.close();
});


test('failure after publication finalizes linked output without another generation',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:'),x=make(s);s.approveContinuation(2,new Date().toISOString().slice(0,10));let count=0;
 const jobs=new NextJobs(s,{generate:async a=>{count++;s.publishContinuation(a.id,{...fixture,id:'saved-before-log-failure'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:100},0);s.accept('saved-before-log-failure');throw Error('provenance disk failure after publish');}});
 jobs.ensure(x.id);await tick();assert.equal(jobs.status(x.id).state,'ready');assert.equal(jobs.status(x.id).questionId,'saved-before-log-failure');jobs.retry(x.id);await tick();assert.equal(count,1);s.close();
});




test('live output needs explicit quality approval; quarantined output cannot be recovered or approved',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const s=new Store(':memory:'),x=make(s);s.approveContinuation(2,new Date().toISOString().slice(0,10));
 const jobs=new NextJobs(s,{generate:async a=>{s.publishContinuation(a.id,{...fixture,id:'model-approved-only'},audit,{file:'test.wav',sha256:'b'.repeat(64),bytes:100},0);return 'model-approved-only';}});
 jobs.ensure(x.id);await tick();const job=jobs.status(x.id);assert.equal(job.state,'awaiting-review');assert.equal(s.list().some(q=>q.id==='model-approved-only'),false);assert.throws(()=>s.start('model-approved-only'));
 s.approveNextQuality(job.jobId!);assert.equal(jobs.status(x.id).state,'ready');assert.equal(s.get('model-approved-only')!.accepted,true);
 s.db.prepare("UPDATE questions SET accepted=0 WHERE id='model-approved-only'").run();s.db.prepare("UPDATE next_jobs SET state='paused-quality' WHERE id=?").run(job.jobId);assert.throws(()=>s.approveNextQuality(job.jobId!));jobs.ensure(x.id);s.recoverNextJobs();assert.equal(jobs.status(x.id).state,'paused-quality');assert.equal(s.get('model-approved-only')!.accepted,false);s.close();
});

test('pre-audio content review pause is durable and cannot repeat generation on retry or reload',async()=>{
 const{NextJobs}=await import('../server/next-jobs.ts');const{PreAudioReviewRequired}=await import('../server/providers.ts');const s=new Store(':memory:'),x=make(s);s.approveContinuation(2,new Date().toISOString().slice(0,10));let calls=0;
 const jobs=new NextJobs(s,{generate:async()=>{calls++;throw new PreAudioReviewRequired('test-pending-content-run');}});jobs.ensure(x.id);await tick();assert.equal(jobs.status(x.id).state,'awaiting-content-review');assert.equal((s.db.prepare('SELECT run_id FROM pre_audio_reviews').get() as any).run_id,'test-pending-content-run');jobs.ensure(x.id);s.recoverNextJobs();await tick();assert.equal(calls,1);assert.equal(s.continuationAllowance().used,1);assert.equal(jobs.status(x.id).state,'awaiting-content-review');s.close();
});

test('legacy quality states are migrated into explicit recoverable state without startup work',async()=>{const{mkdtempSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const file=join(mkdtempSync(join(tmpdir(),'tef-migrate-')),'state.sqlite');let s=new Store(file);const x=make(s);s.approveContinuation(3,new Date().toISOString().slice(0,10));const j=s.ensureNextJob(x.id);s.db.prepare("UPDATE next_jobs SET state='awaiting-content-review' WHERE id=?").run(j.jobId);s.db.prepare('UPDATE pipeline_policy SET version=1').run();const answers=JSON.stringify(s.answers(x.id));s.close();s=new Store(file);let calls=0;const{NextJobs}=await import('../server/next-jobs.ts');const jobs=new NextJobs(s,{generate:async()=>{calls++;throw Error('fixture');}});s.recoverNextJobs();assert.equal(jobs.status(x.id).state,'retryable-quality');jobs.ensure(x.id);await tick();assert.equal(calls,0);assert.equal(JSON.stringify(s.answers(x.id)),answers);jobs.retry(x.id);await tick();assert.equal(calls,1);s.close();});
