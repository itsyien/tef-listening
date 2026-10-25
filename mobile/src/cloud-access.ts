// The access code is a private bearer credential; browser storage is readable by this origin.
export interface DeviceStorage {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>}
export function createCloudAccess(base:string,storage:DeviceStorage,request:typeof fetch=fetch){
 const scope=encodeURIComponent(base.replace(/\/$/,'')),credentialKey='tef-private-access-v1:'+scope,deviceKey='tef-device-v1';
 let code='',deviceId='',loaded:Promise<void>|undefined;const listeners=new Set<()=>void>();
 const notify=()=>listeners.forEach(listener=>listener());
 function initialize(){return loaded??= (async()=>{deviceId=await storage.getItem(deviceKey)??'';if(!deviceId){deviceId=globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return(c==='x'?n:(n&3)|8).toString(16);});await storage.setItem(deviceKey,deviceId);}code=await storage.getItem(credentialKey)??'';})();}
 function headers(){if(!base.startsWith('https://'))throw Error('云端服务必须使用 HTTPS。');if(!code||!deviceId)throw Error('请先输入私人访问码。');return {Authorization:'Bearer '+code,'X-TEF-Device':deviceId};}
 async function lock(){code='';notify();await storage.removeItem(credentialKey);}
 async function response(path:string,body?:unknown){
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('://'))throw Error('无效的服务路径。');
  const result=await request(base+path,{method:body===undefined?'GET':'POST',headers:{...headers(),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(result.status===401){await lock();throw Error('访问码无效或已更换，请重新输入。');}return result;
 }
 async function unlock(value:string){await initialize();const candidate=value.trim();if(!candidate)throw Error('请输入私人访问码。');
  if(!base.startsWith('https://'))throw Error('云端服务必须使用 HTTPS。');
  const result=await request(base+'/access',{method:'POST',headers:{Authorization:'Bearer '+candidate,'X-TEF-Device':deviceId,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(12000)});
  if(!result.ok){if(result.status===401)await lock();throw Error(result.status===401?'访问码无效或已更换，请重新输入。':'暂时无法连接，请稍后重试。');}
  await storage.setItem(credentialKey,candidate);code=candidate;notify();
 }
 return {initialize,headers,response,unlock,lock,isUnlocked:()=>!!code,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},sessionKey:(key:string)=>key+':cloud:'+scope+':'+deviceId};
}
