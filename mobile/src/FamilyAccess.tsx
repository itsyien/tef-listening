import React,{useEffect,useState}from'react';
import{View,TextInput,Platform}from'react-native';
import{CLOUD_MODE,cloudAccess,audioSource,audioResponse}from'./api';
import{Copy,Button,C,styles}from'./ui';
export function FamilyAccess({children}:{children:React.ReactNode}){
 const[ready,setReady]=useState(!CLOUD_MODE),[unlocked,setUnlocked]=useState(!CLOUD_MODE),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!CLOUD_MODE)return;const remove=cloudAccess.subscribe(()=>{setUnlocked(cloudAccess.isUnlocked());if(!cloudAccess.isUnlocked())setError('访问码无效或已更换，请重新输入。');});void cloudAccess.initialize().then(()=>{setUnlocked(cloudAccess.isUnlocked());setReady(true);}).catch(()=>{setError('无法读取本机存储，请重新打开。');setReady(true);});return remove;},[]);
 async function unlock(){if(busy)return;setBusy(true);setError('');try{await cloudAccess.unlock(code);setCode('');setUnlocked(true);}catch(e){setError(e instanceof Error?e.message:'暂时无法连接，请重试。');}finally{setBusy(false);}}
 if(ready&&unlocked)return <>{children}</>;
 return <View style={{flex:1,backgroundColor:C.bg,justifyContent:'center',padding:24,alignItems:'center'}}><View style={[styles.card,{width:'100%',maxWidth:480}]}><Copy style={styles.heading}>TEF法语学习</Copy><Copy>输入私人访问码，即可在电脑和手机同步学习。</Copy>{ready?<><TextInput accessibilityLabel="私人访问码" value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} onSubmitEditing={()=>void unlock()} style={{minHeight:48,borderWidth:1,borderColor:C.line,borderRadius:8,padding:12,fontSize:20,color:C.ink}}/><Button title={busy?'正在连接…':'打开学习'} disabled={busy||!code.trim()} onPress={()=>void unlock()}/><Copy style={{fontSize:15,color:C.muted}}>访问码会保存在本机。请只在自己的设备上使用；浏览器本机存储可被本站脚本读取。</Copy></>:<Copy>正在打开…</Copy>}{!!error&&<Copy accessibilityRole="alert" style={{color:C.error}}>{error}</Copy>}</View></View>;
}
// Expo web's HTMLAudioElement cannot attach headers; fetch a private blob before replacing the source.
export function usePrivateAudio(path:string){
 const[source,setSource]=useState<ReturnType<typeof audioSource>|null>(()=>CLOUD_MODE&&Platform.OS==='web'?null:audioSource(path));
 const[error,setError]=useState('');
 useEffect(()=>{setError('');if(!CLOUD_MODE||Platform.OS!=='web'){setSource(audioSource(path));return;}let active=true,url='';setSource(null);void audioResponse(path).then(async response=>{if(!response.ok)throw Error('音频加载失败，请重试。');const blob=await response.blob();if(!active)return;url=URL.createObjectURL(blob);setSource(url);}).catch(()=>{if(active)setError('音频加载失败，请重试。');});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[path]);
 return {source,error};
}
