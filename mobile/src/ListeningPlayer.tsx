import{CLOUD_MODE,cloudAccess}from'./api';
import{usePrivateAudio}from'./FamilyAccess';
import React,{useEffect,useRef,useState} from 'react';import {View} from 'react-native';import {useAudioPlayer,useAudioPlayerStatus} from 'expo-audio';import {api,API,type Session} from './api';import {Button,Copy,C,styles} from './ui';import{PlaybackSpeed}from'./PlaybackSpeed';
export function ListeningPlayer({sourcePath,session,busy,onEnd,onReplay,onPlayback,onPendingChange,hasFeedback,compact=false}:{sourcePath:string;compact?:boolean;session:Session;busy:boolean;onEnd:(isActive?:()=>boolean)=>Promise<void>;onReplay:(isActive?:()=>boolean)=>Promise<void>;onPlayback?:(session:Session)=>void;onPendingChange?:(pending:boolean)=>void;hasFeedback:boolean}){
 const privateAudio=usePrivateAudio(sourcePath);const player=useAudioPlayer(null,{updateInterval:150});
 useEffect(()=>{player.replace(privateAudio.source);},[player,privateAudio.source]);const status=useAudioPlayerStatus(player);
 useEffect(()=>{if(CLOUD_MODE&&status.error)void cloudAccess.response('/access',{}).catch(()=>{});},[status.error]);
 const[started,setStarted]=useState(false),[error,setError]=useState(''),[savingEnd,setSavingEnd]=useState(false),[rate,setRate]=useState(session.playbackRate??1),[savingPlayback,setSavingPlayback]=useState(false);
 const mounted=useRef(true),endedSeen=useRef(false),playbackLock=useRef(false),latestStatus=useRef(status),appliedRate=useRef(rate),segmentStart=useRef(0),reported=useRef(new Set<number>()),failed=useRef(new Set<number>()),reports=useRef(Promise.resolve());latestStatus.current=status;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;try{player.pause();}catch{}try{player.replace(null);}catch{}onPendingChange?.(false);};},[player,onPendingChange]);
 useEffect(()=>{onPendingChange?.(savingEnd||savingPlayback);},[savingEnd,savingPlayback,onPendingChange]);
 useEffect(()=>{if(status.error)setError(status.isLoaded?'音频暂时无法播放，请重试。':'音频载入失败。请检查本地服务后重新打开练习。');},[status.error]);
 useEffect(()=>{if(status.isLoaded){player.shouldCorrectPitch=true;player.setPlaybackRate(appliedRate.current,'high');}},[player,status.isLoaded]);
 async function recordHeard(r:number){if(!mounted.current)return;const s=await api<Session>('/sessions/'+session.id+'/playback',{rate:r,action:'play',voiceEpoch:session.voiceEpoch});if(mounted.current)onPlayback?.(s);}
 useEffect(()=>{
  const r=appliedRate.current;
  if(started&&(status.playing||status.didJustFinish)&&status.currentTime>segmentStart.current+0.02&&!reported.current.has(r)){
   reported.current.add(r);reports.current=reports.current.then(()=>recordHeard(r)).catch(()=>{failed.current.add(r);setError('播放记录待保存，请在听完后重试保存。');});
  }
 },[started,status.currentTime,status.playing,status.didJustFinish,rate]);
 async function finish(){await reports.current;if(!mounted.current)return;for(const r of failed.current){await recordHeard(r);failed.current.delete(r);}if(mounted.current)await onEnd(()=>mounted.current);}
 useEffect(()=>{if(status.didJustFinish&&started&&!session.ended&&!endedSeen.current){endedSeen.current=true;setSavingEnd(true);void finish().catch(()=>{setError('听完记录未保存，请点“保存听完记录”重试。');}).finally(()=>setSavingEnd(false));}},[status.didJustFinish,started,session.ended,onEnd]);
 const seconds=(n:number)=>Math.floor(n/60)+':'+Math.floor(n%60).toString().padStart(2,'0');
 function pending(value:boolean){playbackLock.current=value;setSavingPlayback(value);}
 async function selectRate(next:number){if(!mounted.current||next===rate||playbackLock.current)return;pending(true);setError('');try{
  const s=await api<Session>('/sessions/'+session.id+'/playback',{rate:next,action:'select',voiceEpoch:session.voiceEpoch});if(!mounted.current)return;
  player.shouldCorrectPitch=true;player.setPlaybackRate(next,'high');segmentStart.current=latestStatus.current.currentTime;appliedRate.current=next;setRate(next);onPlayback?.(s);
 }catch{setError('速度调整未保存，请重试。');}finally{pending(false);}}
 async function play(){if(!mounted.current||playbackLock.current)return;setError('');if(status.playing){player.pause();return;}pending(true);try{
  let reset=false;if(session.ended){await onReplay(()=>mounted.current);if(!mounted.current)return;await player.seekTo(0);reset=true;}else if(status.didJustFinish){await player.seekTo(0);reset=true;}
  if(!mounted.current)return;segmentStart.current=reset?0:latestStatus.current.currentTime;appliedRate.current=rate;player.shouldCorrectPitch=true;player.setPlaybackRate(rate,'high');setStarted(true);player.play();
 }catch{setError('音频暂时无法播放，请重试。');}finally{pending(false);}}
 const title=status.playing?'暂停':session.ended?(hasFeedback?'重听并练习':'再听一遍'):started?'继续播放':'播放听力';
 const speeds=<PlaybackSpeed value={rate} disabled={busy||savingEnd||savingPlayback||!status.isLoaded} onChange={r=>void selectRate(r)}/>;
 const problem=(error||status.error||privateAudio.error)?<Copy accessibilityRole="alert" style={{color:C.error,fontSize:17}}>{error||privateAudio.error||'音频载入失败。请检查本地服务后重新打开练习。'}</Copy>:null;
 if(compact)return <View style={{gap:10}}>{speeds}<Button title="重听并练习" secondary disabled={busy||savingPlayback||!status.isLoaded} onPress={()=>void play()}/>{problem}</View>;
 return <View style={styles.card}>
  <View style={{flexDirection:'row',alignItems:'center',gap:14}}><View style={{width:58,height:58,borderRadius:29,backgroundColor:C.soft,alignItems:'center',justifyContent:'center'}}><Copy style={{color:C.blue,fontSize:28}}>♪</Copy></View><View style={{flex:1}}><Copy style={{fontWeight:'700',fontSize:23}}>听力音频</Copy><Copy style={styles.muted}>{session.ended?'已完整听完 · 可重听辅助练习':session.questionDisplay==='immediate'?'可先看题，听完后提交':'听完后，问题和选项才会出现'}</Copy></View></View>
  <View accessible accessibilityLabel={'播放进度 '+seconds(status.currentTime??0)} style={{height:8,borderRadius:4,backgroundColor:C.soft,overflow:'hidden'}}><View style={{height:8,width:status.duration?Math.min(100,(status.currentTime/status.duration)*100)+'%':'0%',backgroundColor:C.blue}}/></View>
  <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Copy style={styles.muted}>{seconds(status.currentTime??0)} / {seconds(status.duration??0)}</Copy><Copy style={styles.muted}>{savingEnd?'正在保存听完记录':status.isBuffering?'正在缓冲':status.playing?'正在播放':!status.isLoaded?'正在载入音频':'可播放'}</Copy></View>
  {speeds}<Button title={title} disabled={busy||savingEnd||savingPlayback||!status.isLoaded} onPress={()=>void play()}/>{problem}
  {endedSeen.current&&!session.ended&&!savingEnd&&<Button title="保存听完记录" secondary onPress={()=>{setSavingEnd(true);void finish().then(()=>setError('')).catch(()=>setError('保存失败，请再试一次。')).finally(()=>setSavingEnd(false));}}/>}
 </View>;
}
