import{CloudState,type Voice}from'./state.ts';
import{CloudRepository}from'./repository.ts';
import{cloudBudget}from'./budget.ts';
import{advancePipeline,type PipelineDeps,type CloudPipelineJob}from'./pipeline.ts';
import{runTranslation,runVoice}from'./extras.ts';
export interface WorkDeps extends Omit<PipelineDeps,'save'|'budget'> {repo:CloudRepository}
/** A fenced lease covers one external operation, never an entire multi-minute pipeline. */
export async function runCloudWork(d:WorkDeps):Promise<boolean>{
 // Keep rejected verdicts inspectable by the private operator without exposing transcripts through client DTOs.
 const before=await d.repo.read();const rejected=Object.entries(before.body.pipelines).find(([,p])=>p.status==='failed'&&p.failure&&!p.rejectedReview);
 if(rejected){const [jobId,p]=rejected,key=`pipeline/${jobId}/${p.cycle}/${p.failure.stage}/response`;const raw=await d.artifacts.get(key);let verdict:unknown={unavailable:true};try{if(raw){const envelope=JSON.parse(new TextDecoder().decode(raw)),result=JSON.parse(envelope.body);verdict=JSON.parse(result.choices[0].message.content);}}catch{}await d.repo.update(doc=>{const current=doc.pipelines[jobId];if(current?.status==='failed'&&!current.rejectedReview&&current.cycle===p.cycle&&current.failure?.stage===p.failure.stage)current.rejectedReview={stage:p.failure.stage,cycle:p.cycle,verdict};});}
 const now=()=>Date.now(),token=crypto.randomUUID();
 const claimed=await d.repo.update(doc=>{
  const n=doc.next,p=n&&doc.pipelines[n.id];
  const translation=Object.entries(doc.translations).find(([,j])=>['pending','inflight'].includes(j.status)),voice=Object.entries(doc.voiceJobs).find(([,j])=>j.status==='preparing');
  const choice=p&&['pending','inflight','ready'].includes(p.status)&&n!.state!=='ready'?{kind:'pipeline',id:n!.id}:translation?{kind:'translation',id:translation[0]}:voice?{kind:'voice',id:voice[0]}:p?.status==='uncertain'?{kind:'pipeline',id:n!.id}:null;
  if(!choice)return null;const key=choice.kind+':'+choice.id;if(doc.leases[key]?.until>now())return null;doc.leases[key]={token,until:now()+120000};return{leaseKey:key,kind:choice.kind,id:choice.id};
 });
 if(!claimed.value)return false;
 const {leaseKey,kind,id}=claimed.value;
 const assertLease=(doc:any)=>{if(doc.leases[leaseKey]?.token!==token||doc.leases[leaseKey]?.until<=now())throw Error('任务租约已变化，停止重复请求');};
 const fenced=new CloudRepository({read:async()=>{const snap=await d.repo.read();assertLease(snap.body);return snap;},cas:async(revision,body)=>{assertLease(body);return d.repo.backend.cas(revision,body);}});
 const budget=cloudBudget(fenced),deps={...d,repo:fenced,budget};let more=false;
 try{
  if(kind==='translation')await runTranslation(id,deps);
  else if(kind==='voice')await runVoice(id,deps);
  else{
   const job=structuredClone((await fenced.read()).body.pipelines[id]) as CloudPipelineJob;
   const result=await advancePipeline(job,{...deps,save:async job=>{await fenced.update(doc=>{doc.pipelines[id]=structuredClone(job);});}});
   await fenced.update(doc=>{if(doc.next?.id!==id)return;
    if(result.status==='ready'){
     if(!result.question||!result.audit||!result.audio)throw Error('音频或审核证据尚未保存');
     const state=new CloudState(doc,'cloud-worker-private');if(!doc.questions[result.question.id])state.publish(result.question,result.audit,{file:result.audio.key,sha256:result.audio.sha256,bytes:result.audio.bytes,voice:result.voice as Voice},Number(result.profile.step??0),'live');state.finishNext(id,result.question.id);
    }else if(result.status==='failed'||result.status==='uncertain'){
     doc.next.state=result.status==='failed'&&['writer','critic','coverage','audit'].includes(result.failure?.stage??'')?'retryable-quality':'failed';doc.next.error=result.status==='uncertain'?'上次服务调用结果未知，已停止重复付费，请联系维护者':doc.next.state==='retryable-quality'?'题目审核未通过，可重新生成':'服务准备失败，请稍后重试';Object.assign(doc.nextJobs[id]!,{state:doc.next.state,error:doc.next.error});
    }
   });
  }
  const doc=(await fenced.read()).body;
  more=Object.values(doc.translations).some(j=>j.status==='pending')||Object.values(doc.voiceJobs).some(j=>j.status==='preparing'&&j.pipeline?.status==='pending')||!!(doc.next&&doc.pipelines[doc.next.id]?.status==='pending');
 }finally{await d.repo.update(doc=>{if(doc.leases[leaseKey]?.token===token)delete doc.leases[leaseKey];});}
 return more;
}
