import {CloudRepository} from './repository.ts';
import {normalizeWriterEvidence,type CloudPipelineJob} from './pipeline.ts';
import {validateQuestion,validateAudit} from '../../shared/question.ts';
import {checkAnswerShape} from '../item-shape.ts';
import {validateCritic} from '../quality-critic.ts';
import {validateClaimCoverage,completeEvidence} from '../claim-coverage.ts';
import type {CloudDoc} from './state.ts';

type Artifacts={get(key:string):Promise<Uint8Array|null>};
function eligible(doc:CloudDoc,id:string,nextId=id){return doc.next?.id===nextId&&!doc.next.result&&doc.next.state!=='ready'&&doc.pipelines[nextId]?.status==='failed'&&doc.pipelines[id]?.status==='failed'&&doc.nextJobs[id]?.origin===doc.next.origin&&!(doc.leases['pipeline:'+id]?.until>Date.now())&&!(doc.leases['pipeline:'+nextId]?.until>Date.now());}
async function readStage(artifacts:Artifacts,key:string){
 const bytes=await artifacts.get(key+'/response');if(!bytes)return null;
 try{const envelope=JSON.parse(new TextDecoder().decode(bytes));if(typeof envelope.status!=='number'||envelope.status<200||envelope.status>=300)return null;
  const body=JSON.parse(envelope.body),choice=body.choices?.[0];if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')return null;return JSON.parse(choice.message.content);
 }catch{return null;}
}
/** Explicit retry recovery only: reuse paid validations, then require a new full audit before audio. */
export async function resumeSavedCoverage(repo:CloudRepository,artifacts:Artifacts,jobId:string):Promise<boolean>{
 const doc=(await repo.read()).body;if(!eligible(doc,jobId))return false;
 const candidates=[jobId,...Object.keys(doc.pipelines).filter(id=>id!==jobId&&doc.pipelines[id]?.status==='failed')];
 for(const candidate of candidates)if(await resumeCandidate(repo,artifacts,candidate,jobId))return true;
 return false;
}
async function resumeCandidate(repo:CloudRepository,artifacts:Artifacts,jobId:string,nextId:string):Promise<boolean>{
 if(!/^[a-f0-9-]{36}$/.test(jobId))return false;
 const initial=(await repo.read()).body;if(!eligible(initial,jobId,nextId))return false;
 const old=initial.pipelines[jobId] as CloudPipelineJob,fingerprint=JSON.stringify(old);
 for(const cycle of [2,1,0] as const){
  const base=`pipeline/${jobId}/${cycle}/`,auditKey=base+'audit';
  const priorAudit=await readStage(artifacts,auditKey),clarificationKey=base+'audit-clarification';
  // A contradictory final boolean gets one new full review, never an inferred approval.
  let clarification=false;
  if(priorAudit?.approved===false&&old.question){try{validateAudit({...priorAudit,approved:true},old.question);clarification=true;}catch{}}
  if(clarification){if(initial.budget.reservations[clarificationKey]||await artifacts.get(clarificationKey+'/response')||[...old.history,old.operation].some(op=>op&&(['tts','download','audit-clarification'].some(stage=>op.key===base+stage))))continue;}
  else if(initial.budget.reservations[auditKey]||[...old.history,old.operation].some(op=>op&&['audit','tts','download'].some(stage=>op.key===base+stage))||await artifacts.get(auditKey+'/response'))continue;
  const [writer,critic,coverage]=await Promise.all(['writer','critic','coverage'].map(stage=>readStage(artifacts,base+stage)));
  if(!writer||!critic)continue;
  if(!coverage&&(initial.budget.reservations[base+'coverage']||[...old.history,old.operation].some(op=>op?.key===base+'coverage')))continue;
  const restored=structuredClone(old);restored.cycle=cycle;delete restored.evidenceNormalizations;
  try{
   const q=validateQuestion(normalizeWriterEvidence(writer,restored));checkAnswerShape(q);q.id='tef-'+jobId;
   restored.critic=validateCritic(critic,q,true);
   if(coverage){restored.coverage=validateClaimCoverage(coverage,q);q.options.find(o=>o.id===q.correctOptionId)!.evidence=completeEvidence(q,restored.coverage);}else delete restored.coverage;
   restored.question=validateQuestion(q);restored.draft=writer;
  }catch{continue;}
  const normalized=restored.evidenceNormalizations??[],previous=structuredClone(old);delete previous.resumeHistory;
  restored.evidenceNormalizations=[...(old.evidenceNormalizations??[])];for(const row of normalized)if(!restored.evidenceNormalizations.some(r=>JSON.stringify(r)===JSON.stringify(row)))restored.evidenceNormalizations.push(row);
  restored.resumeHistory=[...(old.resumeHistory??[]),{at:new Date().toISOString(),sourceCycle:cycle,previous}];
  restored.stage=coverage?'audit':'coverage';restored.status='pending';restored.model='deepseek-v4-pro';
  if(clarification)restored.auditClarification=priorAudit;else delete restored.auditClarification;
  delete restored.operation;delete restored.audit;delete restored.automaticValidation;delete restored.failure;delete restored.audio;delete restored.ttsResponse;
  const committed=await repo.update(doc=>{
   if(!eligible(doc,jobId,nextId)||JSON.stringify(doc.pipelines[jobId])!==fingerprint)return false;
   doc.pipelines[jobId]=structuredClone(restored);doc.next!.id=jobId;doc.next!.state='preparing';doc.next!.error=null;
   if(doc.nextJobs[jobId])Object.assign(doc.nextJobs[jobId],{state:'preparing',error:null});return true;
  });return committed.value;
 }
 return false;
}
