import {CloudState,type Voice} from './state.ts';
import {CloudRepository} from './repository.ts';
import {advancePipeline,type CloudPipelineJob,type PipelineDeps} from './pipeline.ts';

export interface ExtraDeps extends Omit<PipelineDeps,'save'> {repo:CloudRepository}
export interface TranslationStatus {status:'unrequested'|'pending'|'ready'|'error'|'blocked';text?:string;message?:string}
export interface VoiceStatus {voice:Voice;voiceEpoch:number;state:'ready'|'missing'|'preparing'|'failed'|'busy';audioPath:string|null;error:string|null}
interface TranslationJob {id:string;script:string;language:'zh-CN';version:1;scriptHash?:string;cacheKey?:string;status:'pending'|'inflight'|'ready'|'error'|'uncertain';attemptId:string;history:any[];text?:string;error?:string;operation?:{key:string;reservationId:string;rawKey?:string;settled?:boolean}}
interface VoiceJob {id:string;qid:string;voice:Voice;script:string;cacheKey?:string;status:'preparing'|'ready'|'failed'|'uncertain';error:string|null;pipeline:CloudPipelineJob}
const encode=(s:string)=>new TextEncoder().encode(s),decode=(b:Uint8Array)=>new TextDecoder().decode(b);
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
function translationJob(state:CloudState,sid:string){
 // Check this device's feedback access before consulting even a shared cache.
 const script=state.feedback(sid).question.script;
 return {script,job:Object.values(state.doc.translations).find((j:TranslationJob)=>j.script===script&&j.language==='zh-CN'&&j.version===1) as TranslationJob|undefined};
}
export function translationStatus(state:CloudState,sid:string):TranslationStatus {
 const {job}=translationJob(state,sid);if(!job)return{status:'unrequested'};
 if(job.status==='ready')return{status:'ready',text:job.text};
 if(job.status==='pending'||job.status==='inflight')return{status:'pending'};
 return{status:'error',message:job.error??'翻译失败，未自动重试。'};
}
/** Synchronous exact-script identity is checked inside CAS; the worker adds canonical SHA-256 keys. */
export function requestTranslation(state:CloudState,sid:string,retry:boolean,configured:boolean):TranslationStatus {
 if(typeof retry!=='boolean')throw Error('翻译重试参数无效');
 const {script,job}=translationJob(state,sid),current=translationStatus(state,sid);
 if(current.status==='ready'||current.status==='pending'||current.status==='error'&&!retry)return current;
 if(!configured)return{status:'blocked',message:'云端翻译服务尚未配置，未调用付费 API。'};
 if(job){if(job.operation)job.history.push(structuredClone(job.operation));job.attemptId=state.uuid();job.status='pending';delete job.operation;delete job.error;delete job.text;}
 else{const id=state.uuid();state.doc.translations[id]={id,script,language:'zh-CN',version:1,status:'pending',attemptId:state.uuid(),history:[]} satisfies TranslationJob;}
 return{status:'pending'};
}
async function readBounded(response:Response,limit:number){
 if(!response.body)throw Error('Provider returned no response body');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Provider response exceeds size limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function runTranslation(id:string,d:ExtraDeps){
 const saved=(await d.repo.read()).body.translations[id] as TranslationJob|undefined;
 if(!saved||saved.status==='ready'||saved.status==='error')return;
 const j=structuredClone(saved),attempt=j.attemptId;
 const save=()=>d.repo.update(doc=>{if(doc.translations[id]?.attemptId!==attempt)throw Error('Translation attempt changed');doc.translations[id]=structuredClone(j);});
 const fail=async(e:unknown,status:'error'|'uncertain'='error')=>{j.status=status;j.error=message(e);await save();};
 j.scriptHash??=await hash(j.script);j.cacheKey??=await hash(j.script+'\0zh-CN\0v1');
 let raw:Uint8Array|null=null;
 if(j.operation){
  raw=await d.artifacts.get(j.operation.key+'/response');
  if(!raw){await fail(Error('翻译请求结果未知，未自动重试；重新请求会保留原调用和预算记录。'),'uncertain');return;}
  j.operation.rawKey=j.operation.key+'/response';
 }else{
  if(j.status==='uncertain')return;
  if(!d.keys.deepseek||!d.pricingDate?.trim()){await fail(Error('Translation credentials or verified deployment pricing metadata are missing; no request made.'));return;}
  const body=JSON.stringify({model:'deepseek-flash',thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1200,messages:[{role:'system',content:'Translate the quoted French transcript faithfully into clear Simplified Chinese. Preserve conditions, negation, dates and who does what. No explanation, invented context or answers. Return json only: {"translationZh":"中文翻译"}.'},{role:'user',content:JSON.stringify({script:j.script})}]}),bytes=encode(body).length;
  if(bytes>6000||[...j.script].length>500){await fail(Error('翻译文本超过限定'));return;}
  const key=`translation/${j.cacheKey}/${j.attemptId}`;
  // The existing translation-provider.ts conservative reservation formula.
  const cost=Math.ceil((((bytes+512)*2/1e6+1200*8/1e6)*2+.03)*1e6)/1e6;
  let reservationId:string;try{reservationId=await d.budget.reserve({key,provider:'deepseek',cost});}catch(e){await fail(e);return;}
  j.operation={key,reservationId};j.status='inflight';await save();
  try{const response=await d.request('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+d.keys.deepseek,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(60000),redirect:'error'});raw=encode(JSON.stringify({status:response.status,body:decode(await readBounded(response,30000))}));}
  catch(e){await fail(e,'uncertain');return;}
  await d.artifacts.put(key+'/response',raw);j.operation.rawKey=key+'/response';await save();
 }
 try{
  const envelope=JSON.parse(decode(raw!)),result=JSON.parse(envelope.body),op=j.operation!;
  if(!op.settled){await d.budget.settle({key:op.key,reservationId:op.reservationId,raw:result});op.settled=true;await save();}
  if(envelope.status<200||envelope.status>=300)throw Error('Translation provider HTTP '+envelope.status);
  const choice=result.choices?.[0];if(choice?.finish_reason!=='stop'||!choice.message?.content)throw Error('翻译返回不完整');
  const value=JSON.parse(choice.message.content);
  if(!value||Object.keys(value).length!==1||typeof value.translationZh!=='string'||value.translationZh.length<8||value.translationZh.length>2500||!/[\u3400-\u9fff]/u.test(value.translationZh))throw Error('翻译格式不合格');
  j.text=value.translationZh.trim();j.status='ready';delete j.error;await save();
 }catch(e){await fail(e);}
}
function voiceContext(state:CloudState,sid:string){const session=state.session(sid),record=state.doc.questions[session.questionId]!;return{session,record};}
export function voiceStatus(state:CloudState,sid:string):VoiceStatus {
 const {session:s,record}=voiceContext(state,sid),base={voice:s.voice,voiceEpoch:s.voiceEpoch,audioPath:null,error:null};
 if(record.variants[s.voice])return{...base,state:'ready',audioPath:`/audio/${s.questionId}?voice=${s.voice}`};
 const jobs=Object.values(state.doc.voiceJobs) as VoiceJob[],job=jobs.find(j=>j.qid===s.questionId&&j.voice===s.voice&&j.script===record.question.script);
 if(job?.status==='preparing')return{...base,state:'preparing'};
 if(job)return{...base,state:'failed',error:job.error??'已准备音频暂不可用，未自动重试。'};
 if(jobs.some(j=>j.qid===s.questionId&&(j.status==='preparing'||j.status==='uncertain')))return{...base,state:'busy',error:'本题另一个声音正在准备或结果未知，请完成恢复后再准备。'};
 return{...base,state:'missing'};
}
/** Only this explicit prepare action creates paid work. Selection remains CloudState.selectVoice. */
export function requestVoice(state:CloudState,sid:string,voice:Voice,epoch:number,configured:boolean):VoiceStatus {
 if(!['Serena','Emilien','Cherry'].includes(voice)||!Number.isInteger(epoch))throw Error('声音准备参数无效');
 const {session:s,record}=voiceContext(state,sid),current=voiceStatus(state,sid);
 if(s.voice!==voice||s.voiceEpoch!==epoch)return{...current,error:'所选声音已更改，请使用当前声音。'};
 if(current.state==='ready')return current;
 if(s.reviewMode)return{...current,state:'failed',error:'复习只使用已保存音频，当前声音暂不可用。'};
 if(current.state!=='missing')return current;
 if(!configured)return{...current,state:'failed',error:'云端声音准备服务尚未配置，未调用付费服务。'};
 const source=Object.values(state.doc.pipelines).find((p:CloudPipelineJob)=>p.status==='ready'&&p.question?.id===s.questionId&&JSON.stringify(p.question)===JSON.stringify(record.question)) as CloudPipelineJob|undefined;
 if(!source?.automaticValidation)return{...current,state:'failed',error:'找不到与已接受题目一致的自动质量证明，未合成声音。'};
 const pipeline=structuredClone(source);pipeline.voice=voice;pipeline.stage='tts';pipeline.status='pending';pipeline.history=[];delete pipeline.operation;delete pipeline.ttsResponse;delete pipeline.audio;delete pipeline.failure;
 const id=state.uuid();state.doc.voiceJobs[id]={id,qid:s.questionId,voice,script:record.question.script,status:'preparing',error:null,pipeline} satisfies VoiceJob;
 return voiceStatus(state,sid);
}
export async function runVoice(id:string,d:ExtraDeps){
 const saved=(await d.repo.read()).body.voiceJobs[id] as VoiceJob|undefined;if(!saved||saved.status==='ready'||saved.status==='failed')return;
 const j=structuredClone(saved),source=(await d.repo.read()).body.questions[j.qid];
 const save=async(p:CloudPipelineJob)=>{j.pipeline=structuredClone(p);j.status=p.status==='uncertain'?'uncertain':p.status==='failed'?'failed':p.status==='ready'?'ready':'preparing';j.error=p.failure?.reason??null;await d.repo.update(doc=>{
  if(!doc.voiceJobs[id])throw Error('Voice preparation job changed');
  if(!doc.questions[j.qid]||JSON.stringify(doc.questions[j.qid]!.question)!==JSON.stringify(p.question))throw Error('Accepted voice source changed');
  doc.voiceJobs[id]=structuredClone(j);
  if(p.status==='ready'&&p.audio){const a=p.audio;doc.questions[j.qid]!.variants[j.voice]={file:`voice/${j.cacheKey}/`+a.key,sha256:a.sha256,bytes:a.bytes,voice:j.voice};}
 });};
 if(!source||source.question.script!==j.script||JSON.stringify(source.question)!==JSON.stringify(j.pipeline.question)){
  j.status='failed';j.error='Only the immutable accepted question can prepare audio';
  await d.repo.update(doc=>{if(!doc.voiceJobs[id])throw Error('Voice preparation job changed');doc.voiceJobs[id]=j;});return;
 }
 j.cacheKey??=await hash(JSON.stringify({script:j.script,model:'qwen3-tts-flash',voice:j.voice,language:'French'}));const prefix=`voice/${j.cacheKey}/`;
 await advancePipeline(j.pipeline,{...d,save,artifacts:{put:(key,b)=>d.artifacts.put(prefix+key,b),get:key=>d.artifacts.get(prefix+key)},budget:{reserve:r=>d.budget.reserve({...r,key:prefix+r.key}),settle:r=>d.budget.settle({...r,key:prefix+r.key})}});
}
