export const IDS = ['A','B','C','D'] as const;
export type OptionId = typeof IDS[number];
export type Choice = OptionId | 'not-heard';
export interface Option {id:OptionId;text:string;explanationZh:string;evidence:string}
export interface Question {titleZh:string;id:string;version:1;kind:'voicemail'|'announcement'|'dialogue';skill:'intent'|'condition'|'detail';target:'NCLC5-learning';script:string;question:string;options:Option[];correctOptionId:OptionId;rationaleZh:string}
export const CHECKS = ['naturalFrench','appropriateLearningDifficulty','uniqueAnswer','paraphrase','plausibleDistractors','noKeywordShortcut','exactEvidence','accurateChinese','original'] as const;
export interface Audit {approved:true;checks:Record<typeof CHECKS[number],true>;reasonZh:string;optionChecks:{id:OptionId;defensible:boolean;reasonZh:string}[]}
function requireThat(ok:unknown,message:string):asserts ok {if(!ok)throw Error(message)}
function exact(x:any,keys:readonly string[]) {return x && typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));}
function text(x:unknown,min:number,max:number):x is string {return typeof x==='string'&&x.trim().length>=min&&[...x].length<=max&&x===x.trim()&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(x);}
function chinese(x:unknown):x is string {return text(x,8,1000)&&/[\u3400-\u9fff]/u.test(x);}
export function validateQuestion(value:unknown):Question {
 const q:any=value;requireThat(exact(q,['titleZh','id','version','kind','skill','target','script','question','options','correctOptionId','rationaleZh']),'题目字段不符合格式');
 requireThat(text(q.titleZh,4,48)&&/[\u3400-\u9fff]/u.test(q.titleZh)&&!['听力练习','复习记录','回答正确','回答错误'].includes(q.titleZh),'需要具体场景中文标题');
 requireThat(typeof q.id==='string'&&/^[a-z0-9-]{3,80}$/.test(q.id)&&q.version===1&&q.target==='NCLC5-learning','题目版本错误');
 requireThat(['voicemail','announcement','dialogue'].includes(q.kind)&&['intent','condition','detail'].includes(q.skill),'题型错误');
 requireThat(text(q.script,140,500)&&text(q.question,15,220)&&chinese(q.rationaleZh),'脚本、问题或中文总结不合格');
 requireThat(Array.isArray(q.options)&&q.options.length===4&&IDS.includes(q.correctOptionId),'需要四个选项和一个答案');
 q.options.forEach((o:any,i:number)=>{
  requireThat(exact(o,['id','text','explanationZh','evidence'])&&o.id===IDS[i],'选项必须固定为A至D');
  requireThat(text(o.text,5,180)&&chinese(o.explanationZh)&&text(o.evidence,10,500),'选项解释或证据缺失');
  requireThat(q.script.includes(o.evidence),'原文证据不在脚本中');
 });
 requireThat(new Set(q.options.map((o:Option)=>o.text.toLocaleLowerCase('fr').replace(/[\s.,!?;:]/g,''))).size===4,'选项重复');
 return structuredClone(q);
}
export function validateAudit(value:unknown,q:Question):Audit {
 const a:any=value;requireThat(exact(a,['approved','checks','reasonZh','optionChecks'])&&a.approved===true,'语义审核未通过');
 requireThat(exact(a.checks,CHECKS)&&CHECKS.every(k=>a.checks[k]===true)&&chinese(a.reasonZh),'质量审核未通过');
 requireThat(Array.isArray(a.optionChecks)&&a.optionChecks.length===4,'需要逐项审核');
 a.optionChecks.forEach((o:any,i:number)=>requireThat(exact(o,['id','defensible','reasonZh'])&&o.id===IDS[i]&&typeof o.defensible==='boolean'&&o.defensible===(o.id===q.correctOptionId)&&chinese(o.reasonZh),'独立答案审核不一致'));
 return structuredClone(a);
}
export function publicQuestion(q:Question){return {id:q.id,version:q.version,question:q.question,options:q.options.map(({id,text})=>({id,text}))};}
