import {Store} from './store.ts';import{PreAudioReviewRequired,ContentQualityError}from'./providers.ts';
export class NextJobs {
 private active=new Set<string>();
 private store:Store;private worker?:{generate:(attempt:any)=>Promise<string>};
 constructor(store:Store,worker?:{generate:(attempt:any)=>Promise<string>}){this.store=store;this.worker=worker;}
 status(session:string){return this.store.nextJobStatus(session);}
 ensure(session:string){const job=this.store.ensureNextJob(session);if(!job.jobId)return job;this.run(job.jobId);return this.status(session);}
 afterFirst(session:string,eligible:boolean){if(eligible)this.ensure(session);}
 retry(session:string){const job=this.store.retryNextJob(session);if(!job.jobId)return job;this.run(job.jobId);return this.status(session);}
 private run(id:string){if(this.active.has(id)||!this.worker)return;this.active.add(id);void this.work(id).finally(()=>this.active.delete(id));}
 private async work(id:string){while(true){const attempt=this.store.claimNextJob(id);if(!attempt)return;try{const qid=await this.worker!.generate(attempt);if(!this.store.get(qid))throw Error('Generated question was not saved');this.store.finishNextJob(id,qid,attempt.id);return;}catch(e){if(e instanceof ContentQualityError){if(this.store.recoverRejected(id,attempt.id,e.message))continue;return;}if(e instanceof PreAudioReviewRequired){this.store.pauseNextBeforeAudio(id,attempt.id,e.runId);return;}this.store.failNextJob(id,e instanceof Error?e.message:'Generation failed',attempt.id);return;}}}
}
