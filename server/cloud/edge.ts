import{createCloudApi,sha256}from'./http.ts';
import{CloudRepository,createRpcBackend}from'./repository.ts';
import{privateArtifacts}from'./storage.ts';
import{runCloudWork}from'./worker.ts';
import{resumeSavedCoverage}from'./resume.ts';
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
declare const EdgeRuntime:{waitUntil(work:Promise<unknown>):void};
const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const artifacts=privateArtifacts(url,serviceKey),repository=(hash:string)=>new CloudRepository(createRpcBackend(url,serviceKey,hash));
async function rpc(name:string,body:unknown){const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Backend configuration unavailable');return r.json();}
Deno.serve(async request=>{
 try{
  const auth=request.headers.get('authorization')??'',code=auth.startsWith('Bearer ')?auth.slice(7):'',hash=await sha256(code);
  if(request.method==='OPTIONS')return createCloudApi({configured:false,artifacts,repository,authorize:async()=>({allowed:false,status:401}),kick:()=>{}})(request);
  const gate=await rpc('tef_gate',{p_hash:hash,p_peer:await sha256(request.headers.get('x-forwarded-for')??'unknown')});
  if(!gate.allowed)return createCloudApi({configured:false,artifacts,repository,authorize:async()=>gate,kick:()=>{}})(request);
  const path=new URL(request.url).pathname.replace(/^(?:\/functions\/v1)?\/tef-api(?=\/|$)/,'');
  if(path==='/configure-providers'&&request.method==='POST'){
   // Sealed one-time operator setup; never returns keys and is not a client feature.
   if(request.headers.get('origin'))return Response.json({error:'Direct authenticated operator setup required'},{status:403});
   const text=await request.text();if(text.length>4096)return Response.json({error:'Configuration too large'},{status:413});
   return Response.json(await rpc('tef_configure_providers',{p_hash:hash,p_values:JSON.parse(text)}),{headers:{'Cache-Control':'no-store'}});
  }
  const runtime=await rpc('tef_provider_runtime',{p_hash:hash}),keys={deepseek:runtime.deepseek as string|undefined,dashscope:runtime.dashscope as string|undefined},pricingDate=runtime.pricingDate as string;
  return createCloudApi({configured:runtime.enabled===true&&!!keys.deepseek&&!!keys.dashscope,artifacts,repository,authorize:async()=>gate,resume:(repo,id)=>resumeSavedCoverage(repo,artifacts,id),kick:(hash,code,device)=>{
   EdgeRuntime.waitUntil(runCloudWork({repo:repository(hash),artifacts,keys,pricingDate,request:fetch}).then(async more=>{
    if(more)await fetch(url+'/functions/v1/tef-api/work',{method:'POST',headers:{Authorization:'Bearer '+code,'X-TEF-Device':device,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   }).catch(()=>{/* Keep durable checkpoints and never repeat an unknown paid outcome blindly. */}));
  }})(request);
 }catch{return Response.json({error:'云端暂时不可用，请稍后重试'},{status:503,headers:{'Cache-Control':'no-store'}});}
});
