# GitHub 云端发布与 CNB 下载镜像

2026-09-13 起，GitHub 是正式发布源，CNB 是异步下载镜像。GitHub 发布成功不再等待 CNB。此约定替代历史文档中的“CNB 先发布 / 双站事务 / 本地 Parallels 为默认构建环境”。

## 日常操作

- 推送 main、codex 分支和提交 PR：GitHub `CI` 测试前端、服务端，以及 macOS ARM64、macOS Intel、Windows x64 的 Rust 单元测试。
- 网页 Actions → Release → Run workflow，默认 `publish=false`：验证三平台安装包构建，不创建 Release。
- 正式发布：先在 main 同步修改 app/package.json、package-lock.json、src-tauri/tauri.conf.json、Cargo.toml 和 Cargo.lock 中本应用版本，并添加对应的 `docs/deployment/release-X.Y.Z.md` 更新说明，然后选择 `publish=true`，或推送相同版本的 `vX.Y.Z` tag。已发布版本不可覆盖。
- GitHub 自动测试、构建三套安装包、验证签名与架构、汇总四个 updater 平台键，最后公开 Release 并设为 Latest。
- CNB 每 15 分钟匿名检查 GitHub Latest，也可在 main 分支页面点击“同步 GitHub 最新发布”或“检查镜像来源”。

## 凭据边界

CNB 凭据不得进入 GitHub 的源码、历史、Secrets、Variables、工作流输入、日志或制品；仓库中 CNB 专用脚本的 `CNB_TOKEN` 变量名不是密钥值。

GitHub 使用本次任务的 GITHUB_TOKEN 创建自己的 Release，不需要 CNB 令牌、CNB 写权限或个人 GitHub PAT。公开源码、已公开 Release 元数据与附件支持匿名读取；匿名 API 一般每出口 IP 每小时 60 次，CNB 共享出口也可能限流。脚本遇限流失败退出，下一轮重试，不自动引入凭据。

GitHub 正式发布需要以下仓库 Secrets：

| Secret | 用途 |
|---|---|
| TAURI_SIGNING_PRIVATE_KEY | 现有 Tauri updater 私钥原文，通过 GitHub Secrets 加密存储；不能换新密钥，否则已有客户端无法验证更新 |
| TAURI_SIGNING_PRIVATE_KEY_PASSWORD | 对应私钥密码 |

不要把本地 credential pack 整包上传。构建、签名和上传步骤限制到本仓受信任版本，第三方 Actions 固定完整提交 SHA。建议在仓库保护规则中限制 main、版本 tag 和工作流修改权限。

CNB 脚本仅用内置 CNB_TOKEN 写 CNB Release 和导入相应 Git tag，GitHub 网络请求不注入它。CNB 定时流水线应由拥有目标仓库代码及 Release 写权限的维护者启用。临时令牌在任务结束后销毁。无需 GitHub 凭据，也不需要 GitHub Webhook 接收服务。

## 签名、索引与镜像

- 原生包：macOS 两个薄包，Windows x64 NSIS。不构建 Universal 或 Windows ARM64。
- 当前 CI 沿用项目 ad-hoc macOS 签名，会验证资源封印与每个 Mach-O 的架构；这不等于 Apple Developer ID 签名与公证。当前工作流没有配置 Apple 公证。Windows 安装包仍使用 updater 签名，没有新增商业 Authenticode 签名。
- updater latest.json 不单独签名；里面的安装包签名保持不变，CNB 只把下载 URL 改成 CNB 地址。
- GitHub 发布时沿用上一版公开 Release 的两个已验证扩展索引，不重建扩展逻辑或大运行时；扩展版本升级仍按各模块打包流程产生新索引，当前主应用工作流不会自动发布未打包的扩展源码变更。
- GitHub 同时生成并签署 `video-editor-module-index.cnb.json(.sig)` 和 `cockroach-module-index.cnb.json(.sig)`，供 CNB 下载。CNB 验证签名以及内容与上游索引的对应关系，再将其复制为客户端使用的标准索引名。CNB 不保存签名私钥。
- 旧版本没有 `.cnb.json` 时，仅可复用已经存在且签名和内容均正确的 CNB 索引；否则明确报错，不输出无效签名。
- 镜像复制 GitHub Latest 的所有附件，包括额外的预签名 CNB 索引；唯一有意不同的标准资源是 latest.json 和两套提供商专用索引。自动生成的 GitHub Source code ZIP/TAR 不属于 Release 附件，源提交和 tag 通过 Git 导入 CNB。
- 最新索引引用的旧 tag 大文件也会补齐到对应 CNB tag，按大小和哈希跳过已有内容，不把它们复制到新的 app Release。
- 流水线从 CNB main 运行固定脚本，导入源码只推送版本 tag，不自动覆盖 CNB main，也不执行下载的源码或包。
- 上传每个文件后验证远端大小及哈希。包先于索引、latest.json 最后上传；完成后再切换 CNB Latest，在线核对 updater，最后写同步收据。收据记录上游版本和附件指纹，无变化直接退出。
- 同步任务串行加锁。同步期间上游发生变更则失败重试；旧版 CNB 继续可用。客户端通过 `app/src-tauri/src/app_update.rs` 并行查询两个固定公开清单，各限时 10 秒：版本相同优先 CNB，GitHub 版本更新则选择 GitHub；CNB 无可用更新或出错时仍检查 GitHub。GitHub 不可达时可使用 CNB 已有的可用更新；无法确认最新且没有可用更新时显示检查失败。下载和签名校验沿用 Tauri updater。此代码修正需随下一次客户端版本发布，已发布 0.1.32 仍只有原生端点失败回退。

## 故障与成本

- CNB 失败不会回滚或阻止 GitHub 发布。缺权限、匿名限流、网络错误、签名或哈希不符都会让流水线失败，并在下一周期重试。
- GitHub 发布到 draft 后失败：检查日志和草稿，不能直接重新覆盖公开版本。确认草稿来源后清理未公开草稿再重试，或使用新版本；正常重复触发会被版本检查拒绝。
- 使用标准 GitHub 托管机，公开仓库构建分钟免费。中间产物保留 3 天。CNB 检查使用 1 核，15 分钟一次，不反复拉取不变资源。
- 缓存、制品和 CNB 存储仍需在账户用量页关注；设置达到预算后停止用量，而不只是通知。

## 本地验证

```sh
npm --prefix app test -- scripts/cloud-release.test.mjs scripts/prepare-updater-release.test.mjs scripts/prepare-cnb-release.test.mjs scripts/sync-cnb-release.test.mjs
npm --prefix app run build
npm --prefix Server test
node app/scripts/mirror-github-release.mjs --dry-run
node /Users/xpy/.agents/skills/cnb-pipeline/validator/validate.js "$PWD/.cnb.yml"
node /Users/xpy/.agents/skills/cnb-pipeline/validator/validate.js "$PWD/.cnb/web_trigger.yml"
actionlint
graphify update .
```

上游文档：[GitHub 公共 Release API](https://docs.github.com/en/rest/releases/releases)、[匿名限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[CNB 定时任务](https://docs.cnb.cool/zh/build/crontab.html)、[CNB 内置令牌](https://docs.cnb.cool/zh/build/build-in-env.html#cnb_token)。
