import {test} from 'node:test'; import assert from 'node:assert/strict'; import {fixture,audit} from './fixture.ts';
test('rejects false evidence, oversized script and duplicate options before synthesis',async()=>{
 const {validateQuestion}=await import('../shared/question.ts');
 assert.equal(validateQuestion(fixture).correctOptionId,'A');
 for(const bad of [{...fixture,script:'x'.repeat(501)},{...fixture,options:fixture.options.map((o,i)=>i===0?{...o,evidence:'invented quotation'}:o)},{...fixture,options:fixture.options.map((o,i)=>i===1?{...o,text:fixture.options[0].text}:o)}]) assert.throws(()=>validateQuestion(bad));
});
test('audit fails closed when any quality check or independent answer disagrees',async()=>{
 const {validateAudit,validateQuestion}=await import('../shared/question.ts');const q=validateQuestion(fixture);
 assert.equal(validateAudit(audit,q).approved,true);
 assert.throws(()=>validateAudit({...audit,checks:{...audit.checks,noKeywordShortcut:false}},q));
 assert.throws(()=>validateAudit({...audit,optionChecks:audit.optionChecks.map(o=>({...o,defensible:o.id==='B'}))},q));
 assert.throws(()=>validateAudit({...audit,checks:{...audit.checks,naturalFrench:'true'}},q));
});

