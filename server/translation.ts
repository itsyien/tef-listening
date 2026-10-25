import {createHash} from 'node:crypto';import {Store} from './store.ts';
export interface TranslationProvider {available?:()=>boolean;translate:(script:string)=>Promise<string>}
export interface TranslationState {status:'unrequested'|'pending'|'ready'|'error'|'blocked';text?:string;message?:string}
export class TranslationService{
 store:Store;provider:TranslationProvider|undefined;
 constructor(store:Store,provider?:TranslationProvider){this.store=store;this.provider=provider;store.db.exec('CREATE TABLE IF NOT EXISTS translations(cache_key TEXT PRIMARY KEY,script_hash TEXT NOT NULL,language TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,body TEXT,updated INTEGER NOT NULL)');}
 context(sessionId:string){const script=this.store.feedback(sessionId).question.script,scriptHash=createHash('sha256').update(script).digest('hex'),key=createHash('sha256').update(script+'\0zh-CN\0v1').digest('hex');return{script,scriptHash,key};}
 get(sessionId:string):TranslationState{const{key}=this.context(sessionId);return this.read(key);}
 read(key:string):TranslationState{
  const row=this.store.db.prepare('SELECT * FROM translations WHERE cache_key=?').get(key) as any;if(!row)return{status:'unrequested'};
  if(row.status==='ready')return{status:'ready',text:row.body};
  if(row.status==='pending'&&Date.now()-row.updated<90000)return{status:'pending'};
  return{status:'error',message:'翻译失败，请重试。'};
 }
 request(sessionId:string,retry=false):TranslationState{
  const ctx=this.context(sessionId);const state=this.read(ctx.key);if(state.status==='ready'||state.status==='pending'||state.status==='error'&&!retry)return state;
  // Production has no provider until explicit additional-call authorization. Never reset the exhausted ledger.
  if(!this.provider||this.provider.available&&!this.provider.available())return{status:'blocked',message:'翻译调用尚未授权，本次未请求模型。'};
  const claimed=this.store.transaction(()=>{
   const again=this.read(ctx.key);if(again.status==='ready'||again.status==='pending')return false;
   this.store.db.prepare("INSERT INTO translations(cache_key,script_hash,language,version,status,updated) VALUES(?,?,'zh-CN',1,'pending',?) ON CONFLICT(cache_key) DO UPDATE SET status='pending',body=NULL,updated=excluded.updated").run(ctx.key,ctx.scriptHash,Date.now());return true;
  });
  if(claimed)void Promise.resolve().then(()=>this.provider!.translate(ctx.script)).then(text=>{
   if(typeof text!=='string'||text.trim().length<8||text.length>2500||!/[\u3400-\u9fff]/u.test(text))throw Error('Invalid translation');
   this.store.db.prepare("UPDATE translations SET status='ready',body=?,updated=? WHERE cache_key=?").run(text.trim(),Date.now(),ctx.key);
  }).catch(()=>{this.store.db.prepare("UPDATE translations SET status='error',body=NULL,updated=? WHERE cache_key=?").run(Date.now(),ctx.key);});
  return this.read(ctx.key);
 }
}
