import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,audit} from './fixture.ts';
import {CloudState,initialCloudState} from '../server/cloud/state.ts';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function setup(){const doc=initialCloudState();const s=new CloudState(doc,a);s.publish({...fixture,id:'test-cloud-first'},audit,{file:'test-cloud.wav',sha256:'a'.repeat(64),bytes:100,voice:'Serena'},0,'test');return {doc,s};}

test('entering bootstrap ready item consumes that slot before preparing exactly one new next item',()=>{
 const {doc,s}=setup(),boot='cccccccc-cccc-4ccc-8ccc-cccccccccccc';doc.next={id:boot,origin:null,state:'ready',result:'test-cloud-first',error:null};doc.nextJobs[boot]={origin:null,state:'ready',result:'test-cloud-first',error:null};
 const first=s.start('test-cloud-first');assert.equal(doc.next,null);const next=s.ensureNext(first.id);assert.notEqual(next.jobId,boot);assert.equal(next.state,'preparing');assert.equal((doc as ReturnType<typeof initialCloudState>).next!.origin,'test-cloud-first');
 const phone=new CloudState(doc,b),other=phone.start('test-cloud-first');assert.equal(phone.ensureNext(other.id).jobId,next.jobId);assert.equal(Object.keys(doc.nextJobs).length,2);
});
test('cloud first is shared but actual listening gates belong to each device',()=>{
 const {doc,s}=setup(),phone=new CloudState(doc,b),one=s.start('test-cloud-first'),two=phone.start('test-cloud-first');
 assert.notEqual(one.id,two.id);assert.equal(s.start(one.questionId).id,one.id);s.event(one.id,'ended');
 assert.throws(()=>phone.question(two.id));assert.throws(()=>phone.answer(two.id,'A','early'));
 const saved=s.answer(one.id,'B','first');assert.equal(saved.first.choice,'B');assert.equal(phone.session(two.id).first!.choice,'B');
 phone.event(two.id,'ended');assert.throws(()=>phone.answer(two.id,'A','stale-submit'),/已在另一台设备/);assert.equal(doc.answers.length,1);
 phone.event(two.id,'replay');const helped=phone.answer(two.id,'A','helped');assert.equal(helped.first.choice,'B');assert.equal(helped.latest!.assisted,true);assert.equal(doc.answers.length,2);
 assert.throws(()=>phone.session(one.id),/设备/);
});
test('same POST retries return stored result; conflicting duplicate does not mutate',()=>{
 const {doc,s}=setup(),one=s.start('test-cloud-first');s.event(one.id,'ended');const first=s.answer(one.id,'A','repeat');
 assert.deepEqual(s.answer(one.id,'A','repeat'),first);assert.throws(()=>s.answer(one.id,'B','repeat'));assert.equal(doc.answers.length,1);
});
test('reveal assistance crosses devices without granting other device feedback or ended',()=>{
 const {doc,s}=setup(),phone=new CloudState(doc,b),one=s.start('test-cloud-first'),two=phone.start('test-cloud-first');
 s.event(one.id,'ended');s.event(one.id,'reveal');assert.throws(()=>phone.feedback(two.id));phone.event(two.id,'ended');
 assert.equal(phone.answer(two.id,'A','answer').first.assisted,true);assert.equal(doc.settings.streak,0);
});
test('review uses canonical first, appends history and never prepares a new question',()=>{
 const {doc,s}=setup(),one=s.start('test-cloud-first');s.event(one.id,'ended');s.answer(one.id,'B','wrong');
 const phone=new CloudState(doc,b),r=phone.startReview(one.id,'review-1');assert.equal(r.reviewMode,true);assert.equal(phone.startReview(one.id,'review-1').id,r.id);
 assert.equal(phone.ensureNext(r.id).state,'review-only');phone.event(r.id,'ended');phone.answer(r.id,'A','correct');assert.equal(phone.review()[0]!.resolved,true);assert.equal(doc.first['test-cloud-first']!.answer.choice,'B');assert.equal(doc.next,null);
});
test('one ahead is shared and ready content is not recursively prefetched',()=>{
 const {doc,s}=setup(),one=s.start('test-cloud-first'),phone=new CloudState(doc,b),two=phone.start('test-cloud-first');
 const job=s.ensureNext(one.id);assert.equal(phone.ensureNext(two.id).jobId,job.jobId);assert.equal(Object.keys(doc.nextJobs).length,1);
 s.publish({...fixture,id:'test-cloud-next'},audit,{file:'next.wav',sha256:'b'.repeat(64),bytes:100,voice:'Serena'},0,'test');s.finishNext(job.jobId!,'test-cloud-next');assert.equal(Object.keys(doc.nextJobs).length,1);
 s.start('test-cloud-next');assert.equal(doc.currentQuestionId,'test-cloud-next');const shared=phone.ensureNext(two.id);assert.equal(shared.state,'ready');assert.equal(shared.questionId,'test-cloud-next');assert.equal(Object.keys(doc.nextJobs).length,1);
});
test('settings patches preserve independent fields, new sessions use shared defaults',()=>{
 const {doc,s}=setup(),phone=new CloudState(doc,b);s.setSettings({defaultPlaybackRate:0.8});phone.setSettings({defaultVoice:'Cherry',questionDisplay:'immediate'});
 const x=s.start('test-cloud-first');assert.equal(x.playbackRate,0.8);assert.equal(x.voice,'Cherry');assert.equal(x.questionDisplay,'immediate');assert.equal(s.question(x.id).options.length,4);assert.throws(()=>s.feedback(x.id));assert.throws(()=>s.answer(x.id,'A','early'));
 assert.throws(()=>s.setSettings({defaultPlaybackRate:0}));assert.equal(doc.settings.defaultPlaybackRate,0.8);
});
test('confirmed help on one device follows the shared first attempt on another',()=>{const {doc,s}=setup(),phone=new CloudState(doc,b),one=s.start('test-cloud-first'),two=phone.start('test-cloud-first');s.playback(one.id,0.8,'select');assert.equal(phone.session(two.id).assisted,false);s.playback(one.id,0.8,'play');assert.equal(phone.session(two.id).assisted,true);phone.event(two.id,'ended');assert.equal(phone.answer(two.id,'A','shared-help').first.assisted,true);});
