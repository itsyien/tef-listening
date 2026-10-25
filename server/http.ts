import {SessionVoices} from './session-voice.ts';
import {auditionVoice,type Voice} from './voice-audition.ts';
import{serveAudition}from'./audition-http.ts';
import {createServer,type IncomingMessage} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import {Store} from './store.ts';
import {NextJobs} from './next-jobs.ts';import {generateOne} from './providers.ts';
import {deepseekTranslationProvider} from './translation-provider.ts';
import {TranslationService,type TranslationProvider} from './translation.ts';
interface Config {developmentTools?:boolean;store:Store;dataDir:string;origins?:string[];verification?:boolean;translationProvider?:TranslationProvider;voiceWorker?:(qid:string,voice:Voice)=>Promise<import('./store.ts').AudioRecord>;nextWorker?:{generate:(attempt:any)=>Promise<string>}}
async function jsonBody(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('需要JSON请求');let bytes=0;const chunks:Buffer[]=[];for await(const c of req){bytes+=c.length;if(bytes>4096)throw Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
// shortcut: single-learner loopback API; require authenticated access and rate limits before public hosting.
export function createApp({store,dataDir,origins=['http://localhost:8090','http://127.0.0.1:8090','http://localhost:8091','http://127.0.0.1:8091'],verification=false,translationProvider,nextWorker,voiceWorker,developmentTools=process.env.NODE_ENV!=='production'}:Config){
 const jobs=new NextJobs(store,nextWorker);const voices=new SessionVoices(store,dataDir,voiceWorker);
 const translation=new TranslationService(store,translationProvider??(store.translationAllowance().granted?deepseekTranslationProvider(store,{key:process.env.DEEPSEEK_API_KEY,pricingDate:store.translationAllowance().pricingDate}):undefined));
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin,host=req.headers.host??'';
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)||origin&&!origins.includes(origin)){send(403,{error:'只允许本地学习页面访问'});return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return;}
  try{
   const path=new URL(req.url??'/','http://localhost').pathname;
   if((developmentTools||/^\/audition\/audio\/(Emilien|Serena|Cherry)$/.test(path))&&await serveAudition(path,req,res,dataDir,store))return;
   if(req.method==='GET'&&path==='/health'){const list=store.list();send(200,{readyCount:list.length,mode:verification?'verification':list.some(x=>x.source==='test')?'test':'live',reviewCount:store.review().length});return;}
   if(req.method==='GET'&&path==='/settings'){send(200,store.settings());return;}
   if(req.method==='POST'&&path==='/settings'){send(200,store.setSettings(await jsonBody(req)));return;}
   if(req.method==='GET'&&path==='/next'){send(200,{next:store.nextQuestion(new URL(req.url??'/','http://localhost').searchParams.get('exclude')??'')});return;}
   if(req.method==='GET'&&path==='/catalog'){send(200,store.list());return;}
   if(req.method==='POST'&&path==='/review/sessions'){const b=await jsonBody(req);const s=store.startReview(b.sessionId,b.requestId);const voice=store.settings().defaultVoice;if(await voices.cached(s.questionId,voice))await voices.select(s.id,voice);send(201,store.session(s.id));return;}
   if(req.method==='GET'&&path==='/review'){send(200,store.review());return;}
   if(req.method==='POST'&&path==='/sessions'){const b=await jsonBody(req);const s=store.start(b.questionId);store.activatePractice(s.questionId);jobs.ensure(s.id);send(201,s);return;}
   const audio=path.match(/^\/audio\/([a-z0-9-]+)$/);
   if(req.method==='GET'&&audio){
    const item=store.get(audio[1]);if(!item?.accepted){send(404,{error:'音频尚未就绪'});return;}
    const requestedVoice=new URL(req.url??'/','http://localhost').searchParams.get('voice');const record=requestedVoice?await voices.cached(audio[1]!,requestedVoice as Voice):item.audio;if(!record){send(404,{error:'所选音色尚未准备'});return;}let bytes:Buffer;try{bytes=await readFile(join(dataDir,'audio',record.file));}catch{send(404,{error:'音频文件暂不可用，请联系维护者；重播不会重新合成'});return;}
    res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, max-age=31536000, immutable');res.setHeader('ETag','"'+record.sha256+'"');
    const range=req.headers.range;
    if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);const start=m?Number(m[1]):-1,end=m&&m[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;
     if(start<0||start>=bytes.length||end<start){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});res.end();return;}
     res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));return;}
    res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);return;
   }
   const route=path.match(/^\/sessions\/([a-f0-9-]+)(?:\/(question|feedback|events|answers|translation|next|playback|voice))?$/);
   if(route){const [,id,action]=route;
    if(action==='voice'){if(req.method==='GET'){send(200,await voices.status(id!));return;}if(req.method==='POST'){const b=await jsonBody(req);send(200,b.prepare===true?await voices.prepare(id!,b.voice,b.voiceEpoch):await voices.select(id!,b.voice));return;}}
    if(req.method==='POST'&&action==='playback'){const b=await jsonBody(req);send(200,store.playback(id!,b.rate,b.action,b.voiceEpoch));return;}
    if(req.method==='GET'&&action==='next'){send(200,jobs.status(id!));return;}
    if(req.method==='POST'&&action==='next'){const b=await jsonBody(req);send(200,b.retry===true?jobs.retry(id!):jobs.ensure(id!));return;}
    if(req.method==='GET'&&action==='translation'){send(200,translation.get(id!));return;}
    if(req.method==='POST'&&action==='translation'){const b=await jsonBody(req);if(b.retry!==undefined&&typeof b.retry!=='boolean')throw Error('翻译参数无效');send(200,translation.request(id!,b.retry===true));return;}
    if(req.method==='GET'&&!action){send(200,store.session(id!));return;}
    if(req.method==='GET'&&action==='question'){send(200,store.question(id!));return;}
    if(req.method==='GET'&&action==='feedback'){send(200,store.feedback(id!));return;}
    if(req.method==='POST'&&action==='events'){const b=await jsonBody(req);send(200,store.event(id!,b.kind,b.voiceEpoch));return;}
    if(req.method==='POST'&&action==='answers'){const b=await jsonBody(req);send(200,store.answer(id!,b.choice,b.requestId));return;}
   }
   send(404,{error:'页面或操作不存在'});
  }catch(e){send(409,{error:e instanceof Error?e.message:'操作失败，请重试'});}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dataDir=resolve('server/data');await mkdir(dataDir,{recursive:true});const store=new Store(join(dataDir,'learning.sqlite'));store.recoverNextJobs();const server=createApp({store,dataDir,voiceWorker:async(qid,voice)=>(await auditionVoice({store,dir:dataDir,questionId:qid,voice,key:process.env.DASHSCOPE_API_KEY})).audio,nextWorker:{generate:attempt=>generateOne({store,dir:dataDir,ready:true,pricingDate:attempt.pricingDate,keys:{deepseek:process.env.DEEPSEEK_API_KEY,dashscope:process.env.DASHSCOPE_API_KEY},continuationAttempt:attempt,resumeAutomatic:attempt.resumeRunId,repairInput:attempt.repairInput,textModel:attempt.repairInput?'deepseek-v4-pro':undefined})}});
 server.requestTimeout=15000;server.listen(8091,'127.0.0.1',()=>console.log('本地法语听力后端 http://127.0.0.1:8091（不会自动调用供应商）'));
 process.on('SIGINT',()=>server.close(()=>{store.close();process.exit(0);}));
}
