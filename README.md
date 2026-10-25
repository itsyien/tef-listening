# TEF法语学习

为家庭学习设计的中文 Expo 法语听力应用。目标是 NCLC 5 学习练习，不提供官方 TEF 模考等级或校准分数。

网页：https://itsyien.github.io/tef-listening/

Android 发行包放在 GitHub Releases。首次在自己的设备输入私人家庭访问码；访问码不在此仓库或安装包内。

## 功能

- 原创题经过格式检查、盲审、逐项证据覆盖和完整语义审核，再使用百炼北京 qwen3-tts-flash 合成法语；实际音频保存在私有存储，重播复用。
- 每次只预先准备下一道，有限修订／重新生成和调用去重；质量拒绝可恢复，不保证任意答题速度下下一题立即完成。
- 首答不可覆盖，辅助答案、没听清楚、重播／原文帮助、错题复习分别记录；两端共享学习档案。
- 音色、播放速度、出题显示时机和保守自动难度设置；错题复习复用原有题目和音频。

## 运行与验证

需要 Node.js 24。`npm ci`、`npm test`、`npm run typecheck`。

开发可用 `npm run api` 和 `npm run web`。供应商密钥仅由后端私有环境读取，不能使用 EXPO_PUBLIC_ 前缀。

正式网页通过 `.github/workflows/pages.yml` 导出并发布。公开构建变量仅含 HTTPS 后端地址、云模式和 `/tef-listening` 路径，不含供应商密钥或家庭访问码。

## 后端与隐私

独立 Supabase 项目，Edge Function 内先校验私人访问码；私有数据库、Storage、Vault 均不向匿名／authenticated 客户端开放。此部署实际使用 **Supabase Vault** 加密保存后端供应商凭据，不是 Edge Secrets。仅服务端 RPC 允许读取，网页和 APK 不持有供应商凭据。

`server/cloud/schema.sql` 和 `provider-secrets.sql` 是结构定义，不含真实凭据。原有本地 SQLite 学习历史没有上传。累计预算硬上限已取消，完整费用统计、有限重试、幂等和单题预取仍保留；API 按实际用量计费。

家庭访问码是访问和生成权限。只在自己的设备保存，不要分享；浏览器同源脚本可读取本地保存的访问码。Supabase Free 的暂停／函数运行限制可能造成恢复等待。

## Android

包名 `net.yienstudio.teflistening`。发行构建使用设备私有目录中的本地签名密钥，通过临时进程环境传入 Gradle；任何签名密钥／密码都不在仓库。维护者应安全备份原密钥以签署后续更新。

正式构建脚本会要求本地真实云端验收文件后才开始全新 release 构建。仓库不包含私人验收记录，也不会自动生成签名凭据。实体手机兼容性仍需使用者安装确认。
