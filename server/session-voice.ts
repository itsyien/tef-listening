import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store,type AudioRecord} from './store.ts';
import {VOICES,voiceCacheFile,type Voice} from './voice-audition.ts';
import {validateWav} from './providers.ts';

export interface VoiceStatus {
 voice:Voice;
 voiceEpoch:number;
 state:'ready'|'missing'|'preparing'|'failed'|'busy';
 audioPath:string|null;
 error:string|null;
}
type Job={qid:string;voice:Voice;cache_key:string;state:'preparing'|'ready'|'failed';owner:number;error:string|null};
type Worker=(questionId:string,voice:Voice)=>Promise<AudioRecord>;
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function validVoice(voice:Voice){if(!VOICES.includes(voice))throw Error('不支持的声音');}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e:any){return e.code!=='ESRCH';}}

/** Current-question audio only. Reads and selections never start paid work. */
export class SessionVoices {
 private store:Store;
 private dataDir:string;
 private worker:Worker|undefined;
 constructor(store:Store,dataDir:string,worker?:Worker){
  this.store=store;this.dataDir=dataDir;this.worker=worker;
  store.db.exec(`CREATE TABLE IF NOT EXISTS session_voice_jobs(
   qid TEXT NOT NULL REFERENCES questions(id),voice TEXT NOT NULL,cache_key TEXT NOT NULL,
   state TEXT NOT NULL,owner INTEGER NOT NULL,error TEXT,
   PRIMARY KEY(qid,voice,cache_key));
   CREATE UNIQUE INDEX IF NOT EXISTS session_voice_one_running ON session_voice_jobs(qid) WHERE state='preparing';`);
 }
 async cached(questionId:string,voice:Voice):Promise<AudioRecord|null>{
  validVoice(voice);
  const source=this.store.get(questionId);if(!source?.accepted)return null;
  const file=voiceCacheFile(source.question.script,voice);
  const exact=await this.read(file);if(exact)return exact;
  const legacy=source.audio as AudioRecord&{voice?:Voice};
  if((legacy.voice??'Serena')!==voice||!/^[a-zA-Z0-9-]+\.wav$/.test(legacy.file))return null;
  const base=await this.read(legacy.file);
  return base&&base.sha256===legacy.sha256&&base.bytes===legacy.bytes?base:null;
 }
 private async read(file:string):Promise<AudioRecord|null>{
  try{const b=await readFile(join(this.dataDir,'audio',file));validateWav(b);return{file,sha256:digest(b),bytes:b.length};}
  catch(e:any){if(e.code==='ENOENT'||e.code===undefined)return null;throw e;}
 }
 private recoverOrphans(questionId:string){
  const jobs=this.store.db.prepare("SELECT * FROM session_voice_jobs WHERE qid=? AND state='preparing'").all(questionId) as unknown as Job[];
  for(const job of jobs)if(!alive(job.owner))this.store.db.prepare("UPDATE session_voice_jobs SET state='failed',error=? WHERE qid=? AND voice=? AND cache_key=? AND state='preparing'").run('语音准备已中断，不会自动重试。',job.qid,job.voice,job.cache_key);
 }
 async status(sessionId:string):Promise<VoiceStatus>{
  const s=this.store.session(sessionId),base={voice:s.voice,voiceEpoch:s.voiceEpoch,audioPath:null,error:null};
  const source=this.store.get(s.questionId);
  if(!source?.accepted)return{...base,state:'failed',error:'这道题尚未通过审核，无法准备语音。'};
  if(await this.cached(s.questionId,s.voice))return{...base,state:'ready',audioPath:'/audio/'+encodeURIComponent(s.questionId)+'?voice='+s.voice};
  this.recoverOrphans(s.questionId);
  const job=this.store.db.prepare('SELECT * FROM session_voice_jobs WHERE qid=? AND voice=? AND cache_key=?').get(s.questionId,s.voice,voiceCacheFile(source.question.script,s.voice)) as Job|undefined;
  if(job?.state==='failed')return{...base,state:'failed',error:job.error};
  if(job?.state==='preparing')return{...base,state:'preparing'};
  const running=this.store.db.prepare("SELECT 1 FROM session_voice_jobs WHERE qid=? AND state='preparing'").get(s.questionId);
  if(running)return{...base,state:'busy',error:'这道题的另一种声音正在准备。完成后请再次播放所选声音。'};
  if(job?.state==='ready')return{...base,state:'failed',error:'已准备的音频暂不可用，不会自动重试。'};
  return{...base,state:'missing'};
 }
 async select(sessionId:string,voice:Voice):Promise<VoiceStatus>{
  validVoice(voice);const s=this.store.session(sessionId);if(s.reviewMode&&!await this.cached(s.questionId,voice))return this.status(sessionId);this.store.selectSessionVoice(sessionId,voice);return this.status(sessionId);
 }
 async prepare(sessionId:string,voice:Voice,voiceEpoch:number):Promise<VoiceStatus>{
  validVoice(voice);
  const initial=this.store.session(sessionId);
  if(initial.voice!==voice||initial.voiceEpoch!==voiceEpoch)return{...await this.status(sessionId),error:'所选声音已更改，请播放当前声音来准备音频。'};
  const current=await this.status(sessionId);
  if(current.state!=='missing')return current;
  if(initial.reviewMode)return{...current,state:'failed',error:'复习只使用已保存的音频，当前音频暂不可用。'};
  if(!this.worker)return{...current,state:'failed',error:'语音准备服务尚未配置，请配置后再试。'};
  // The transaction rechecks the snapshot after asynchronous cache reads. A
  // unique partial index enforces one running variant across processes too.
  const claimed=this.store.transaction(()=>{
   const s=this.store.session(sessionId);
   if(s.voice!==voice||s.voiceEpoch!==voiceEpoch)return false;
   const source=this.store.get(s.questionId);if(!source?.accepted)return false;
   this.recoverOrphans(s.questionId);
   const key=voiceCacheFile(source.question.script,voice);
   if(this.store.db.prepare('SELECT 1 FROM session_voice_jobs WHERE qid=? AND voice=? AND cache_key=?').get(s.questionId,voice,key))return false;
   if(this.store.db.prepare("SELECT 1 FROM session_voice_jobs WHERE qid=? AND state='preparing'").get(s.questionId))return false;
   this.store.db.prepare("INSERT INTO session_voice_jobs(qid,voice,cache_key,state,owner,error) VALUES(?,?,?,'preparing',?,NULL)").run(s.questionId,voice,key,process.pid);
   return{qid:s.questionId,key};
  });
  if(claimed)void this.run(claimed.qid,voice,claimed.key);
  return this.status(sessionId);
 }
 private async run(qid:string,voice:Voice,key:string){
  let state:'ready'|'failed'='failed',error:string|null=null;
  try{
   await this.worker!(qid,voice);
   if(await this.cached(qid,voice))state='ready';
   else error='语音准备未保存有效音频，不会自动重试。';
  }catch{error='语音准备失败，不会自动重试。';}
  // No session, answer, content queue, preference, or ledger writes here.
  this.store.db.prepare("UPDATE session_voice_jobs SET state=?,error=? WHERE qid=? AND voice=? AND cache_key=? AND state='preparing' AND owner=?").run(state,error,qid,voice,key,process.pid);
 }
}

