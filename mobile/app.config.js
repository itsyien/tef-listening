const {applyReleaseConfig}=require('../scripts/release-config.cjs');
module.exports=({config})=>applyReleaseConfig(config,process.env);
