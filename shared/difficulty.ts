export interface DifficultyState {enabled:boolean;step:number;streak:number}
export function observeDifficulty(state:DifficultyState,answer:{correct:boolean|null;assisted:boolean}):DifficultyState{
 if(!state.enabled||answer.assisted||answer.correct===null)return {...state,streak:0};
 const sign=answer.correct?1:-1,streak=Math.sign(state.streak)===sign?state.streak+sign:sign;
 if(Math.abs(streak)<4)return {...state,streak};
 return {...state,step:Math.max(-2,Math.min(2,state.step+sign)),streak:0};
}
export function difficultyProfile(step:number){return {step,goal:'NCLC5-learning',maxScriptCharacters:400+50*step,scope:step<0?'familiar situation, shorter clauses and explicit relationships':step>0?'familiar situation, modest paraphrase and one extra relevant detail':'familiar situation, moderate paraphrase',officialCalibration:false};}
