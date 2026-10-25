import{CLOUD_MODE,cloudAccess}from'./api';
import{usePrivateAudio}from'./FamilyAccess';
import React,{useEffect,useRef,useState} from 'react';
import {View,Pressable,Platform} from 'react-native';
import {useAudioPlayer,useAudioPlayerStatus} from 'expo-audio';
import {API,type Voice} from './api';
import {Copy,C} from './ui';

function SmallButton({title,onPress}:{title:string;onPress:()=>void}){
 const[focus,setFocus]=useState(false);
 return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)} style={{alignSelf:'flex-start',minHeight:44,paddingHorizontal:14,paddingVertical:8,borderWidth:1,borderColor:C.blue,borderRadius:9,backgroundColor:C.soft,outlineStyle:'solid',outlineWidth:focus?2:0,outlineOffset:2,outlineColor:C.blue}}><Copy style={{fontSize:17,color:C.blue}}>{title}</Copy></Pressable>;
}

// Each explicit attempt owns its player, so late status events cannot start another voice.
function Sample({voice,stopRef,onStop,onRetry}:{voice:Voice;stopRef:React.MutableRefObject<()=>void>;onStop:()=>void;onRetry:()=>void}){
 const privateAudio=usePrivateAudio('/audition/audio/'+voice);const player=useAudioPlayer(null,{updateInterval:150}),status=useAudioPlayerStatus(player);
 useEffect(()=>{if(CLOUD_MODE&&status.error)void cloudAccess.response('/access',{}).catch(()=>{});},[status.error]);
 const active=useRef(true),started=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const[error,setError]=useState(''),[finished,setFinished]=useState(false);
 useEffect(()=>{
  active.current=true;
  const stop=()=>{active.current=false;clearTimeout(timer.current);try{player.pause();}catch{}try{player.replace(null);}catch{}};
  stopRef.current=stop;
  try{player.replace(privateAudio.source);}catch{stop();setError('试听加载失败，请重试。');}
  timer.current=setTimeout(()=>{if(active.current&&!started.current){stop();setError('试听加载失败，请重试。');}},12000);
  return()=>{stop();if(stopRef.current===stop)stopRef.current=()=>{};};
 },[player,voice,stopRef,privateAudio.source]);
 useEffect(()=>{
  if(!active.current)return;
  if(status.error){stopRef.current();setError('试听加载失败，请重试。');return;}
  if(status.isLoaded&&!started.current){
   started.current=true;clearTimeout(timer.current);
   try{player.shouldCorrectPitch=true;player.setPlaybackRate(1,'high');player.play();}catch{stopRef.current();setError('试听加载失败，请重试。');}
  }
  if(status.didJustFinish&&started.current){stopRef.current();setFinished(true);}
 },[player,status.error,status.isLoaded,status.didJustFinish,stopRef]);
 return <View style={{gap:8}}>{error?<><Copy accessibilityRole="alert" style={{fontSize:17,color:C.error}}>{error}</Copy><SmallButton title={'重试试听 '+voice} onPress={onRetry}/></>:finished?<><Copy style={{fontSize:17,color:C.muted}}>试听结束 · {voice}</Copy><SmallButton title={'试听 '+voice} onPress={onRetry}/></>:<><Copy accessibilityLiveRegion="polite" style={{fontSize:17,color:C.muted}}>{status.playing?'正在试听 '+voice+' · 1.0倍':status.isBuffering?'正在缓冲 '+voice+'…':'正在加载 '+voice+'…'}</Copy><SmallButton title="停止试听" onPress={onStop}/></>}</View>;
}

export function VoiceChoice({value,onChange,disabled=false}:{value:Voice;onChange:(voice:Voice)=>void;disabled?:boolean}){
 const[focus,setFocus]=useState<Voice|null>(null),[attempt,setAttempt]=useState<{voice:Voice;id:number}|null>(null);
 const stopRef=useRef<()=>void>(()=>{}),sequence=useRef(0);
 function stop(){stopRef.current();setAttempt(null);}
 function preview(){stopRef.current();setAttempt({voice:value,id:++sequence.current});}
 function choose(voice:Voice){if(disabled||voice===value)return;stop();onChange(voice);}
 useEffect(()=>{stopRef.current();setAttempt(null);},[value]);
 useEffect(()=>()=>{stopRef.current();},[]);
 return <View style={{gap:12}}>
  <View accessibilityRole="radiogroup" accessibilityLabel="音色" style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}>{(['Emilien','Serena','Cherry'] as const).map(voice=><Pressable key={voice} accessibilityRole="radio" accessibilityLabel={voice} aria-checked={value===voice} aria-disabled={disabled} accessibilityState={{checked:value===voice,disabled}} disabled={disabled} onPress={()=>choose(voice)} onFocus={()=>setFocus(voice)} onBlur={()=>setFocus(null)} {...(Platform.OS==='web'?{onKeyDown:(e:any)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();choose(voice);}}}:{})} style={{flex:1,minWidth:85,minHeight:44,paddingVertical:9,paddingHorizontal:6,justifyContent:'center',alignItems:'center',borderWidth:1,borderRadius:9,borderColor:value===voice?C.blue:C.line,backgroundColor:value===voice?C.soft:C.paper,opacity:disabled?0.5:1,outlineStyle:'solid',outlineWidth:focus===voice?2:0,outlineOffset:2,outlineColor:C.blue}}><Copy style={{fontSize:17,color:value===voice?C.blue:C.ink,fontWeight:value===voice?'700':'400'}}>{voice}</Copy></Pressable>)}</View>
  <Copy style={{fontSize:17,lineHeight:27,color:C.muted}}>选择后保存音色偏好；当前练习使用所选音色，缺少音频时需点击准备。试听使用已保存的维修语音留言，以1.0倍播放，不记录答题结果。</Copy>
  {attempt?<Sample key={attempt.id} voice={attempt.voice} stopRef={stopRef} onStop={stop} onRetry={preview}/>:<SmallButton title={'试听 '+value} onPress={preview}/>}
 </View>;
}
