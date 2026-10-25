import type {CloudDoc} from './state.ts';
export interface Snapshot {revision:number;body:CloudDoc}
export interface StateBackend {read():Promise<Snapshot>;cas(revision:number,body:CloudDoc):Promise<{committed:boolean;revision:number}>}
export class CloudRepository {
 backend:StateBackend;
 constructor(backend:StateBackend){this.backend=backend;}
 async update<T>(change:(doc:CloudDoc)=>T):Promise<{value:T;revision:number}>{
  for(let i=0;i<8;i++){const snapshot=await this.backend.read(),doc=structuredClone(snapshot.body),value=change(doc);const saved=await this.backend.cas(snapshot.revision,doc);if(saved.committed)return {value,revision:saved.revision};}
  throw Error('另一台设备正在同步，请稍后重试；未覆盖现有记录');
 }
 async read(){return this.backend.read();}
}
export function createRpcBackend(url:string,key:string,hash:string,request:typeof fetch=fetch):StateBackend{
 async function rpc(name:string,body:unknown){const r=await request(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('云端状态访问失败（'+r.status+'）');return r.json();}
 return {read:()=>rpc('tef_read',{p_hash:hash}),cas:(revision,body)=>rpc('tef_cas',{p_hash:hash,p_expected:revision,p_body:body})};
}
