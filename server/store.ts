import{assertAutomaticProof}from'./automatic-proof.ts';
import{validateCritic}from'./quality-critic.ts';import{validateClaimCoverage}from'./claim-coverage.ts';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';import{readFileSync}from'node:fs';
import {validateQuestion,validateAudit,publicQuestion,IDS,type Question,type Choice} from '../shared/question.ts';
import {observeDifficulty,difficultyProfile} from '../shared/difficulty.ts';
type Row=Record<string,any>;
function legacyTitle(q:any){return q.script?.includes('Julien du garage Martin')?'Julien给客户留下修车留言':q.script?.includes('bibliothèque')?'图书馆通知领取预订图书':'日常场景听力（旧题）';}
export type Voice='Emilien'|'Serena'|'Cherry';
export interface AudioRecord {file:string;sha256:string;bytes:number;voice?:Voice}
export class Store {
 db:DatabaseSync;
 constructor(file:string){
  this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,body TEXT NOT NULL,audit TEXT NOT NULL,audio TEXT NOT NULL,source TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,qid TEXT NOT NULL REFERENCES questions(id),ended INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,session TEXT NOT NULL REFERENCES sessions(id),kind TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS answers(seq INTEGER PRIMARY KEY,session TEXT NOT NULL REFERENCES sessions(id),request TEXT NOT NULL,choice TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(session,request));
   CREATE TABLE IF NOT EXISTS reservations(seq INTEGER PRIMARY KEY,provider TEXT NOT NULL,cost REAL NOT NULL,created INTEGER NOT NULL);
   CREATE TRIGGER IF NOT EXISTS answers_immutable_update BEFORE UPDATE ON answers BEGIN SELECT RAISE(ABORT,'immutable answers');END;
   CREATE TRIGGER IF NOT EXISTS answers_immutable_delete BEFORE DELETE ON answers BEGIN SELECT RAISE(ABORT,'immutable answers');END;`);
  this.db.exec(`CREATE TABLE IF NOT EXISTS difficulty_state(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,step INTEGER NOT NULL DEFAULT 0,streak INTEGER NOT NULL DEFAULT 0);
   INSERT OR IGNORE INTO difficulty_state(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS difficulty_seen(qid TEXT PRIMARY KEY REFERENCES questions(id));
   CREATE TABLE IF NOT EXISTS translation_authorization(id INTEGER PRIMARY KEY CHECK(id=1),granted INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,pricing_date TEXT NOT NULL DEFAULT '');
   INSERT OR IGNORE INTO translation_authorization(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS translation_call_log(seq INTEGER PRIMARY KEY,body TEXT NOT NULL,created INTEGER NOT NULL);`);

  this.db.exec(`CREATE TABLE IF NOT EXISTS question_titles(qid TEXT PRIMARY KEY REFERENCES questions(id),title TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tts_authorization(id INTEGER PRIMARY KEY CHECK(id=1),ceiling REAL NOT NULL DEFAULT 0,pricing_date TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO tts_authorization(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS deepseek_authorization(id INTEGER PRIMARY KEY CHECK(id=1),ceiling REAL NOT NULL DEFAULT 0,pricing_date TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO deepseek_authorization(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS continuation_authorization(id INTEGER PRIMARY KEY CHECK(id=1),granted INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,pricing_date TEXT NOT NULL DEFAULT '');
   INSERT OR IGNORE INTO continuation_authorization(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS study_stream(id INTEGER PRIMARY KEY CHECK(id=1),qid TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS next_jobs(id TEXT PRIMARY KEY,origin TEXT NOT NULL UNIQUE REFERENCES questions(id),state TEXT NOT NULL,result TEXT,error TEXT,profile TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS continuation_attempts(id TEXT PRIMARY KEY,job TEXT NOT NULL REFERENCES next_jobs(id),state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS content_repairs(parent_run TEXT PRIMARY KEY,job TEXT NOT NULL REFERENCES next_jobs(id),body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending');
   CREATE TABLE IF NOT EXISTS pre_audio_reviews(attempt TEXT PRIMARY KEY REFERENCES continuation_attempts(id),run_id TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS continuation_calls(seq INTEGER PRIMARY KEY,attempt TEXT NOT NULL REFERENCES continuation_attempts(id),provider TEXT NOT NULL);
`);
  for(const [column,definition] of [['owner','INTEGER'],['qid','TEXT'],['run_id','TEXT'],['run_path','TEXT']] as const)if(!(this.db.prepare('PRAGMA table_info(continuation_attempts)').all() as Row[]).some(r=>r.name===column))this.db.exec('ALTER TABLE continuation_attempts ADD COLUMN '+column+' '+definition);
  for(const [column,definition] of [['recovery_cycle','INTEGER NOT NULL DEFAULT 0'],['request_seq','INTEGER NOT NULL DEFAULT 0'],['recovery_input','TEXT'],['resume_run','TEXT']] as const)if(!(this.db.prepare('PRAGMA table_info(next_jobs)').all() as Row[]).some(r=>r.name===column))this.db.exec('ALTER TABLE next_jobs ADD COLUMN '+column+' '+definition);
  this.db.exec('CREATE TABLE IF NOT EXISTS automatic_validations(qid TEXT PRIMARY KEY REFERENCES questions(id),body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS pipeline_policy(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
  if(!this.db.prepare('SELECT 1 FROM pipeline_policy WHERE id=1 AND version>=2').get()){
   this.db.exec("UPDATE next_jobs SET state='retryable-quality' WHERE state IN ('paused-quality','awaiting-content-review','awaiting-review');INSERT OR REPLACE INTO pipeline_policy(id,version) VALUES(1,2)");
  }
  for(const row of this.db.prepare('SELECT id,body FROM questions').all() as Row[]){const q=JSON.parse(row.body);const title=q.titleZh??legacyTitle(q);this.db.prepare('INSERT OR IGNORE INTO question_titles(qid,title) VALUES(?,?)').run(row.id,title);}


  if(!(this.db.prepare('PRAGMA table_info(sessions)').all() as Row[]).some(r=>r.name==='playback_rate'))this.db.exec('ALTER TABLE sessions ADD COLUMN playback_rate REAL NOT NULL DEFAULT 1');
  if(!(this.db.prepare('PRAGMA table_info(events)').all() as Row[]).some(r=>r.name==='body'))this.db.exec('ALTER TABLE events ADD COLUMN body TEXT');
  this.db.exec("CREATE TABLE IF NOT EXISTS playback_settings(id INTEGER PRIMARY KEY CHECK(id=1),rate REAL NOT NULL DEFAULT 1,display TEXT NOT NULL DEFAULT 'after-audio');INSERT OR IGNORE INTO playback_settings(id) VALUES(1);");

  for(const column of ['review_of','review_request'])if(!(this.db.prepare('PRAGMA table_info(sessions)').all() as Row[]).some(r=>r.name===column))this.db.exec('ALTER TABLE sessions ADD COLUMN '+column+' TEXT');
  this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS review_request_once ON sessions(review_of,review_request) WHERE review_of IS NOT NULL');
  for(const [column,definition] of [['voice',"TEXT NOT NULL DEFAULT 'Serena'"],['voice_epoch','INTEGER NOT NULL DEFAULT 0']] as const)if(!(this.db.prepare('PRAGMA table_info(sessions)').all() as Row[]).some(r=>r.name===column))this.db.exec('ALTER TABLE sessions ADD COLUMN '+column+' '+definition);
  if(!(this.db.prepare('PRAGMA table_info(playback_settings)').all() as Row[]).some(r=>r.name==='voice'))this.db.exec("ALTER TABLE playback_settings ADD COLUMN voice TEXT NOT NULL DEFAULT 'Serena'");
  if(!(this.db.prepare('PRAGMA table_info(questions)').all() as Row[]).some(r=>r.name==='difficulty'))this.db.exec('ALTER TABLE questions ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 0');
 }
 translationAllowance(){return this.db.prepare('SELECT granted,used,pricing_date AS pricingDate FROM translation_authorization WHERE id=1').get() as {granted:number;used:number;pricingDate:string};}
 authorizeTranslationOnce(pricingDate=new Date().toISOString().slice(0,10)){
  if(pricingDate!==new Date().toISOString().slice(0,10))throw Error('请先核对当天官方价格');
  this.db.prepare("UPDATE translation_authorization SET granted=1,pricing_date=CASE WHEN granted=0 THEN ? ELSE pricing_date END WHERE id=1").run(pricingDate);return this.translationAllowance();
 }
 reserveTranslation(cost:number){
  return this.transaction(()=>{const grant=this.translationAllowance();if(grant.granted!==1||grant.used!==0||grant.pricingDate!==new Date().toISOString().slice(0,10))throw Error('单次翻译授权不可用');
   if(!Number.isFinite(cost)||cost<=0||cost>0.25||this.budget().reserved+cost>5)throw Error('翻译请求超过累计预算');
   this.db.prepare('UPDATE translation_authorization SET used=1 WHERE id=1').run();
   this.db.prepare("INSERT INTO reservations(provider,cost,created) VALUES('deepseek-translation',?,?)").run(cost,Date.now());return this.budget();
  });
 }
 recordTranslationCall(value:unknown){this.db.prepare('INSERT INTO translation_call_log(body,created) VALUES(?,?)').run(JSON.stringify(value),Date.now());}

 settings(){
  const r=this.db.prepare('SELECT * FROM difficulty_state WHERE id=1').get() as Row;
  const effectiveStep=r.enabled?r.step:0;
  const playback=this.db.prepare('SELECT rate,display,voice FROM playback_settings WHERE id=1').get() as Row;
  return {defaultVoice:playback.voice as Voice,defaultPlaybackRate:playback.rate as number,questionDisplay:playback.display as 'after-audio'|'immediate',adaptiveDifficulty:!!r.enabled,difficultyStep:r.step as number,streak:r.streak as number,effectiveStep,generationProfile:difficultyProfile(effectiveStep)};
 }
 setSettings(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('设置格式无效');
  const v=value as any,keys=Object.keys(v);if(!keys.length||!keys.every(k=>['adaptiveDifficulty','defaultPlaybackRate','questionDisplay','defaultVoice'].includes(k)))throw Error('设置格式无效');
  if(Object.hasOwn(v,'defaultVoice')&&!['Emilien','Serena','Cherry'].includes(v.defaultVoice)||Object.hasOwn(v,'adaptiveDifficulty')&&typeof v.adaptiveDifficulty!=='boolean'||Object.hasOwn(v,'defaultPlaybackRate')&&![0.8,1,1.2].includes(v.defaultPlaybackRate)||Object.hasOwn(v,'questionDisplay')&&!['after-audio','immediate'].includes(v.questionDisplay))throw Error('设置格式无效');
  return this.transaction(()=>{if(Object.hasOwn(v,'defaultVoice'))this.db.prepare('UPDATE playback_settings SET voice=? WHERE id=1').run(v.defaultVoice);if(Object.hasOwn(v,'adaptiveDifficulty'))this.db.prepare('UPDATE difficulty_state SET enabled=?,streak=CASE WHEN enabled<>? THEN 0 ELSE streak END WHERE id=1').run(v.adaptiveDifficulty?1:0,v.adaptiveDifficulty?1:0);if(Object.hasOwn(v,'defaultPlaybackRate'))this.db.prepare('UPDATE playback_settings SET rate=? WHERE id=1').run(v.defaultPlaybackRate);if(Object.hasOwn(v,'questionDisplay'))this.db.prepare('UPDATE playback_settings SET display=? WHERE id=1').run(v.questionDisplay);return this.settings();});
 }
 observeFirst(qid:string,answer:{correct:boolean|null;assisted:boolean}){
  const result=this.db.prepare('INSERT OR IGNORE INTO difficulty_seen(qid) VALUES(?)').run(qid);if(!result.changes)return;
  const r=this.db.prepare('SELECT * FROM difficulty_state WHERE id=1').get() as Row;
  const next=observeDifficulty({enabled:!!r.enabled,step:r.step,streak:r.streak},answer);
  this.db.prepare('UPDATE difficulty_state SET step=?,streak=? WHERE id=1').run(next.step,next.streak);
 }
 nextQuestion(excludeId=''){
  const rows=this.db.prepare(`SELECT q.id,q.source,q.difficulty FROM questions q WHERE q.accepted=1 AND q.id<>?
   AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.qid=q.id)
   AND NOT EXISTS(SELECT 1 FROM sessions s JOIN events e ON e.session=s.id WHERE s.qid=q.id AND e.kind='reveal')
   ORDER BY ABS(q.difficulty-?),q.rowid`).all(excludeId,this.settings().effectiveStep) as Row[];
  return rows.length?{id:rows[0]!.id as string,source:rows[0]!.source as string,difficultyStep:rows[0]!.difficulty as number}:null;
 }


 activatePractice(qid:string){const stream=this.db.prepare('SELECT qid FROM study_stream WHERE id=1').get() as Row|undefined;if(!stream){this.db.prepare('INSERT INTO study_stream(id,qid) VALUES(1,?)').run(qid);return;}
  if(this.db.prepare("SELECT 1 FROM next_jobs WHERE origin=? AND state='ready' AND result=?").get(stream.qid,qid))this.db.prepare('UPDATE study_stream SET qid=? WHERE id=1').run(qid);
 }
 validatedSavedRun(jobId:string){const rows=this.db.prepare('SELECT run_id,run_path FROM continuation_attempts WHERE job=? AND run_path IS NOT NULL ORDER BY rowid DESC').all(jobId) as Row[];for(const a of rows)try{const r=JSON.parse(readFileSync(a.run_path,'utf8')),q=validateQuestion(r.question??r.draft);if(r.id!==a.run_id)continue;assertAutomaticProof(r.automaticValidation,q,a.run_id);validateCritic(r.critic,q,true);validateClaimCoverage(r.claimCoverage,q);validateAudit(r.audit,q);return a.run_id as string;}catch{}return null;}
 recoverNextJobs(){for(const snapshot of this.db.prepare("SELECT id FROM continuation_attempts WHERE state='running'").all() as Row[])this.transaction(()=>{const a=this.db.prepare("SELECT a.* FROM continuation_attempts a JOIN next_jobs j ON j.id=a.job WHERE a.id=? AND a.state='running' AND j.state='preparing'").get(snapshot.id) as Row|undefined;if(!a)return;let alive=false;try{if(a.owner){process.kill(a.owner,0);alive=true;}}catch{}if(alive)return;if(a.qid&&this.get(a.qid)?.accepted){this.db.prepare("UPDATE continuation_attempts SET state='complete' WHERE id=? AND state='running'").run(a.id);this.db.prepare("UPDATE next_jobs SET state='ready',result=?,error=NULL WHERE id=? AND state='preparing'").run(a.qid,a.job);return;}const resume=this.validatedSavedRun(a.job);this.db.prepare("UPDATE continuation_attempts SET state='failed' WHERE id=? AND state='running'").run(a.id);this.db.prepare("UPDATE next_jobs SET state='retryable-quality',resume_run=?,error=? WHERE id=? AND state='preparing'").run(resume,resume?'已验证草稿保存完好，点击重新生成可继续准备音频。':'上次准备中断，可点击重新生成。',a.job);});}
 refreshContinuationPricing(date:string){if(date!==new Date().toISOString().slice(0,10))throw Error('价格核对日期无效');this.db.prepare('UPDATE continuation_authorization SET pricing_date=? WHERE id=1').run(date);this.db.prepare("UPDATE next_jobs SET state='waiting-approval' WHERE state='paused-pricing'").run();}
 ttsAuthorization(){return this.db.prepare('SELECT * FROM tts_authorization WHERE id=1').get() as Row;}
 authorizeTts100(pricingDate:string){if(pricingDate!==new Date().toISOString().slice(0,10))throw Error('先核对当天语音价格');this.db.prepare('UPDATE tts_authorization SET ceiling=100,pricing_date=? WHERE id=1').run(pricingDate);this.db.prepare("UPDATE next_jobs SET state='waiting-approval' WHERE state='paused-voice-budget'").run();return this.providerBudget();}
 ttsHasRoom(cost:number){const grant=this.ttsAuthorization();return grant.ceiling===100?grant.pricing_date===new Date().toISOString().slice(0,10)&&this.providerBudget().tts.reserved+cost<=100+1e-9:this.budget().reserved+cost<=5+1e-9;}
 reserveVoiceAudition(cost:number){return this.transaction(()=>{if(this.ttsAuthorization().ceiling!==100||!Number.isFinite(cost)||cost<=0||cost>0.5||!this.ttsHasRoom(cost))throw Error('语音试听授权或累计预算不足');this.db.prepare("INSERT INTO reservations(provider,cost,created) VALUES('audition-tts',?,?)").run(cost,Date.now());return this.providerBudget();});}
 deepseekAuthorization(){return this.db.prepare('SELECT * FROM deepseek_authorization WHERE id=1').get() as Row;}
 authorizeDeepseek20(pricingDate:string){if(pricingDate!==new Date().toISOString().slice(0,10))throw Error('先核对当天价格');this.db.prepare('UPDATE deepseek_authorization SET ceiling=20,pricing_date=? WHERE id=1').run(pricingDate);this.db.prepare("UPDATE next_jobs SET state='waiting-approval' WHERE state IN ('paused-quota','paused-pricing')").run();return this.providerBudget();}
 providerBudget(){const rows=this.db.prepare('SELECT provider,cost FROM reservations').all() as Row[],ds=rows.filter(r=>r.provider.includes('deepseek')),tts=rows.filter(r=>r.provider.includes('tts'));const sum=(a:Row[])=>Math.round(a.reduce((n,r)=>n+r.cost,0)*1e6)/1e6;return{deepseek:{limit:this.deepseekAuthorization().ceiling||null,reserved:sum(ds),calls:ds.length},tts:{limit:this.ttsAuthorization().ceiling||null,originalMixedLimit:5,originalMixedReserved:sum(rows),originalMixedGuardActive:this.ttsAuthorization().ceiling!==100,reserved:sum(tts),calls:tts.length,policy:this.ttsAuthorization().ceiling===100?'provider-only cumulative100, all voice history included':'original cumulative mixed5, never funded by DeepSeek20'}};}
 reserveDeepseekDevelopment(cost:number){return this.transaction(()=>{const a=this.deepseekAuthorization();if(a.ceiling!==20||a.pricing_date!==new Date().toISOString().slice(0,10)||!Number.isFinite(cost)||cost<=0||cost>0.5||this.providerBudget().deepseek.reserved+cost>20+1e-9)throw Error('文本实验授权或预算不足');this.db.prepare("INSERT INTO reservations(provider,cost,created) VALUES('development-deepseek',?,?)").run(cost,Date.now());return this.providerBudget();});}
 continuationAllowance():Row & {attemptLimit:number|null}{const r=this.db.prepare('SELECT * FROM continuation_authorization WHERE id=1').get() as Row;return{...r,attemptLimit:this.deepseekAuthorization().ceiling===20?null:r.granted};}
 approveContinuation(max:number,pricingDate:string){
  if(!Number.isInteger(max)||max<1||max>10||pricingDate!==new Date().toISOString().slice(0,10))throw Error('授权范围或价格日期无效');
  const current=this.continuationAllowance();if(current.granted)throw Error('已有授权，不能重置额度');
  this.db.prepare('UPDATE continuation_authorization SET granted=?,pricing_date=? WHERE id=1').run(max,pricingDate);
 }
 nextJobStatus(session:string){const s=this.session(session);if(s.reviewMode)return{jobId:null,state:'review-only',questionId:null,error:null};const row=this.db.prepare('SELECT * FROM next_jobs WHERE origin=?').get(s.questionId) as Row|undefined;
  return row?{recoveryCycle:row.recovery_cycle,requestSeq:row.request_seq,jobId:row.id,state:row.state,questionId:row.result??null,error:row.error??null}:{jobId:null,state:'unrequested',questionId:null,error:null};}
 ensureNextJob(session:string){
  const s=this.session(session);if(s.reviewMode)return{jobId:null,state:'review-only',questionId:null,error:null};
  const old=this.nextJobStatus(session);if(old.jobId)return old;
  const stream=this.db.prepare('SELECT qid FROM study_stream WHERE id=1').get() as Row|undefined;
  if(stream&&stream.qid!==s.questionId)return {jobId:null,state:'review-only',questionId:null,error:null};
  this.db.prepare('INSERT OR IGNORE INTO study_stream(id,qid) VALUES(1,?)').run(s.questionId);
  const next=this.nextQuestion(s.questionId),id=randomUUID();
  this.db.prepare('INSERT OR IGNORE INTO next_jobs(id,origin,state,result,profile) VALUES(?,?,?,?,?)').run(id,s.questionId,next?'ready':'waiting-approval',next?.id??null,JSON.stringify(this.settings()));
  return this.nextJobStatus(session);
 }
 retryNextJob(session:string){return this.transaction(()=>{const current=this.session(session);if(current.reviewMode)return{jobId:null,state:'review-only',questionId:null,error:null};const stream=this.db.prepare('SELECT qid FROM study_stream WHERE id=1').get() as Row|undefined;if(stream&&stream.qid!==current.questionId)return {jobId:null,state:'review-only',questionId:null,error:null};const job=this.nextJobStatus(session);if(!['failed','retryable-quality','paused-quality','awaiting-content-review','awaiting-review'].includes(job.state))return job;
  this.db.prepare("UPDATE next_jobs SET state='waiting-approval',error=NULL,recovery_cycle=0,recovery_input=NULL,request_seq=request_seq+1,profile=?,resume_run=? WHERE id=?").run(JSON.stringify(this.settings()),this.validatedSavedRun(job.jobId!),job.jobId);return this.nextJobStatus(session);});}
 recoverRejected(id:string,attemptId:string,error:string){return this.transaction(()=>{
  const job=this.db.prepare("SELECT * FROM next_jobs WHERE id=? AND state='preparing'").get(id) as Row|undefined;
  const a=this.db.prepare("SELECT * FROM continuation_attempts WHERE id=? AND job=? AND state='running'").get(attemptId,id) as Row|undefined;if(!job||!a)return false;
  this.failNextJob(id,error,attemptId,true);
  if(job.recovery_cycle>=2){this.db.prepare("UPDATE next_jobs SET state='retryable-quality' WHERE id=?").run(id);return false;}
  let input=null;if(job.recovery_cycle===0&&a.run_path)try{const r=JSON.parse(readFileSync(a.run_path,'utf8'));const question=validateQuestion(r.question??r.draft);input=JSON.stringify({parentRunId:a.run_id,question,findings:[error,JSON.stringify({critic:r.critic?{approved:r.critic.approved,shortcutRisk:r.critic.shortcutRisk,reasons:r.critic.criterionReasons}:null,claimCoverage:r.claimCoverage??null,audit:r.audit??null}).slice(0,4500),'Keep the same everyday scene during targeted repair. Do not switch to a different setting. Repair the entire listening objective and all options together. Preserve exact evidence and similar option scope. If the judgment is contradictory, resolve it with clear supported wording rather than copying the disputed assertion.']});}catch{}
  this.db.prepare("UPDATE next_jobs SET state='waiting-approval',recovery_cycle=recovery_cycle+1,recovery_input=? WHERE id=?").run(input,id);return true;
 });}
 requestContentRepair(jobId:string,parentRunId:string,findings:string[]){return this.transaction(()=>{
  const old=this.db.prepare('SELECT * FROM content_repairs WHERE parent_run=?').get(parentRunId);if(old)return false;
  const job=this.db.prepare("SELECT * FROM next_jobs WHERE id=? AND state='paused-quality'").get(jobId) as Row|undefined;
  const a=this.db.prepare("SELECT * FROM continuation_attempts WHERE job=? AND run_id=? AND state='failed'").get(jobId,parentRunId) as Row|undefined;
  if(!job||!a?.run_path||!findings.length||findings.some(x=>typeof x!=='string'||x.length<8)||this.deepseekAuthorization().ceiling!==20)throw Error('Repair requires a saved rejected candidate and concrete findings');
  const saved=JSON.parse(readFileSync(a.run_path,'utf8')),question=saved.question??saved.draft;validateQuestion(question);
  this.db.prepare('INSERT INTO content_repairs(parent_run,job,body) VALUES(?,?,?)').run(parentRunId,jobId,JSON.stringify({parentRunId,question,findings}));
  this.db.prepare("UPDATE next_jobs SET state='waiting-approval',error=NULL WHERE id=?").run(jobId);return true;
 });}
 claimNextJob(id:string){return this.transaction(()=>{
  const job=this.db.prepare('SELECT * FROM next_jobs WHERE id=?').get(id) as Row|undefined;if(!job||job.state!=='waiting-approval')return null;const stream=this.db.prepare('SELECT qid FROM study_stream WHERE id=1').get() as Row|undefined;if(stream&&stream.qid!==job.origin){this.db.prepare("UPDATE next_jobs SET state='review-only' WHERE id=?").run(id);return null;}
  const g=this.continuationAllowance();let state='';
  if(!g.granted)return null;
  const extended=this.deepseekAuthorization();
   if(extended.ceiling!==20&&g.used>=g.granted)state='paused-quota';
   else if(extended.ceiling===20&&this.providerBudget().deepseek.reserved+0.733>20)state='paused-deepseek-budget';
   else if(this.ttsAuthorization().ceiling===100?!this.ttsHasRoom(0.13):this.budget().reserved+(extended.ceiling===20?0.87:0.82)>5)state=extended.ceiling===20?'paused-voice-budget':'paused-budget';
  else if(g.pricing_date!==new Date().toISOString().slice(0,10))state='paused-pricing';
  if(state){this.db.prepare('UPDATE next_jobs SET state=? WHERE id=?').run(state,id);return null;}
  const attempt=randomUUID();this.db.prepare('UPDATE continuation_authorization SET used=used+1 WHERE id=1').run();
  this.db.prepare("INSERT INTO continuation_attempts(id,job,state,owner) VALUES(?,?,'running',?)").run(attempt,id,process.pid);
  this.db.prepare("UPDATE next_jobs SET state='preparing' WHERE id=?").run(id);
  const repair=this.db.prepare("SELECT * FROM content_repairs WHERE job=? AND state='pending' ORDER BY rowid LIMIT 1").get(id) as Row|undefined;if(repair)this.db.prepare("UPDATE content_repairs SET state='claimed' WHERE parent_run=?").run(repair.parent_run);return {id:attempt,jobId:id,profile:JSON.parse(job.profile),pricingDate:g.pricing_date,repairInput:job.recovery_input?JSON.parse(job.recovery_input):repair?JSON.parse(repair.body):undefined,recoveryCycle:job.recovery_cycle,requestSeq:job.request_seq,resumeRunId:job.resume_run??undefined};
 });}
 reserveContinuation(id:string,provider:'deepseek'|'tts',cost:number){return this.transaction(()=>{
  const a=this.db.prepare("SELECT * FROM continuation_attempts WHERE id=? AND state='running'").get(id);
  if(!a||!['deepseek','tts'].includes(provider)||!Number.isFinite(cost)||cost<=0||cost>0.5)throw Error('续题预留无效');
  const n=(this.db.prepare('SELECT COUNT(*) n FROM continuation_calls WHERE attempt=? AND provider=?').get(id,provider) as Row).n;
  const extended=provider==='deepseek'&&this.deepseekAuthorization().ceiling===20;
   if(n>=(provider==='deepseek'?(extended?4:3):1)||(extended?this.deepseekAuthorization().pricing_date!==new Date().toISOString().slice(0,10)||this.providerBudget().deepseek.reserved+cost>20+1e-9:provider==='tts'&&this.ttsAuthorization().ceiling===100?!this.ttsHasRoom(cost):this.budget().reserved+cost>5+1e-9))throw Error('续题调用或累计预算已用尽');
  this.db.prepare('INSERT INTO continuation_calls(attempt,provider) VALUES(?,?)').run(id,provider);
  this.db.prepare('INSERT INTO reservations(provider,cost,created) VALUES(?,?,?)').run('continuation-'+provider,cost,Date.now());
 });}
 associateAttemptRun(attempt:string,runId:string,path:string){if(!this.db.prepare("SELECT 1 FROM continuation_attempts WHERE id=? AND state='running' AND (run_id IS NULL OR run_id=?)").get(attempt,runId))throw Error('生成记录关联不符');this.db.prepare('UPDATE continuation_attempts SET run_id=?,run_path=? WHERE id=?').run(runId,path,attempt);}
 pausePreAudioAttempt(attempt:string,runId:string){const row=this.db.prepare('SELECT job FROM continuation_attempts WHERE id=?').get(attempt) as Row|undefined;if(!row)throw Error('任务不存在');this.pauseNextBeforeAudio(row.job,attempt,runId);}
 pendingPreAudio(runId:string){const a=this.db.prepare('SELECT a.id,a.job,j.profile,g.pricing_date FROM pre_audio_reviews p JOIN continuation_attempts a ON a.id=p.attempt JOIN next_jobs j ON j.id=a.job JOIN continuation_authorization g ON g.id=1 WHERE p.run_id=? AND a.state=\'awaiting-review\' AND j.state=\'awaiting-content-review\'').get(runId) as Row|undefined;if(!a)throw Error('没有待复核草稿');return{id:a.id,jobId:a.job,profile:JSON.parse(a.profile),pricingDate:a.pricing_date};}
 resumePreAudio(attempt:string,runId:string){return this.transaction(()=>{const a=this.pendingPreAudio(runId);if(a.id!==attempt||a.pricingDate!==new Date().toISOString().slice(0,10)||!this.ttsHasRoom(0.13))throw Error('恢复草稿的任务、价格或预算不符');this.db.prepare("UPDATE continuation_attempts SET state='running',owner=? WHERE id=?").run(process.pid,attempt);this.db.prepare("UPDATE next_jobs SET state='preparing' WHERE id=?").run(a.jobId);});}
 pauseNextBeforeAudio(id:string,attempt:string,runId:string){return this.transaction(()=>{const existing=this.db.prepare('SELECT run_id FROM pre_audio_reviews WHERE attempt=?').get(attempt) as Row|undefined;if(existing&&existing.run_id!==runId)throw Error('草稿记录不匹配');if(existing&&this.db.prepare("SELECT 1 FROM continuation_attempts WHERE id=? AND state='awaiting-review'").get(attempt))return;if(!this.db.prepare("SELECT 1 FROM continuation_attempts WHERE id=? AND job=? AND state='running'").get(attempt,id))throw Error('任务不再运行');this.db.prepare('INSERT OR IGNORE INTO pre_audio_reviews(attempt,run_id,created) VALUES(?,?,?)').run(attempt,runId,Date.now());this.db.prepare("UPDATE continuation_attempts SET state='awaiting-review' WHERE id=?").run(attempt);this.db.prepare("UPDATE next_jobs SET state='awaiting-content-review' WHERE id=?").run(id);});}
 approveNextQuality(id:string){return this.transaction(()=>{const job=this.db.prepare("SELECT * FROM next_jobs WHERE id=? AND state='awaiting-review'").get(id) as Row|undefined;if(!job?.result)throw Error('没有待复核的新题');this.accept(job.result);this.db.prepare("UPDATE next_jobs SET state='ready' WHERE id=?").run(id);});}
 finishNextJob(id:string,qid:string,attemptId:string){return this.transaction(()=>{const a=this.db.prepare("SELECT * FROM continuation_attempts WHERE id=? AND job=? AND state='running'").get(attemptId,id);if(!a)throw Error('生成任务已停止，不能覆盖结果');const reviewed=this.get(qid)?.accepted===true;this.db.prepare("UPDATE next_jobs SET state=?,result=?,error=NULL WHERE id=? AND state='preparing'").run(reviewed?'ready':'awaiting-review',qid,id);this.db.prepare("UPDATE continuation_attempts SET state='complete',qid=? WHERE id=?").run(qid,attemptId);});}
 failNextJob(id:string,error:string,attemptId?:string,qualityRejected=false){const saved=attemptId?this.db.prepare("SELECT qid FROM continuation_attempts WHERE id=? AND state='running'").get(attemptId) as Row|undefined:undefined;if(saved?.qid&&this.get(saved.qid)){this.finishNextJob(id,saved.qid,attemptId!);return;}if(attemptId&&!this.db.prepare("SELECT 1 FROM continuation_attempts WHERE id=? AND state='running'").get(attemptId))return;this.db.prepare("UPDATE next_jobs SET state=?,error=? WHERE id=?").run(qualityRejected?'paused-quality':'failed',error.slice(0,200),id);this.db.prepare("UPDATE continuation_attempts SET state='failed' WHERE job=? AND state='running'").run(id);}

 close(){this.db.close();}
 transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 publishContinuation(attemptId:string,value:unknown,audit:unknown,audio:AudioRecord,step:number,automaticProof?:unknown){return this.transaction(()=>{if(!this.db.prepare("SELECT 1 FROM continuation_attempts WHERE id=? AND state='running'").get(attemptId))throw Error('生成任务已停止');if(automaticProof)assertAutomaticProof(automaticProof,validateQuestion(value));this.publish(value,audit,audio,'live',step);if(automaticProof){this.db.prepare('INSERT INTO automatic_validations(qid,body) VALUES(?,?)').run((value as Question).id,JSON.stringify(automaticProof));this.accept((value as Question).id);}this.db.prepare('UPDATE continuation_attempts SET qid=? WHERE id=?').run((value as Question).id,attemptId);});}
 publish(value:unknown,audit:unknown,audio:AudioRecord,source:'live'|'test',difficultyStep=0){
  if(!Number.isInteger(difficultyStep)||difficultyStep< -2||difficultyStep>2)throw Error('难度参数无效');
  const input=value as any;const q=validateQuestion(input?.titleZh?input:{...input,titleZh:legacyTitle(input)}),a=validateAudit(audit,q);
  if(!/^[a-zA-Z0-9-]+\.wav$/.test(audio.file)||!/^\w{64}$/.test(audio.sha256)||audio.bytes<44)throw Error('音频记录无效');
  this.db.prepare('INSERT INTO questions(id,body,audit,audio,source,accepted) VALUES(?,?,?,?,?,?)').run(q.id,JSON.stringify(q),JSON.stringify(a),JSON.stringify(audio),source,source==='test'?1:0);
  this.db.prepare('UPDATE questions SET difficulty=? WHERE id=?').run(difficultyStep,q.id);this.db.prepare('INSERT INTO question_titles(qid,title) VALUES(?,?)').run(q.id,q.titleZh);
 }
 accept(id:string){if(!this.get(id))throw Error('题目不存在');this.db.prepare('UPDATE questions SET accepted=1 WHERE id=?').run(id);}
 get(id:string){const r=this.db.prepare('SELECT * FROM questions WHERE id=?').get(id) as Row|undefined;return r?{question:{...JSON.parse(r.body),titleZh:(this.db.prepare('SELECT title FROM question_titles WHERE qid=?').get(id) as Row)?.title} as Question,audit:JSON.parse(r.audit),audio:JSON.parse(r.audio) as AudioRecord,source:r.source,accepted:!!r.accepted}:null;}
 list(){return (this.db.prepare('SELECT id,source FROM questions WHERE accepted=1 ORDER BY rowid DESC').all() as Row[]).map(r=>({id:r.id,source:r.source}));}
 start(qid:string){
  return this.transaction(()=>{if(!this.get(qid)?.accepted)throw Error('题目尚未完成审核');
   const existing=this.db.prepare('SELECT id FROM sessions WHERE qid=? AND review_of IS NULL ORDER BY created LIMIT 1').get(qid) as Row|undefined;
   if(existing)return this.session(existing.id);
   const id=randomUUID();this.db.prepare('INSERT INTO sessions(id,qid,created,playback_rate,voice) VALUES(?,?,?,?,?)').run(id,qid,Date.now(),this.settings().defaultPlaybackRate,this.settings().defaultVoice);return this.session(id);
  });
 }
 startReview(originalId:string,request:string){if(typeof request!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(request))throw Error('复习请求格式无效');return this.transaction(()=>{
  const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(originalId) as Row|undefined;if(!row)throw Error('原练习不存在');const root=row.review_of??row.id;const original=this.session(root);if(!original.first||!this.get(original.questionId)?.accepted)throw Error('原题尚无作答记录，无法复习');
  const existing=this.db.prepare('SELECT id FROM sessions WHERE review_of=? AND review_request=?').get(root,request) as Row|undefined;if(existing)return this.session(existing.id);
  const id=randomUUID(),voice=this.get(original.questionId)!.audio.voice??'Serena';this.db.prepare('INSERT INTO sessions(id,qid,created,playback_rate,voice,review_of,review_request) VALUES(?,?,?,?,?,?,?)').run(id,original.questionId,Date.now(),this.settings().defaultPlaybackRate,voice,root,request);return this.session(id);
 });}
 session(id:string){const s=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as Row|undefined;if(!s)throw Error('练习不存在');
  const first=this.answers(s.review_of??id)[0]??null;const assisted=!!s.review_of||!!this.db.prepare("SELECT 1 FROM events WHERE session=? AND (kind IN ('replay','reveal') OR (kind='playback' AND json_extract(body,'$.rate')<1 AND json_extract(body,'$.action') IN ('play','change-playing'))) LIMIT 1").get(id);return {reviewMode:!!s.review_of,reviewOf:s.review_of as string|null,voice:s.voice as Voice,voiceEpoch:s.voice_epoch as number,id:s.id,questionId:s.qid,ended:!!s.ended,first,assisted,playbackRate:s.playback_rate as number,questionDisplay:this.settings().questionDisplay};
 }
 selectSessionVoice(id:string,voice:Voice){if(!['Emilien','Serena','Cherry'].includes(voice))throw Error('Unsupported voice');return this.transaction(()=>{this.session(id);this.db.prepare('UPDATE sessions SET voice=?,voice_epoch=voice_epoch+1 WHERE id=? AND voice<>?').run(voice,id,voice);return this.session(id);});}
 assertVoiceEpoch(id:string,epoch?:number){const s=this.session(id);if((epoch!==undefined||s.voiceEpoch>0)&&(!Number.isInteger(epoch)||epoch!==s.voiceEpoch))throw Error('Audio voice changed; retry current player');}
 answers(id:string){return (this.db.prepare('SELECT body FROM answers WHERE session=? ORDER BY seq').all(id) as Row[]).map(r=>JSON.parse(r.body));}
 playback(id:string,rate:number,action:'select'|'play'|'change-playing',voiceEpoch?:number){
  if(![0.8,1,1.2].includes(rate)||!['select','play','change-playing'].includes(action))throw Error('播放速度参数无效');
  return this.transaction(()=>{this.assertVoiceEpoch(id,voiceEpoch);const s=this.session(id);if(action==='select'&&s.playbackRate===rate)return s;
   if(action!=='play')this.db.prepare('UPDATE sessions SET playback_rate=? WHERE id=?').run(rate,id);
   this.db.prepare("INSERT INTO events(session,kind,created,body) VALUES(?,'playback',?,?)").run(id,Date.now(),JSON.stringify({rate,action,voice:s.voice,voiceEpoch:s.voiceEpoch}));
   return this.session(id);
  });
 }
 playbackMetadata(id:string){const events=(this.db.prepare("SELECT body FROM events WHERE session=? AND kind='playback' ORDER BY seq").all(id) as Row[]).map(r=>JSON.parse(r.body)).filter(e=>e.action==='play'||e.action==='change-playing');return {ratesUsed:[...new Set(events.map(e=>e.rate as number))],rateAtSubmission:this.session(id).playbackRate,voicesUsed:[...new Set(events.map(e=>e.voice??'Serena'))],voiceAtSubmission:this.session(id).voice};}

 event(id:string,kind:'ended'|'replay'|'reveal',voiceEpoch?:number){
  return this.transaction(()=>{
   if(kind==='ended'||kind==='replay')this.assertVoiceEpoch(id,voiceEpoch);const s=this.session(id);if(!['ended','replay','reveal'].includes(kind))throw Error('事件无效');
   if(kind==='reveal'&&!s.ended)throw Error('请先完整听完');
   this.db.prepare('INSERT INTO events(session,kind,created) VALUES(?,?,?)').run(id,kind,Date.now());
   if(kind==='ended')this.db.prepare('UPDATE sessions SET ended=1 WHERE id=?').run(id);
   return this.session(id);
  });
 }
 question(id:string){const s=this.session(id);if(!s.ended&&s.questionDisplay!=='immediate')throw Error('请先听完音频');if(!s.ended&&!this.db.prepare("SELECT 1 FROM events WHERE session=? AND kind='question-preview'").get(id))this.db.prepare("INSERT INTO events(session,kind,created) VALUES(?,'question-preview',?)").run(id,Date.now());return publicQuestion(this.get(s.questionId)!.question);}
 answer(id:string,choice:Choice,request:string){
  if(![...IDS,'not-heard'].includes(choice)||typeof request!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(request))throw Error('答案格式无效');
  return this.transaction(()=>{
   const s=this.session(id);if(!s.ended)throw Error('请先完整听完');
   const previous=this.db.prepare('SELECT choice,body FROM answers WHERE session=? AND request=?').get(id,request) as Row|undefined;
   if(previous){if(previous.choice!==choice)throw Error('重复提交内容不同');return this.feedback(id);}
   const history=this.answers(id);
   const helped=s.assisted;
   if(history.length&&!helped)throw Error('首答已经保存，请使用复习');
   const q=this.get(s.questionId)!.question;
   const answer={choice,result:choice==='not-heard'?'not-heard':choice===q.correctOptionId?'correct':'wrong',correct:choice==='not-heard'?null:choice===q.correctOptionId,assisted:helped||history.length>0,...(s.reviewMode?{reviewMode:true}:{}),at:Date.now(),playback:this.playbackMetadata(id),presentationMode:this.db.prepare("SELECT 1 FROM events WHERE session=? AND kind='question-preview'").get(id)?'immediate':s.questionDisplay};
   this.db.prepare('INSERT INTO answers(session,request,choice,body) VALUES(?,?,?,?)').run(id,request,choice,JSON.stringify(answer));
   if(!history.length&&!s.reviewMode)this.observeFirst(s.questionId,answer);
   return this.feedback(id);
  });
 }
 feedback(id:string){
  const s=this.session(id),answers=this.answers(id);
  const reveal=this.db.prepare("SELECT 1 FROM events WHERE session=? AND kind='reveal' LIMIT 1").get(id);
  if(!answers.length&&!reveal)throw Error('请先作答或主动查看解析');
  return {first:s.first,latest:answers.at(-1)??null,question:this.get(s.questionId)!.question,events:this.db.prepare('SELECT kind,created FROM events WHERE session=? ORDER BY seq').all(id)};
 }
 review(){
  return (this.db.prepare('SELECT id,qid FROM sessions WHERE review_of IS NULL ORDER BY created DESC').all() as Row[]).flatMap(s=>{
   const original=this.answers(s.id),first=original[0];if(!first)return[];
   const practiced=(this.db.prepare('SELECT a.body FROM answers a JOIN sessions child ON child.id=a.session WHERE child.review_of=? ORDER BY a.seq').all(s.id) as Row[]).map(r=>JSON.parse(r.body));
   const hasWrong=[...original,...practiced].some(a=>a.correct===false);if(!hasWrong&&first.correct===true&&!first.assisted)return[];
   const latestReview=practiced.at(-1)??null,category=hasWrong?'wrong' as const:first.result==='not-heard'?'not-heard' as const:'assisted' as const;
   return[{sessionId:s.id,questionId:s.qid,titleZh:this.get(s.qid)!.question.titleZh,first,category,resolved:latestReview?.correct===true,practiceCount:practiced.length,latestReview}];
  });
 }
 budget(){const rows=this.db.prepare('SELECT provider,cost FROM reservations').all() as Row[];return {limit:this.ttsAuthorization().ceiling===100?null:5,reserved:Math.round(rows.reduce((n,r)=>n+r.cost,0)*1e6)/1e6,calls:rows.length};}
 assertRevisionCapacity(){
  const deepseek=(this.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE provider='deepseek'").get() as Row).n;
  const tts=(this.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE provider='tts'").get() as Row).n;
  if(deepseek!==3||tts!==1||this.budget().reserved+0.36>5)throw Error('剩余预算或调用次数不足以完成最后一次修订审核');
 }
 assertPipelineCapacity(){
  const deepseek=(this.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE provider='deepseek'").get() as Row).n;
  const tts=(this.db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE provider='tts'").get() as Row).n;
  if(deepseek+3>4||tts+1>2||this.budget().reserved+0.82>5)throw Error('剩余预算或调用次数不足以完成完整三阶段审核，停止，不再生成');
 }
 reserve(provider:'deepseek'|'tts',cost:number){
  return this.transaction(()=>{
   if(!['deepseek','tts'].includes(provider)||!Number.isFinite(cost)||cost<=0||cost>5)throw Error('预算预留无效');
   const count=(this.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE provider=?').get(provider) as Row).n;
   if(count>=(provider==='deepseek'?4:2)||this.budget().reserved+cost>5+1e-9)throw Error('本轮预算或调用次数已用尽');
   this.db.prepare('INSERT INTO reservations(provider,cost,created) VALUES(?,?,?)').run(provider,cost,Date.now());return this.budget();
  });
 }
}
