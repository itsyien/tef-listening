import {CloudState,type Voice} from './state.ts';
import {CloudRepository} from './repository.ts';
import {createPipelineJob} from './pipeline.ts';
import {translationStatus,requestTranslation,voiceStatus,requestVoice} from './extras.ts';
interface Config {authorize:(hash:string,peer:string)=>Promise<{allowed:boolean;status:number}>;repository:(hash:string)=>CloudRepository;artifacts:{get:(key:string)=>Promise<Uint8Array|null>};configured:boolean;kick:(hash:string,code:string,device:string)=>void;resume?:(repo:CloudRepository,id:string)=>Promise<boolean>}
export async function sha256(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');}
export function createCloudApi(config:Config){return async(request:Request):Promise<Response>=>{
 const origin=request.headers.get('origin'),headers:Record<string,string>={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 const send=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
 if(origin&&!['https://itsyien.github.io','http://localhost:8090','http://127.0.0.1:8090'].includes(origin))return send(403,{error:'不允许此网页访问'});
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-TEF-Device,Range','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges,ETag'}});
 const auth=request.headers.get('authorization')??'',code=auth.startsWith('Bearer ')?auth.slice(7):'',hash=await sha256(code),device=request.headers.get('x-tef-device')??'';
 try{
  const gate=await config.authorize(hash,await sha256(request.headers.get('x-forwarded-for')??'unknown'));
  if(!gate.allowed)return send(gate.status,{error:gate.status===429?'请求较多，请稍后重试':gate.status===503?'云端暂时不可用，请稍后重试':'访问码无效或已更换'});
  if(!/^[a-zA-Z0-9-]{16,100}$/.test(device))return send(400,{error:'设备标识无效'});
  const repo=config.repository(hash),url=new URL(request.url),path=url.pathname.replace(/^(?:\/functions\/v1)?\/tef-api(?=\/|$)/,'')||'/';
  let body:any;
  if(request.method==='POST'){if(!request.headers.get('content-type')?.startsWith('application/json'))return send(415,{error:'需要 JSON 请求'});const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;try{if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096)return send(413,{error:'请求过大'});chunks.push(part.value);}}finally{await reader?.cancel().catch(()=>{});}const raw=new Uint8Array(size);let offset=0;for(const part of chunks){raw.set(part,offset);offset+=part.length;}body=JSON.parse(new TextDecoder().decode(raw));}
  const mutate=async<T>(change:(state:CloudState)=>T)=>{const saved=await repo.update(d=>change(new CloudState(d,device)));return saved.value;};
  const queue=(s:CloudState,id:string)=>{const status=s.ensureNext(id);if(status.jobId){const n=s.doc.next!;if(!config.configured){n.state='waiting-configuration';s.doc.nextJobs[n.id]!.state=n.state;n.error='后端生成服务尚未配置';}else{if(n.state==='waiting-configuration'){n.state='preparing';n.error=null;}if(!s.doc.pipelines[n.id])s.doc.pipelines[n.id]=createPipelineJob(n.id,s.settings().defaultVoice,{...s.settings().generationProfile});}}return s.nextStatus(id);};
  const kick=()=>{if(config.configured)config.kick(hash,code,device);};
  if(path==='/work'&&request.method==='POST'){kick();return send(202,{accepted:config.configured});}
  if(path==='/access'&&request.method==='POST')return send(200,{authorized:true});
  if(path==='/sync'&&request.method==='GET'){const snap=await repo.read();kick();return send(200,{revision:snap.revision,currentQuestionId:snap.body.currentQuestionId,settings:new CloudState(snap.body,device).settings(),pipelineConfigured:config.configured});}
  if(path==='/health'&&request.method==='GET'){const snap=await repo.read(),s=new CloudState(snap.body,device);return send(200,{readyCount:s.list().length,mode:'live',reviewCount:s.review().length,pipelineConfigured:config.configured});}
  if(path==='/settings'){if(request.method==='POST')return send(200,await mutate(s=>s.setSettings(body)));if(request.method==='GET')return send(200,new CloudState((await repo.read()).body,device).settings());}
  if(path==='/catalog'&&request.method==='GET')return send(200,new CloudState((await repo.read()).body,device).list());
  if(path==='/review'&&request.method==='GET')return send(200,new CloudState((await repo.read()).body,device).review());
  if(path==='/next'&&request.method==='GET'){kick();return send(200,{next:new CloudState((await repo.read()).body,device).nextQuestion(url.searchParams.get('exclude')??'')});}
  if(path==='/bootstrap'&&request.method==='POST'){
   if(!config.configured)return send(409,{error:'后端生成服务尚未配置，未调用付费 API'});
   if(body.retry===true&&config.resume){const snap=await repo.read(),n=snap.body.next;if(!snap.body.currentQuestionId&&n&&['failed','retryable-quality'].includes(n.state))await config.resume(repo,n.id);}
   const result=await mutate(s=>{if(s.doc.currentQuestionId)return {state:'existing',questionId:s.doc.currentQuestionId};if(body.retry===true&&s.doc.next&&['failed','retryable-quality'].includes(s.doc.next.state)){if(s.doc.pipelines[s.doc.next.id]?.status==='uncertain')throw Error('上次调用结果未知，停止重复付费，请联系维护者');s.doc.next=null;}if(!s.doc.next){const id=crypto.randomUUID();s.doc.next={id,origin:null,state:'preparing',result:null,error:null};s.doc.nextJobs[id]={origin:null,state:'preparing',result:null,error:null};s.doc.pipelines[id]=createPipelineJob(id,s.settings().defaultVoice,{...s.settings().generationProfile});}return{jobId:s.doc.next.id,state:s.doc.next.state};});kick();return send(202,result);
  }
  if(path==='/sessions'&&request.method==='POST'){const s=await mutate(s=>{const session=s.start(body.questionId);queue(s,session.id);return session;});kick();return send(201,s);}
  if(path==='/review/sessions'&&request.method==='POST')return send(201,await mutate(s=>s.startReview(body.sessionId,body.requestId)));
  const audio=path.match(/^\/audio\/([a-z0-9-]+)$/),audition=path.match(/^\/audition\/audio\/(Emilien|Serena|Cherry)$/);
  if(request.method==='GET'&&(audio||audition)){
   const snap=await repo.read(),qid=audio?.[1]??snap.body.currentQuestionId,record=qid?snap.body.questions[qid]:null,voice=(url.searchParams.get('voice')??audition?.[1]??record?.audio.voice) as Voice,selected=record?.variants[voice];
   if(!selected)return send(404,{error:'所选音频尚未准备；不会自动重新合成'});const bytes=await config.artifacts.get(selected.file);if(!bytes||bytes.length!==selected.bytes||await sha256(bytes)!==selected.sha256)return send(404,{error:'保存的音频不可用，未重复扣费'});
   const audioHeaders={...headers,'Content-Type':'audio/wav','Cache-Control':'private, max-age=31536000, immutable','Accept-Ranges':'bytes','ETag':'"'+selected.sha256+'"','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges,ETag'};const range=request.headers.get('range');
   if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range),start=m?Number(m[1]):-1,end=m?.[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;if(start<0||start>=bytes.length||end<start)return new Response(null,{status:416,headers:{...audioHeaders,'Content-Range':'bytes */'+bytes.length}});return new Response(bytes.slice(start,end+1) as Uint8Array<ArrayBuffer>,{status:206,headers:{...audioHeaders,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});}
   return new Response(bytes as Uint8Array<ArrayBuffer>,{status:200,headers:{...audioHeaders,'Content-Length':String(bytes.length)}});
  }
  const route=path.match(/^\/sessions\/([a-f0-9-]+)(?:\/(question|feedback|events|answers|translation|next|playback|voice))?$/);
  if(route){const [,id,action]=route;const sid=id!;
   if(request.method==='GET'&&!action)return send(200,new CloudState((await repo.read()).body,device).session(sid));
   if(request.method==='GET'&&action==='question')return send(200,await mutate(s=>s.question(sid)));
   if(request.method==='GET'&&action==='feedback')return send(200,new CloudState((await repo.read()).body,device).feedback(sid));
   if(request.method==='POST'&&action==='events')return send(200,await mutate(s=>s.event(sid,body.kind,body.voiceEpoch)));
   if(request.method==='POST'&&action==='playback')return send(200,await mutate(s=>s.playback(sid,body.rate,body.action,body.voiceEpoch)));
   if(request.method==='POST'&&action==='answers')return send(200,await mutate(s=>s.answer(sid,body.choice,body.requestId)));
   if(action==='next'){
    if(request.method==='GET'){kick();return send(200,new CloudState((await repo.read()).body,device).nextStatus(sid));}
    if(request.method==='POST'){if(body.retry===true&&config.resume){const snap=await repo.read(),s=new CloudState(snap.body,device),session=s.session(sid),n=snap.body.next;if(!session.reviewMode&&session.questionId===snap.body.currentQuestionId&&n&&['failed','retryable-quality'].includes(n.state))await config.resume(repo,n.id);}const result=await mutate(s=>{const current=s.nextStatus(sid);if(s.session(sid).questionId!==s.doc.currentQuestionId)return current;if(body.retry===true&&current.jobId&&['failed','retryable-quality'].includes(current.state)){
      const prior=s.doc.pipelines[current.jobId];if(prior?.status==='uncertain')throw Error('上次调用结果未知，已停止重复付费，请联系维护者');const jobId=crypto.randomUUID(),origin=s.session(sid).questionId;s.doc.next={id:jobId,origin,state:'preparing',result:null,error:null};s.doc.nextJobs[jobId]={origin,state:'preparing',result:null,error:null};}
      return queue(s,sid);});kick();return send(200,result);}
   }
   if(action==='voice'){
    if(request.method==='GET'){kick();return send(200,voiceStatus(new CloudState((await repo.read()).body,device),sid));}
    if(request.method==='POST'){const result=await mutate(s=>{if(body.prepare===true)return requestVoice(s,sid,body.voice,body.voiceEpoch,config.configured);s.selectVoice(sid,body.voice);return voiceStatus(s,sid);});kick();return send(200,result);}
   }
   if(action==='translation'){if(request.method==='GET')return send(200,translationStatus(new CloudState((await repo.read()).body,device),sid));if(request.method==='POST'){const result=await mutate(s=>requestTranslation(s,sid,body.retry??false,config.configured));kick();return send(200,result);}}
  }
  return send(404,{error:'页面或请求不存在'});
 }catch(e){return send(409,{error:e instanceof Error?e.message:'请求失败，请重试'});}
};}
