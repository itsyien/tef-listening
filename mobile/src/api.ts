import AsyncStorage from '@react-native-async-storage/async-storage';
import {createCloudAccess} from './cloud-access';
export type Voice='Emilien'|'Serena'|'Cherry';
import type {Question,Choice} from '../../shared/question';
export const API=process.env.EXPO_PUBLIC_API_URL??(__DEV__?'http://127.0.0.1:8091':'');
export const CLOUD_MODE=process.env.EXPO_PUBLIC_CLOUD_MODE==='1';
export const cloudAccess=createCloudAccess(API,AsyncStorage);
export const sessionStorageKey=(key:string)=>CLOUD_MODE?cloudAccess.sessionKey(key):key;
export function audioSource(path:string){return CLOUD_MODE?{uri:API+path,headers:cloudAccess.headers()}:API+path;}
export async function audioResponse(path:string){return cloudAccess.response(path);}
export interface Answer{reviewMode?:boolean;choice:Choice;result:'correct'|'wrong'|'not-heard';correct:boolean|null;assisted:boolean;at:number;playback?:{ratesUsed:number[];rateAtSubmission:number;voicesUsed?:Voice[];voiceAtSubmission?:Voice};presentationMode?:'after-audio'|'immediate'}
export interface Session{reviewMode?:boolean;reviewOf?:string;voice:Voice;voiceEpoch:number;id:string;questionId:string;ended:boolean;first:Answer|null;assisted:boolean;playbackRate:number;questionDisplay:'after-audio'|'immediate'}
export interface VoiceStatus{voice:Voice;voiceEpoch:number;state:'ready'|'missing'|'preparing'|'failed'|'busy';audioPath:string|null;error:string|null}
export interface Feedback{first:Answer|null;latest:Answer|null;question:Question;events:{kind:string;created:number}[]}
export type PublicQuestion=Pick<Question,'id'|'version'|'question'>&{options:Pick<Question['options'][number],'id'|'text'>[]};
export interface NextStatus{jobId:string|null;state:string;questionId:string|null;error:string|null}
export interface Review{category:'wrong'|'not-heard'|'assisted';resolved:boolean;practiceCount:number;latestReview:Answer|null;titleZh:string;sessionId:string;questionId:string;first:Answer}
export async function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 if(!API)throw Error('服务地址尚未配置，请先配置学习服务。');
 const response=CLOUD_MODE?await cloudAccess.response(path,body,signal):await fetch(API+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal??AbortSignal.timeout(12000)});
 const value=await response.json();if(!response.ok)throw Error(value.error??'保存失败，请重试');return value;
}
