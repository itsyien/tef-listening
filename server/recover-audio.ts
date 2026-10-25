// Local recovery only: no fetch, keys or provider requests.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {finalizeQwenWav} from './providers.ts';import {validateQuestion,validateAudit} from '../shared/question.ts';import {Store} from './store.ts';
const runId=process.argv[2];if(!runId||!/^\w{8}-[a-f0-9-]{27}$/.test(runId))throw Error('需要真实运行ID');
const dir=resolve('server/data'),file=join(dir,'runs',runId+'.json'),r=JSON.parse(readFileSync(file,'utf8'));
if(r.stage!=='failed'||r.error!=='WAV 文件无效'||!r.editorialRevision)throw Error('只恢复已审核编辑稿的本地音频头问题');
const q=validateQuestion(r.draft);q.id='tef-'+runId;validateAudit(r.audit,q);
if(r.blind?.answerId!==q.correctOptionId||r.blind?.ambiguous!==false)throw Error('盲解未通过');
const raw=readFileSync(join(dir,'runs',runId+'.audio-response')),b=finalizeQwenWav(raw),hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
if(!raw.subarray(44).equals(b.subarray(44)))throw Error('PCM样本不一致');
const audio={file:hash(JSON.stringify({script:q.script,model:r.ttsModel,voice:r.voice,language:r.language}))+'.wav',sha256:hash(b),bytes:b.length};
mkdirSync(join(dir,'audio'),{recursive:true});if(existsSync(join(dir,'audio',audio.file)))throw Error('目标音频已存在，请核对而非覆盖');writeFileSync(join(dir,'audio',audio.file),b,{flag:'wx'});
const store=new Store(join(dir,'learning.sqlite'));try{store.publish(q,r.audit,audio,'live');r.questionId=q.id;r.question=q;r.audio=audio;r.originalAudioSha256=hash(raw);r.streamHeaderFinalized=true;r.pcmUnchanged=true;r.durationSeconds=(b.length-44)/48000;r.stage='awaiting-human-review';r.budget=store.budget();writeFileSync(file,JSON.stringify(r,null,2));console.log(JSON.stringify({questionId:q.id,audio,durationSeconds:r.durationSeconds,pcmUnchanged:true,budget:r.budget}));}finally{store.close();}

