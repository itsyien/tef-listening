import{FamilyAccess}from'../FamilyAccess';
import{CLOUD_MODE,cloudAccess,sessionStorageKey}from'../api';
import React,{useCallback,useEffect,useRef,useState} from 'react';import {View,ScrollView,Pressable,useWindowDimensions,AppState} from 'react-native';import AsyncStorage from '@react-native-async-storage/async-storage';
import {api,type Session,type PublicQuestion,type Feedback,type Review,type Answer,type NextStatus,type Voice} from '../api';import {Copy,Button,C,styles} from '../ui';import {PracticeVoice} from '../PracticeVoice';import{SettingsPanel}from'../SettingsPanel';import{FeedbackPanel,FeedbackVignette}from'../FeedbackPanel';
const STORAGE='tef-listening-session-v1',REVIEW_STORAGE='tef-listening-review-queue-v1';
interface ReviewRun{id:string;roots:string[];index:number;childId:string|null;kind:'wrong'|'single'}
function savedReview(raw:string):ReviewRun{const run=JSON.parse(raw);if(!run||typeof run.id!=='string'||!Array.isArray(run.roots)||!run.roots.length||!run.roots.every((id:unknown)=>typeof id==='string')||!Number.isInteger(run.index)||run.index<0||run.index>run.roots.length||(run.childId!==null&&typeof run.childId!=='string')||!['wrong','single'].includes(run.kind))throw Error('复习进度无法读取，请从复习列表重新开始。');return run;}
const choiceText=(a:Answer)=>a.choice==='not-heard'?'没听清楚':a.choice;
const resultText=(a:Answer)=>a.result==='not-heard'?'没听清楚':a.correct?'答对':'答错';
export default function App(){return <FamilyAccess><Home/></FamilyAccess>;}
function Home(){
 const[settingsRevision,setSettingsRevision]=useState(0),currentQuestion=useRef<string|null>(null);
 const sessionRead=useRef<AbortController|null>(null),syncRead=useRef<AbortController|null>(null),reviewRead=useRef<AbortController|null>(null),sessionRef=useRef<Session|null>(null),syncRevision=useRef(-1),[nextRevision,setNextRevision]=useState(0),ensured=useRef(new Set<string>());
 const {width}=useWindowDimensions(),wide=width>=1000;
 const [tab,setTab]=useState<'learn'|'review'|'settings'>('learn'),[catalog,setCatalog]=useState<{id:string;source:string}[]>([]),[ready,setReady]=useState(false),[mode,setMode]=useState('live'),[offline,setOffline]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [session,setSession]=useState<Session|null>(null),[question,setQuestion]=useState<PublicQuestion|null>(null),[feedback,setFeedback]=useState<Feedback|null>(null),[choice,setChoice]=useState(''),[reviews,setReviews]=useState<Review[]>([]);
 const[reviewRun,setReviewRun]=useState<ReviewRun|null>(null),[reviewFilter,setReviewFilter]=useState<'all'|'wrong'|'not-heard'>('all'),[reviewFocus,setReviewFocus]=useState('');
 const reviewDone=!!reviewRun&&reviewRun.index>=reviewRun.roots.length,wrongReviews=reviews.filter(r=>r.category==='wrong'&&!r.resolved),visibleReviews=reviews.filter(r=>reviewFilter==='all'||r.category===reviewFilter);
 const [focusedChoice,setFocusedChoice]=useState(''),[focusedNav,setFocusedNav]=useState('');
 const assisted=session?.assisted??false;const[playbackPending,setPlaybackPending]=useState(false);
 const[completed,setCompleted]=useState(false),[next,setNext]=useState<NextStatus|null>(null),[nextConnectionError,setNextConnectionError]=useState(false);
 const nextRequest=useRef(0),nextMutating=useRef(false);
 useEffect(()=>{if(!session||session.reviewMode){setNext(null);return;}let live=true,timer:ReturnType<typeof setTimeout>|undefined,failures=0;nextRequest.current++;setNextConnectionError(false);
  async function update(){if(!live)return;if(nextMutating.current){timer=setTimeout(update,2000);return;}const version=nextRequest.current;try{const ensure=!ensured.current.has(session!.id);if(ensure)ensured.current.add(session!.id);const n=await api<NextStatus>('/sessions/'+session!.id+'/next',ensure?{}:undefined);if(live&&version===nextRequest.current){setNext(n);setNextConnectionError(false);failures=0;if(n.state==='preparing')timer=setTimeout(update,2000);}}catch{if(live&&version===nextRequest.current){setNextConnectionError(true);if(++failures<3)timer=setTimeout(update,5000);}}}
  void update();return()=>{live=false;if(timer)clearTimeout(timer);};
 },[session?.id,nextRevision]);
 const qualityRetry=!!next&&['retryable-quality','paused-quality','awaiting-content-review','awaiting-review'].includes(next.state);
 const legacyReview=next?.state==='awaiting-content-review'||next?.state==='awaiting-review';
 const nextNote=nextConnectionError?'暂时无法读取下一题进度，请检查学习服务连接。':next?.state==='preparing'?'正在提前准备下一题…':next?.state==='ready'?'下一题已准备好':qualityRetry?(legacyReview?'下一题可重新生成并自动检查':'下一题未通过质量检查，可重新生成'):next?.state==='paused-voice-budget'?'下一题声音预算需补充':next?.state==='paused-deepseek-budget'?'下一题文本预算已暂停':next?.state==='failed'?'下一题准备失败，可重试':next?.state==='waiting-approval'?'下一题等待授权':next?.state?.startsWith('paused')?'下一题准备已暂停，可查看原因':'';
 const content=useRef<React.ComponentRef<typeof ScrollView>>(null);
 useEffect(()=>{if(!feedback)return;const frame=requestAnimationFrame(()=>content.current?.scrollTo({y:0,animated:false}));return()=>cancelAnimationFrame(frame);},[feedback]);
 const lock=useRef(false),pending=useRef<{choice:string;requestId:string}|null>(null);
 const loadSession=useCallback(async(id:string)=>{
  sessionRead.current?.abort();const controller=new AbortController();sessionRead.current=controller;const timer=setTimeout(()=>controller.abort(),12000),active=()=>!controller.signal.aborted&&sessionRead.current===controller;
  try{
   let [current,preference]=await Promise.all([api<Session>('/sessions/'+id,undefined,controller.signal),api<{defaultVoice:Voice}>('/settings',undefined,controller.signal)]);
   if(!active())return;
   if(sessionRef.current?.id===id&&sessionRef.current.voiceEpoch>current.voiceEpoch)return;
   if(preference.defaultVoice!==current.voice){await api('/sessions/'+id+'/voice',{voice:preference.defaultVoice});if(!active())return;current=await api<Session>('/sessions/'+id,undefined,controller.signal);}
   const [q,data]=await Promise.all([(current.ended||current.questionDisplay==='immediate')?api<PublicQuestion>('/sessions/'+id+'/question',undefined,controller.signal):null,current.ended?api<Feedback>('/sessions/'+id+'/feedback',undefined,controller.signal).catch(()=>null):null]);
   if(!active()||(sessionRef.current?.id===id&&sessionRef.current.voiceEpoch>current.voiceEpoch))return;
   const same=sessionRef.current?.id===id;
   if(!same){setCompleted(false);setChoice('');}
   setSession(old=>old?.id===id?{...current,ended:old.ended||current.ended,first:old.first??current.first,assisted:old.assisted||current.assisted}:current);
   setQuestion(old=>q??(same&&sessionRef.current?.ended?old:null));
   const visible=data&&(!current.reviewMode||data.latest?.reviewMode||data.events.some(e=>e.kind==='reveal'))?data:null;
   setFeedback(old=>same&&old&&(!visible||(old.latest?.at??0)>(visible.latest?.at??0))?old:visible);
  }catch(e){if(!controller.signal.aborted)throw e;}finally{clearTimeout(timer);}
 },[]);
 const resumeReview=useCallback(async(run:ReviewRun,open=true)=>{
  setReviewRun(run);setSession(null);setQuestion(null);setFeedback(null);setChoice('');setCompleted(false);if(open)setTab('learn');pending.current=null;
  await AsyncStorage.setItem(sessionStorageKey(REVIEW_STORAGE),JSON.stringify(run));
  if(run.index>=run.roots.length){setReviews(await api('/review'));return;}
  let childId=run.childId;
  if(!childId){const child=await api<Session>('/review/sessions',{sessionId:run.roots[run.index],requestId:(run.id+'-'+run.index+'-'+run.roots[run.index]).replace(/[^a-zA-Z0-9-]/g,'-').slice(0,100)});childId=child.id;run={...run,childId};await AsyncStorage.setItem(sessionStorageKey(REVIEW_STORAGE),JSON.stringify(run));setReviewRun(run);}
  await loadSession(childId);
 },[loadSession]);
 const sync=useCallback(async()=>{if(!CLOUD_MODE)return;syncRead.current?.abort();const controller=new AbortController();syncRead.current=controller;const timer=setTimeout(()=>controller.abort(),12000);try{
  const[snapshot,list,review]=await Promise.all([api<{revision:number;currentQuestionId:string|null;settings:unknown}>('/sync',undefined,controller.signal),api<{id:string;source:string}[]>('/catalog',undefined,controller.signal),api<Review[]>('/review',undefined,controller.signal)]);
  if(controller.signal.aborted||syncRead.current!==controller||snapshot.revision<syncRevision.current)return;
  syncRevision.current=snapshot.revision;currentQuestion.current=snapshot.currentQuestionId;setCatalog(list);setReviews(review);setError(old=>['同步暂时失败，请稍后重试。','同步暂时失败，当前记录保留。'].includes(old)?'':old);setSettingsRevision(v=>v+1);setNextRevision(v=>v+1);
 }catch(e){if(!controller.signal.aborted)throw e;}finally{clearTimeout(timer);}},[]);
 useEffect(()=>{if(!CLOUD_MODE)return;const reconnect=()=>void sync().catch(()=>setError('同步暂时失败，请稍后重试。'));const listener=AppState.addEventListener('change',state=>{if(state==='active')reconnect();});if(typeof window!=='undefined')window.addEventListener?.('online',reconnect);return()=>{listener.remove();if(typeof window!=='undefined')window.removeEventListener?.('online',reconnect);};},[sync]);
 useEffect(()=>()=>{sessionRead.current?.abort();syncRead.current?.abort();reviewRead.current?.abort();},[]);
 sessionRef.current=session;
 function navigate(value:'learn'|'review'|'settings'){
  sessionRead.current?.abort();reviewRead.current?.abort();setTab(value);
  if(value==='learn'&&session)void loadSession(session.id).catch(()=>setError('同步暂时失败，当前记录保留。'));
  if(value==='review'){const controller=new AbortController();reviewRead.current=controller;const timer=setTimeout(()=>controller.abort(),12000);void api<Review[]>('/review',undefined,controller.signal).then(rows=>{if(!controller.signal.aborted&&reviewRead.current===controller)setReviews(rows);}).catch(()=>{}).finally(()=>clearTimeout(timer));}
 }
 const refresh=useCallback(async()=>{
  setOffline(false);setError('');try{
   if(CLOUD_MODE)await sync();
   const [health,list]=await Promise.all([api<{mode:string}>('/health'),api<{id:string;source:string}[]>('/catalog')]);setMode(health.mode);setCatalog(list);
   const [saved,review]=await Promise.all([AsyncStorage.getItem(sessionStorageKey(STORAGE)),AsyncStorage.getItem(sessionStorageKey(REVIEW_STORAGE))]);try{if(review)await resumeReview(savedReview(review),false);else if(saved)await loadSession(saved);}catch(e){setError(e instanceof Error?e.message:'上次练习暂时无法恢复，请重试。原记录仍保留在学习服务中。');}
   setReviews(await api('/review'));setReady(true);
  }catch{setOffline(true);setReady(true);}
 },[loadSession,resumeReview,sync]);
 useEffect(()=>{void refresh();},[refresh]);
 async function action(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');}finally{lock.current=false;setBusy(false);}}
 const ended=useCallback(async(_isActive?:()=>boolean)=>{if(!session)return;const saved=await api<Session>('/sessions/'+session.id+'/events',{kind:'ended',voiceEpoch:session.voiceEpoch});const q=await api<PublicQuestion>('/sessions/'+saved.id+'/question');if(sessionRef.current?.id!==saved.id||sessionRef.current.voiceEpoch!==saved.voiceEpoch)return;setSession(old=>old?.id===saved.id?{...saved,first:old.first??saved.first}:old);setQuestion(q);setError(old=>old==='播放记录尚未保存，请返回听力重听并重试。'?'':old);},[session]);
 const replay=useCallback(async(isActive?:()=>boolean)=>{if(!session||(isActive&&!isActive()))return;const s=await api<Session>('/sessions/'+session.id+'/events',{kind:'replay',voiceEpoch:session.voiceEpoch});if(isActive&&!isActive())return;setSession(s);setFeedback(null);setChoice('');},[session]);
 async function submit(value:string){await action(async()=>{
  if(!session)return;if(!pending.current||pending.current.choice!==value)pending.current={choice:value,requestId:'answer-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
  const data=await api<Feedback>('/sessions/'+session.id+'/answers',pending.current);pending.current=null;setFeedback(data);setSession({...session,first:data.first});setReviews(await api('/review'));
 });}
 async function reveal(){await action(async()=>{if(!session)return;setSession(await api<Session>('/sessions/'+session.id+'/events',{kind:'reveal'}));setFeedback(await api('/sessions/'+session.id+'/feedback'));});}
 async function requestNext(retry=false){if(!session||session.reviewMode)return;nextMutating.current=true;nextRequest.current++;try{const result=await api<NextStatus>('/sessions/'+session.id+'/next',retry?{retry:true}:{});setNext(result);setNextConnectionError(false);if(result.state==='preparing')setNextRevision(v=>v+1);return result;}finally{nextMutating.current=false;}}
 async function continueLearning(){await action(async()=>{if(!session)return;if(session.reviewMode){if(reviewRun&&feedback?.latest?.reviewMode)await resumeReview({...reviewRun,index:reviewRun.index+1,childId:null});return;}const result=await requestNext();if(!result)return;if(result.state==='ready'&&result.questionId){const s=await api<Session>('/sessions',{questionId:result.questionId});await AsyncStorage.setItem(sessionStorageKey(STORAGE),s.id);await loadSession(s.id);}else setCompleted(true);});}
 async function startReview(roots:string[],kind:ReviewRun['kind']){if(!roots.length)return;await resumeReview({id:'review-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),roots,index:0,childId:null,kind});}
 async function ordinaryPractice(){setTab('learn');await AsyncStorage.removeItem(sessionStorageKey(REVIEW_STORAGE));setReviewRun(null);setSession(null);setQuestion(null);setFeedback(null);setCompleted(false);const saved=await AsyncStorage.getItem(sessionStorageKey(STORAGE));if(saved)await loadSession(saved);}
 async function reviewList(){navigate('review');if(reviewDone){await AsyncStorage.removeItem(sessionStorageKey(REVIEW_STORAGE));setReviewRun(null);setSession(null);}}
 const nav=<View style={{gap:10,flexDirection:wide?'column':'row'}}>{(['learn','review','settings'] as const).map((value,i)=><Pressable key={value} onFocus={()=>setFocusedNav(value)} onBlur={()=>setFocusedNav('')} accessibilityRole="button" accessibilityLabel={value==='learn'?'听力练习':value==='review'?'复习记录':'设置'} accessibilityState={{selected:tab===value}} onPress={()=>navigate(value)} style={({pressed})=>({outlineStyle:'solid',outlineWidth:focusedNav===value?3:0,outlineOffset:2,outlineColor:C.blue,flex:wide?undefined:1,flexDirection:'row',gap:wide?12:8,padding:wide?16:12,borderRadius:12,backgroundColor:tab===value?C.soft:'transparent',opacity:pressed?0.7:1})}>{wide&&<Copy style={{color:tab===value?C.blue:C.muted,fontSize:16}}>0{i+1}</Copy>}<Copy style={{fontSize:18,flexShrink:1,color:tab===value?C.blue:C.ink,fontWeight:tab===value?'700':'400'}}>{value==='learn'?'听力练习':value==='review'?'复习记录':'设置'}</Copy></Pressable>)}</View>;
 return <View style={{flex:1,backgroundColor:C.bg,flexDirection:'row'}}>
  {wide&&<View style={{width:260,backgroundColor:C.paper,borderRightWidth:1,borderColor:C.line,padding:28,paddingTop:44,gap:48}}><View><Copy style={{fontSize:28,fontWeight:'700',color:C.blue}}>TEF法语学习</Copy></View>{nav}</View>}
  <View style={{flex:1}}><ScrollView ref={content} style={{flex:1}} contentContainerStyle={{alignItems:'center',paddingHorizontal:wide?44:20,paddingTop:wide?44:26,paddingBottom:48}}>
   <View style={{width:'100%',maxWidth:880,gap:24}}>
    {!wide&&<View style={{gap:20}}><Copy style={{fontSize:27,fontWeight:'700',color:C.blue}}>TEF法语学习</Copy>{nav}</View>}
    <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap'}}><Copy accessibilityRole="header" style={{fontSize:wide?30:26,lineHeight:wide?43:38,fontWeight:'700'}}>{tab==='learn'&&reviewRun?(reviewRun.kind==='wrong'?'错题复习':'单题复习'):tab==='learn'?'听力练习':tab==='review'?'复习记录':'设置'}</Copy><View style={{backgroundColor:C.soft,borderRadius:20,paddingHorizontal:14,paddingVertical:6}}><Copy style={{fontSize:15,color:C.blue,fontWeight:'700'}}>NCLC 5 学习目标</Copy></View></View>
    {__DEV__&&mode==='verification'&&<View style={{backgroundColor:C.soft,padding:14,borderRadius:10}}><Copy style={{color:C.blue,fontSize:17,fontWeight:'700'}}>本地验收会话 · 使用真实已保存音频</Copy></View>}
    {__DEV__&&mode==='test'&&<View style={{backgroundColor:'#FFF0D6',padding:14,borderRadius:10}}><Copy accessibilityRole="alert" style={{color:'#704815',fontSize:17,fontWeight:'700'}}>测试素材 · 非真实法语音频</Copy></View>}
    {!!error&&<View accessibilityRole="alert" style={[styles.card,{borderColor:C.error,padding:18}]}><Copy style={{color:C.error}}>{error}</Copy></View>}
 
    {ready&&!offline&&<View style={{display:tab==='settings'?'flex':'none'}} accessibilityElementsHidden={tab!=='settings'} importantForAccessibility={tab==='settings'?'auto':'no-hide-descendants'}><SettingsPanel revision={settingsRevision} active={tab==='settings'}/></View>}
    {!ready?<View style={styles.card}><Copy>正在打开你的练习…</Copy></View>:offline?<View style={styles.card}><Copy style={styles.heading}>暂时无法连接学习服务</Copy><Copy style={styles.muted}>练习记录不会因此改变。服务恢复后，点下面的按钮再试一次。</Copy><Button title="重新连接" onPress={()=>void refresh()}/></View>:tab==='settings'?null:tab==='review'?<View style={{gap:16}}>
     <Button title="复习错题" disabled={busy||!wrongReviews.length} onPress={()=>void action(()=>startReview(wrongReviews.map(r=>r.sessionId),'wrong'))}/>
     {reviewRun&&!reviewDone&&<Button title="继续本轮复习" secondary disabled={busy} onPress={()=>void action(()=>resumeReview(reviewRun))}/>}
     <View accessibilityRole="radiogroup" accessibilityLabel="复习分类" style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{(['all','wrong','not-heard'] as const).map((filter,i)=><Pressable key={filter} accessibilityRole="radio" accessibilityLabel={['全部','错题','没听清楚'][i]} accessibilityState={{checked:reviewFilter===filter}} aria-checked={reviewFilter===filter} onPress={()=>setReviewFilter(filter)} onFocus={()=>setReviewFocus(filter)} onBlur={()=>setReviewFocus('')} style={{minHeight:44,paddingVertical:8,paddingHorizontal:14,borderWidth:1,borderColor:reviewFilter===filter?C.blue:C.line,borderRadius:9,backgroundColor:reviewFilter===filter?C.soft:C.paper,outlineStyle:'solid',outlineWidth:reviewFocus===filter?2:0,outlineColor:C.blue,outlineOffset:2}}><Copy style={{fontSize:17,color:reviewFilter===filter?C.blue:C.ink}}>{['全部','错题','没听清楚'][i]}</Copy></Pressable>)}</View>
     {!visibleReviews.length?<View style={styles.card}><Copy style={{fontWeight:'700'}}>{reviews.length?'这个分类暂无记录':'暂无复习记录'}</Copy></View>:visibleReviews.map(r=><View key={r.sessionId} testID={'review-card-'+r.sessionId} style={styles.card}>
      <Copy style={{fontWeight:'700',fontSize:23}}>{r.titleZh}</Copy><Copy style={{fontSize:17,color:C.blue}}>{r.category==='wrong'?'错题':r.category==='not-heard'?'没听清楚':'辅助作答'}</Copy>
      {r.category==='wrong'&&r.resolved&&<Copy style={{fontSize:17,color:C.success}}>已复习答对</Copy>}
      <Copy>首答 {r.first.result==='not-heard'?'没听清楚':choiceText(r.first)+' · '+resultText(r.first)}</Copy>{r.category==='wrong'&&r.first.correct!==false&&<Copy style={styles.muted}>后续练习曾选错，未改变首答。</Copy>}
      {r.first.assisted&&<Copy style={styles.muted}>首答前使用过帮助</Copy>}
      {r.latestReview&&<Copy style={styles.muted}>最近复习：{choiceText(r.latestReview)} · {resultText(r.latestReview)}</Copy>}
      <Button title="复习这题" secondary disabled={busy} onPress={()=>void action(()=>startReview([r.sessionId],'single'))}/>
     </View>)}
    </View>:reviewDone?<View style={styles.card}><Copy style={styles.heading}>本轮复习完成</Copy><Copy style={styles.muted}>本轮题目已重新作答，首次记录保留。</Copy><Button title="返回复习列表" disabled={busy} onPress={()=>void action(reviewList)}/><Button title="返回普通练习" secondary disabled={busy} onPress={()=>void action(ordinaryPractice)}/></View>:reviewRun&&!session?<View style={styles.card}><Copy style={styles.muted}>{busy?'正在打开复习题…':'本轮复习进度已保存。'}</Copy><Button title="继续本轮复习" disabled={busy} onPress={()=>void action(()=>resumeReview(reviewRun))}/><Button title="返回复习列表" secondary disabled={busy} onPress={()=>void action(reviewList)}/></View>:completed?<View style={styles.card}>
     <Copy style={styles.heading}>{next?.state==='ready'?'下一题已准备好':next?.state==='preparing'?'正在准备下一题':qualityRetry?(legacyReview?'下一题需要重新检查':'下一题未通过质量检查'):next?.state==='failed'?'下一题准备失败':next?.state==='waiting-approval'?'续题等待授权':next?.state==='review-only'?'当前为复习题目':'下一题准备已暂停'}</Copy>
     <Copy style={styles.muted}>{next?.state==='preparing'?'正在生成、检查并准备音频。检查未通过时，会在本次范围内修订或重新生成，请稍候。':qualityRetry?(legacyReview?'这份待检查草稿尚不可学习。点击“重新生成”，将重新生成并自动检查下一题。':'本次准备仍未通过质量检查，当前练习与记录已保留。点击“重新生成”开始新一轮准备。'):next?.state==='failed'?(next.error??'本次准备未完成，请重试。'):next?.state==='waiting-approval'?'尚未获得生成授权，当前练习和记录不受影响。':next?.state==='paused-voice-budget'?'声音预算暂时不足，当前练习与记录已保留。':next?.state==='paused-deepseek-budget'?'文本预算暂时不足，当前练习与记录已保留。':next?.state==='paused-quota'?'当前生成次数已用尽。':next?.state==='paused-budget'?'当前生成预算不足。':next?.state==='paused-pricing'?'生成价格需要核对，已暂停新请求。':next?.state==='ready'?'下一题已通过检查，可以开始学习。':'可以返回当前题目的解析，或查看复习记录。'}</Copy>
     {next?.state==='ready'&&<Button title="开始下一题" disabled={busy} onPress={()=>void continueLearning()}/>}
     {qualityRetry&&<Button title="重新生成" disabled={busy} onPress={()=>void action(async()=>{await requestNext(true);})}/>}
     {next?.state==='failed'&&<Button title="重试准备下一题" disabled={busy} onPress={()=>void action(async()=>{await requestNext(true);})}/>}
     <Button title="返回题目解析" secondary onPress={()=>setCompleted(false)}/><Button title="查看复习记录" onPress={()=>setTab('review')}/>
    </View>:!session?<View style={styles.card}>
     {!catalog.length&&CLOUD_MODE&&<Copy>尚无可用题目，待后端生成配置完成</Copy>}{!catalog.length&&!CLOUD_MODE&&<Copy style={styles.heading}>暂无可用题目</Copy>}
     <Copy style={styles.muted}>{catalog.length?'播放结束后显示问题和选项。':'题目审核完成后可开始练习。'}</Copy>
     {catalog.length>0?<Button title="开始这一题" disabled={busy} onPress={()=>void action(async()=>{const s=await api<Session>('/sessions',{questionId:currentQuestion.current??catalog[0]!.id});await AsyncStorage.setItem(sessionStorageKey(STORAGE),s.id);await loadSession(s.id);})}/>:<Button title="刷新查看" secondary onPress={()=>void refresh()}/>}
    </View>:<View style={{gap:22}}>
     <View style={{flexDirection:'row',justifyContent:'space-between',gap:10}}><Copy style={{fontSize:17,color:C.blue,fontWeight:'700'}}>{session.reviewMode?'复习 '+((reviewRun?.index??0)+1)+' / '+(reviewRun?.roots.length??1):'听力练习'}</Copy>{session.first&&<Copy style={styles.muted}>首答已记录</Copy>}</View>
     {!session.reviewMode&&!feedback&&!!nextNote&&<Copy testID="next-prefetch-status" style={{fontSize:15,color:C.muted}}>{nextNote}</Copy>}
     {feedback&&<FeedbackPanel key={'feedback-'+session.id} feedback={feedback} sessionId={session.id}/>}
     {session.reviewMode&&<Copy style={styles.muted}>复习复用已保存的 {session.voice} 音频。</Copy>}
     <PracticeVoice compact={!!feedback} key={session.id+':'+session.voice+':'+session.voiceEpoch} session={session} busy={busy} onEnd={ended} onReplay={replay} onPendingChange={setPlaybackPending} onSaveError={()=>setError('播放记录尚未保存，请返回听力重听并重试。')} onPlayback={s=>{setSession(current=>current?.id===s.id&&current.voiceEpoch===s.voiceEpoch?{...s,ended:current.ended||s.ended,first:current.first??s.first}:current);}} hasFeedback={!!feedback}/>

     {question&&!feedback&&<View testID="question" style={styles.card}>
      {!session.ended&&<Copy style={{fontSize:16,color:C.muted}}>可先看题，听完后提交。</Copy>}
      <Copy style={{fontSize:16,color:C.blue,fontWeight:'700'}}>{session.reviewMode?'复习作答 · 首次记录保留':assisted?'辅助练习 · 首答不会改变':'请选择答案'}</Copy><Copy accessibilityRole="header" style={{fontWeight:'700',fontSize:24,lineHeight:36}}>{question.question}</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel="选择答案" style={{gap:12}}>{question.options.map(o=><Pressable key={o.id} onFocus={()=>setFocusedChoice(o.id)} onBlur={()=>setFocusedChoice('')} accessibilityRole="radio" accessibilityLabel={o.id+' '+o.text} accessibilityState={{checked:choice===o.id}} disabled={busy} onPress={()=>{setChoice(o.id);pending.current=null;}} style={({pressed})=>({outlineStyle:'solid',outlineWidth:focusedChoice===o.id?3:0,outlineOffset:3,outlineColor:C.blue,flexDirection:'row',alignItems:'flex-start',gap:14,minHeight:68,padding:16,borderRadius:12,borderWidth:2,borderColor:choice===o.id?C.blue:C.line,backgroundColor:choice===o.id?C.soft:C.paper,opacity:pressed?0.8:1})}><Copy style={{color:choice===o.id?C.blue:C.muted,fontWeight:'700'}}>{o.id}</Copy><Copy style={{flex:1,fontSize:21,lineHeight:32}}>{o.text}</Copy></Pressable>)}</View>
      <Button title={session.reviewMode?'提交复习答案':assisted?'提交辅助答案':'提交首答'} disabled={!choice||busy||!session.ended} onPress={()=>void submit(choice)}/>
      <Button title="没听清楚" secondary disabled={busy||!session.ended} onPress={()=>void submit('not-heard')}/>
      <Copy style={[styles.muted,{fontSize:16}]}>“没听清楚”单独记录，不算作答错。提交后可以看原文与逐项解析。</Copy>
      <Button title="先看原文与解析" secondary disabled={busy||!session.ended} onPress={()=>void reveal()}/>
     </View>}

    </View>}
    <View style={{borderTopWidth:1,borderColor:C.line,paddingTop:20}}><Copy style={{fontSize:15,lineHeight:25,color:C.muted}}>学习模式 · 非官方 TEF 模考或等级评分。</Copy></View>
   </View>
  </ScrollView>
  {tab==='learn'&&!!feedback&&!completed&&<View style={{backgroundColor:C.paper,borderTopWidth:1,borderColor:C.line,paddingHorizontal:wide?44:20,paddingVertical:12,alignItems:'center'}}><View style={{width:'100%',maxWidth:880}}><Copy style={{fontSize:15,color:C.muted,marginBottom:6}}>{session?.reviewMode?'本轮复习':nextNote}</Copy><Button title="继续" disabled={busy||playbackPending||(!!session?.reviewMode&&!feedback?.latest?.reviewMode)} onPress={()=>void continueLearning()}/></View></View>}
  </View>
  <FeedbackVignette feedback={tab==='learn'&&!completed?feedback:null}/>
 </View>;
}
