import {Store}from'./store.ts';import{bounded}from'./providers.ts';import type{TranslationProvider}from'./translation.ts';
export function deepseekTranslationProvider(store:Store,options:{key:string|undefined;pricingDate:string;request?:typeof fetch}):TranslationProvider{
 return{available:()=>{const g=store.translationAllowance();return !!options.key&&g.granted===1&&g.used===0&&g.pricingDate===options.pricingDate&&g.pricingDate===new Date().toISOString().slice(0,10);},
 async translate(script:string){
  if(!options.key||options.pricingDate!==new Date().toISOString().slice(0,10))throw Error('翻译配置不可用');
  const body=JSON.stringify({model:'deepseek-flash',thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1200,messages:[{role:'system',content:'Translate the quoted French transcript faithfully into clear Simplified Chinese. Preserve conditions, negation, dates and who does what. No explanation, invented context or answers. Return json only: {"translationZh":"中文翻译"}.'},{role:'user',content:JSON.stringify({script})}]});
  const bytes=Buffer.byteLength(body);if(bytes>6000||[...script].length>500)throw Error('翻译文本超出限额');
  const reserve=Math.ceil((((bytes+512)*2/1e6+1200*8/1e6)*2+0.03)*1e6)/1e6;store.reserveTranslation(reserve);
  try{const r=await(options.request??fetch)('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+options.key,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(60000),redirect:'error'});
   const result=JSON.parse((await bounded(r,30000)).toString('utf8'));store.recordTranslationCall({status:'responded',model:'deepseek-flash',requestId:result.id??null,usage:result.usage??null,reserved:reserve});const choice=result.choices?.[0];if(choice?.finish_reason!=='stop'||!choice.message?.content)throw Error('翻译返回不完整');const value=JSON.parse(choice.message.content);
   if(!value||Object.keys(value).length!==1||typeof value.translationZh!=='string'||value.translationZh.length<8||value.translationZh.length>2500||!/[\u3400-\u9fff]/u.test(value.translationZh))throw Error('翻译格式不合格');return value.translationZh.trim();
  }catch{store.recordTranslationCall({status:'failed',message:'Translation failed; allowance remains consumed; no retry'});throw Error('翻译失败，本次授权已使用，不自动重试');}
 }};
}
