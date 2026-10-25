import{test}from'node:test';import assert from'node:assert/strict';
import{fixture}from'./fixture.ts';import{validateCritic}from'../server/quality-critic.ts';import{validateQuestion}from'../shared/question.ts';
test('internal French critic rationale is valid while learner Chinese explanations remain mandatory',()=>{
 const review:any={approved:true,answerId:'A',ambiguous:false,frenchIssues:[],questionIssues:[],shortcutRisk:false,paraphrase:true,difficultyAppropriate:true,criterionReasons:{paraphrase:'Le sens est reformulé et les preuves sont exactes.',shortcutRisk:'Les autres choix proposent des confusions du message.',difficultyAppropriate:'Une condition concrète dans une situation quotidienne.'},optionChecks:fixture.options.map((o,i)=>({id:o.id,status:i===0?'entailed':'contradicted',evidence:o.evidence,reasonZh:'Ce choix correspond au sens de la preuve citée.',plausible:true,misreading:i===0?'none':'condition'}))};
 assert.equal(validateCritic(review,fixture,true).approved,true);
 const invalid:any=structuredClone(fixture);invalid.options[0].explanationZh='French explanation only';assert.throws(()=>validateQuestion(invalid));
 review.optionChecks[1].evidence='Invented unsupported citation';assert.throws(()=>validateCritic(review,fixture,true));
});
