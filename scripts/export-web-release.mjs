import{createRequire}from'node:module';import{spawnSync}from'node:child_process';import{resolve}from'node:path';import{writeFileSync}from'node:fs';
const require=createRequire(import.meta.url);const env={...process.env,TEF_RELEASE:'1'};delete env.DEEPSEEK_API_KEY;delete env.DASHSCOPE_API_KEY;
require('./release-config.cjs').applyReleaseConfig({},env);
const result=spawnSync(process.execPath,[resolve('node_modules/expo/bin/cli'),'export','--platform','web','--output-dir',resolve('release/web')],{cwd:resolve('mobile'),env,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);writeFileSync('release/web/.nojekyll','');console.log('Static files prepared locally. Publication still requires the approved repository and protected backend.');
