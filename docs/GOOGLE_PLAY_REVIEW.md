# Google Play 发布与验证清单

HomeLedger 的 Android 版本必须保持本地优先：账目、附件、备份和本地 AI 请求均保留在用户设备上。本文用于在提交 Google Play 前完成可审计的工程与 Console 验证；它不替代 Google Play Console 中的最终声明。

## 当前工程状态

- Android 工程由 `pnpm tauri android init --ci` 生成，不手工维护生成目录。
- GitHub Actions 工作流会在干净的 Linux 环境中生成 Android 工程、运行前端质量检查并构建**未签名** AAB。
- 本机尚未验证 AAB：需要先安装 JDK、Android SDK/NDK 和 Rust Android targets。运行 `pnpm android:verify` 可得到具体缺失项。
- 不要提交 keystore、`key.properties`、Google Play 服务账号密钥或任何生产凭据。

## 本机验证

Android Studio 中安装 Android SDK Platform 35、Build Tools、NDK 和 Command-line Tools 后，设置 `JAVA_HOME`、`ANDROID_HOME` 与 `NDK_HOME`。再运行：

```powershell
pnpm android:verify
pnpm android:init
pnpm android:verify:initialized
pnpm android:build:aab
```

构建成功后的 universal AAB 位于：

```text
src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

Tauri 的 Android 依赖与构建步骤以其官方文档为准：[Android prerequisites](https://v2.tauri.app/start/prerequisites/)、[Google Play distribution](https://v2.tauri.app/distribute/google-play/)。

## 签名与上传

1. 在 Google Play Console 创建 app，确认 Android application ID 为 `com.homeledger.app`，并在首次提交前不要变更它。
2. 为新 app 启用 Play App Signing；妥善离线保存 upload key，并只把 CI 所需的编码后材料放入 GitHub Actions secrets。
3. 签名构建需由发布负责人在受控环境或受保护的 release workflow 中执行；此仓库的验证工作流故意只产出未签名 AAB，不能上传到 Play Console。
4. 首次上传应先走 Internal testing，确认安装、离线启动、SQLite 持久化、导入/导出、备份/恢复和本地 AI 未配置时的行为。

Google Play 对新 app 使用 Play App Signing 的要求与 upload key 管理见 [Android app signing](https://developer.android.com/studio/publish/app-signing.html)。

## Play 政策与 Console 检查

- 目标 SDK：提交时确认生成项目的 `targetSdk` 至少为 API 35。Google Play 对新 app 和更新的当前 target API 要求见 [Target API level requirements](https://developer.android.com/google/play/requirements/target-sdk)。
- Data safety：即使应用不收集数据，也要在 Console 完成声明并提供隐私政策。最终答案必须覆盖实际打包的每个 SDK 与网络行为；不可仅依据本文件推断。参阅 [Data safety form guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)。
- 隐私政策应明确：家庭财务记录与附件默认仅储存在设备；没有用户明确配置时不上传数据；本地 AI 仅访问用户配置的 loopback 服务；税务提示仅为候选项，须由用户或专业人士确认。
- 权限最小化：提交前审查生成的 `AndroidManifest.xml`，只保留功能必需权限；如未来新增崩溃分析、云同步、远程 AI 或广告 SDK，必须重新审核网络披露、隐私政策和 Data safety 表单。
- Store listing：完成应用名称、简短/完整说明、图标、手机截图、内容分级、目标受众、隐私政策 URL、联系邮箱和测试说明。

## 发布前验收记录

发布负责人应在每一次候选版本记录以下结果：

| 验证项        | 通过标准                                                 |
| ------------- | -------------------------------------------------------- |
| CI 未签名 AAB | `android-play-verification` 绿色，且 AAB artifact 可下载 |
| 签名          | Play Console 接受 upload key 签名的 AAB                  |
| API 级别      | 生成的 app `targetSdk >= 35`                             |
| 离线          | 断网后可新增、编辑、查询交易与事件                       |
| 数据安全      | Data safety、隐私政策和实际 SDK/网络行为逐项一致         |
| 恢复          | 在干净设备从完整备份恢复数据库与附件                     |
| 升级          | 从上一测试版本升级后数据、迁移和附件仍可读取             |
| 税务提示      | 所有“可能符合条件”均保留人工确认与免责声明               |

不要把测试构建、截图、Console 回答或发布结论当作法律、税务或隐私合规意见；上线前应由发布负责人和必要的专业人士复核。
