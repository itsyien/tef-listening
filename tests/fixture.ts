// TEST FIXTURE ONLY. Never used by production UI, generation or startup.
export const fixture = {
 titleZh:'图书馆通知领取预订图书',id:'test-original-library', version:1, kind:'voicemail', skill:'condition', target:'NCLC5-learning',
 script:"Bonjour, c'est la bibliothèque. Le livre que vous avez réservé est arrivé. Nous le gardons jusqu'à vendredi. Si vous ne pouvez pas venir, appelez-nous avant jeudi soir pour prolonger la réservation. Sinon, il sera proposé à un autre lecteur.",
 question:"Que doit faire la personne pour garder sa réservation si elle ne peut pas venir cette semaine ?",
 options:[
 {id:'A',text:"Téléphoner avant jeudi soir.",explanationZh:"正确：无法本周来取时，需要在周四晚上之前打电话延长预留。",evidence:"appelez-nous avant jeudi soir pour prolonger la réservation."},
 {id:'B',text:"Passer à la bibliothèque vendredi soir.",explanationZh:"周五是保留截止时间，不是无法到场时的处理办法。",evidence:"Nous le gardons jusqu'à vendredi."},
 {id:'C',text:"Attendre qu'un autre lecteur la contacte.",explanationZh:"另一个读者只会在未延长时获得这本书，并不会联系本人。",evidence:"Sinon, il sera proposé à un autre lecteur."},
 {id:'D',text:"Réserver un autre livre dès son arrivée.",explanationZh:"书已到馆，但原文没有要求重新预约另一本书。",evidence:"Le livre que vous avez réservé est arrivé."}],
 correctOptionId:'A', rationaleZh:"要同时理解无法前往的条件、截止时间和延长预留的行动，不能只听到星期五就作答。"
} as const;
export const audit = {approved:true,checks:{naturalFrench:true,appropriateLearningDifficulty:true,uniqueAnswer:true,paraphrase:true,plausibleDistractors:true,noKeywordShortcut:true,exactEvidence:true,accurateChinese:true,original:true},reasonZh:'原创日常语音留言，条件与行动对应，四选项分别解释。',optionChecks:[{id:'A',defensible:true,reasonZh:'正确行动与条件一致。'},{id:'B',defensible:false,reasonZh:'混淆截止时间与不能来时的操作。'},{id:'C',defensible:false,reasonZh:'读者不是联系的主体。'},{id:'D',defensible:false,reasonZh:'没有再次预约的依据。'}]};
