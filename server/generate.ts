import {mkdirSync,readFileSync} from 'node:fs';import {resolve} from 'node:path';import {Store} from './store.ts';import {generateOne} from './providers.ts';
const dir=resolve('server/data');mkdirSync(dir,{recursive:true});const store=new Store(resolve(dir,'learning.sqlite'));
try{
 const args=process.argv.slice(2);
 if(args[0]==='accept'){
  const id=args[1];if(!id||!args.includes('--reviewed-text-and-validated-audio')||!args.includes('--provisional-listening'))throw Error('首题只可在文本审核、音频技术校验后，以明确待试听的入门学习标记开放');
  store.accept(id);console.log('已开放首题试听（入门学习、非官方校准，音色自然度待用户确认）：'+id);
 }else{
  if(!args.includes('--key-ready'))throw Error('等待用户明确通知密钥已就绪；当前未调用任何供应商');
  const pricingDate=args.find(a=>a.startsWith('--pricing-verified='))?.split('=')[1]??'';
  const voice=args.find(a=>a.startsWith('--voice='))?.split('=')[1]??'Serena';
  if(!['Serena','Emilien','Cherry'].includes(voice))throw Error('音色未核对');
  const revisionPath=args.find(a=>a.startsWith('--revision-file='))?.slice('--revision-file='.length);const revision=revisionPath?JSON.parse(readFileSync(resolve(dir,revisionPath),'utf8')):undefined;
  const id=await generateOne({store,dir,ready:true,pricingDate,revision,keys:{deepseek:process.env.DEEPSEEK_API_KEY,dashscope:process.env.DASHSCOPE_API_KEY},voice:voice as 'Serena'});
  console.log('已保存真实音频及待人工审核题目：'+id+'；审阅 server/data/runs/，尚未开放到学习界面。');
 }
}catch(e){console.error(e instanceof Error?e.message:'生成失败');process.exitCode=1;}finally{store.close();}

