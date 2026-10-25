import React,{useCallback,useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {api,type VoiceStatus} from './api';
import {ListeningPlayer} from './ListeningPlayer';
import {Button,Copy,C,styles} from './ui';

type Props=Omit<React.ComponentProps<typeof ListeningPlayer>,'sourcePath'>;
export function PracticeVoice(props:Props){
 const{session}=props,[status,setStatus]=useState<VoiceStatus|null>(null),[error,setError]=useState(''),[preparing,setPreparing]=useState(false);
 const active=useRef(true),request=useRef(0),working=useRef(false),checking=useRef(false);
 const receive=useCallback((result:VoiceStatus)=>{
  if(result.voice!==session.voice||result.voiceEpoch!==session.voiceEpoch){setStatus(null);setError('音色已变更，请重新打开当前练习。');return;}
  setStatus(result);setError('');
 },[session.voice,session.voiceEpoch]);
 const check=useCallback(async()=>{
  if(working.current||checking.current||!active.current)return;checking.current=true;
  const id=++request.current;
  try{const result=await api<VoiceStatus>('/sessions/'+session.id+'/voice');if(active.current&&id===request.current)receive(result);}
  catch{if(active.current&&id===request.current){setStatus(null);setError('暂时无法读取音频状态，请重新检查。');}}finally{if(id===request.current)checking.current=false;}
 },[session.id,receive]);
 useEffect(()=>{active.current=true;void check();return()=>{active.current=false;request.current++;checking.current=false;};},[check]);
 useEffect(()=>{if(preparing||!status||!['preparing','busy'].includes(status.state))return;const timer=setInterval(()=>void check(),2000);return()=>clearInterval(timer);},[status?.state,preparing,check]);
 async function prepare(){
  if(working.current||status?.state!=='missing'||!active.current)return;
  working.current=true;setPreparing(true);setError('');const id=++request.current;
  try{const result=await api<VoiceStatus>('/sessions/'+session.id+'/voice',{voice:session.voice,voiceEpoch:session.voiceEpoch,prepare:true});if(active.current&&id===request.current)receive(result);}
  catch{if(active.current&&id===request.current){setStatus(null);setError('音频准备结果尚未确认，请重新检查状态。不会自动重试准备。');}}
  finally{working.current=false;if(active.current)setPreparing(false);}
 }
 if(status?.state==='ready'&&status.audioPath)return <ListeningPlayer {...props} key={session.id+':'+session.voice+':'+session.voiceEpoch} sourcePath={status.audioPath}/>;
 return <View style={styles.card}><Copy style={{fontSize:20,fontWeight:'700'}}>当前音色 · {session.voice}</Copy>
  {error?<><Copy accessibilityRole="alert" style={{fontSize:17,color:C.error}}>{error}</Copy><Button title="重新检查音频状态" secondary onPress={()=>void check()}/></>:status?.state==='failed'?<Copy accessibilityRole="alert" style={{fontSize:17,color:C.error}}>{status.error??'当前音色准备失败。'} 未自动重试，请联系维护者。</Copy>:status?.state==='missing'&&!preparing?<><Copy style={styles.muted}>当前题目还没有 {session.voice} 音频。点击准备会生成并保存该音色的音频。</Copy><Button title={'准备 '+session.voice+' 音频'} disabled={props.busy||preparing} onPress={()=>void prepare()}/></>:<Copy accessibilityLiveRegion="polite" style={styles.muted}>{preparing||status?.state==='preparing'?'正在准备 '+session.voice+' 音频…':status?.state==='busy'?'正在完成另一音色的准备，请稍候…':'正在检查 '+session.voice+' 音频…'}</Copy>}
 </View>;
}
