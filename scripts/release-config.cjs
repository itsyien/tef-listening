const {isIP}=require('node:net');
function applyReleaseConfig(config,env){
 const raw=env.EXPO_PUBLIC_BASE_PATH||'',base=raw==='/'?'':raw.replace(/\/$/,'');
 if(base&&!/^\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base))throw Error('Pages base path must be one repository path, such as /repository-name.');
 if(env.TEF_RELEASE==='1'){
  let api;try{api=new URL(env.EXPO_PUBLIC_API_URL);}catch{throw Error('Release requires an explicitly configured HTTPS backend URL.');}
  const host=api.hostname.replace(/^\[|\]$/g,'');if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||isIP(host)||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw Error('Release backend must be an HTTPS domain without credentials, query or fragment; localhost/IP development targets are forbidden.');
 }
 return {...config,...(base?{experiments:{...config.experiments,baseUrl:base}}:{})};
}
module.exports={applyReleaseConfig};
