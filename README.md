# HomeLedger / 家庭记事账本

HomeLedger 是一个本地优先的家庭收支与生活事件桌面应用。核心数据默认写入用户电脑上的 SQLite 数据库；财务金额使用整数最小货币单位，语言模型不参与最终金额计算。

## 当前状态

项目正在按 [PLAN.md](./PLAN.md) 分阶段实现。规划、基础架构、收支核心、日历/周期提醒、确定性报告、本地 AI 与税务整理的主要代码已经落地；当前处于 Phase 6 数据安全、质量与发布验证：

- Tauri 2、React 19、TypeScript strict、Vite 与 Tailwind CSS 4
- shadcn/ui 应用壳、响应式侧栏、浅色/深色主题和中英文基础
- Rust + SQLx SQLite 初始化与五份版本化迁移
- repository → application service → Tauri command → typed frontend gateway 分层
- 本地设置读取、验证与保存；浏览器模式提供隔离的开发预览 adapter
- Vitest、ESLint、Prettier、Rust 单元/集成测试源码和数据库迁移检查
- 收入、支出、转账 CRUD；批量编辑只更新勾选的分类、支付方式、成员、状态或税务标签，逐笔报告版本冲突，并可按一次操作安全撤销
- 分类、支付方式、家庭成员、地点、交易模板和需确认的历史建议
- 可安全加载和移除的示例数据模式；示例批次不会覆盖用户记录
- FullCalendar 月/周/日视图、普通/重要事件 CRUD、每日交易与事件详情；日期详情可保存带乐观版本的生活备注，并通过同一安全托管流程关联附件
- 设置页可按事件类型统一自定义日历颜色，配置保存到本地 typed settings；月/周/日/年概览共享颜色，支持一键恢复默认，单个事件仍可覆盖颜色
- 事件与交易多对多关联；日期格按币种显示实际收支，不混加不同币种
- 日/周/月/季度/年周期账单，支持间隔、结束日期、次数和提前提醒
- 周期全天事件与严格白名单的自定义 RRULE，适用于生日、报税日、续费和保养
- 周期账单幂等生成 Planned 交易；确认付款前不计入实际支出
- 即将到期提醒、忽略/投递日志与 Tauri Windows 桌面通知权限流程
- 统一的确定性财务汇总服务与真实 Dashboard：本月/本年收支、净结余、环比、年度趋势、分类汇总和近期事项
- 汇总只计入已完成的收入/支出；计划、待确认、已取消、转账和未换算外币不会被错误计入
- 可选择月份或年份的真实报告页：期间对比、每日/每月趋势、分类、支付方式、家庭成员与最大支出
- Dashboard 与报告显示确定性审核候选：可能重复、高额、缺附件、未分类及可能涉及税务；提示不会自动修改记录
- 报告中的审核候选可确认或忽略；处理状态只写入本地审核记录，原交易金额和分类保持不变
- 报告区分周期固定支出与非周期支出，并允许保存带版本检查和审计记录的月度/年度用户说明
- 报告支持 CSV、Excel 和系统打印：CSV 保留精确最小货币单位，Excel 提供摘要公式与多工作表，Windows 打印对话框可保存为 PDF
- 设置页支持 Ollama 与 LM Studio/OpenAI-compatible 本地配置、模型列表连接测试、超时和上下文上限；AI 关闭或不可用不会阻断核心功能
- 月度/年度报告支持显式确认聚合范围后生成 AI 文字总结；每次生成保留输入哈希和独立版本，并可编辑、标记已审核或拒绝
- 收支页支持安全自然语言查询：本地模型只把问题转换为白名单过滤计划，用户检查并确认后才由现有参数化查询执行；模型不能生成或执行 SQL
- 页头全局搜索覆盖账目、事件、普通/税务标签和附件名，结果按类型分组分页；点击结果可打开对应账目、事件或附件所属记录
- 日历支持 12 个月年度概览，使用图标和文字计数标记重要事件、账单/税务日期与待处理提醒；月份卡片可用键盘打开月视图
- 交易行支持按需生成分类、税务标签候选和异常解释；建议只进入待审核队列，接受时重新验证交易版本及允许值，拒绝和接受均保留审计记录
- 税务整理页支持 Canada/Ontario 默认资料配置、年度收入与候选支出汇总、缺收据/待复核提示、人工与自定义税务标签、CSV/Excel 年度资料包及打印/PDF 摘要
- CSV 导入支持方言检测、字段映射、逐行校验、重复候选确认和整批撤销
- 交易与事件支持附件：桌面端原生选择文件后复制到应用托管目录，校验 25 MiB 上限、允许的文件类型、SHA-256 与安全相对路径；打开和移除只接受逻辑记录 ID
- 完整备份支持版本化归档、SQLite 一致性快照、逻辑 JSON、附件、校验、恢复前恢复点、重启原子切换和失败回滚
- Windows 桌面 E2E 使用 WebDriverIO + Tauri debug build 覆盖真实 SQLite CSV 导入、通知权限/投递命令、备份暂存与跨重启恢复
- 设置页可启用后台计划备份，配置 1–365 天间隔及保留 1–100 份；保留策略只清理旧的计划备份

## 环境要求（Windows 11）

- Node.js 24+
- pnpm 11+
- Rust stable MSVC toolchain
- Visual Studio C++ Build Tools
- Microsoft Edge WebView2 Runtime

安装依赖：

```powershell
pnpm install
```

## 开发

仅启动浏览器开发预览：

```powershell
pnpm dev
```

启动 Tauri 桌面应用：

```powershell
pnpm tauri dev
```

浏览器预览不会访问真实 Tauri 数据库，它只在浏览器 `localStorage` 中保存一份隔离的设置数据，便于 UI 自动化验证。桌面运行时会使用应用数据目录中的 `home-ledger.sqlite3`。

## 质量检查

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:desktop:e2e
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

数据库迁移位于 `src-tauri/migrations/`。迁移集成测试会在临时目录建立全新数据库并检查 seed 与外键状态。

`pnpm test:desktop:e2e` 会构建带 `desktop-e2e` feature 的 Tauri debug 应用，使用隔离 identifier `com.homeledger.desktop-e2e` 和隔离 app data 目录，不会触碰正式 `com.homeledger.app` 数据。脚本只在测试运行期间把 WDIO capability 临时复制到 `src-tauri/capabilities`，结束后自动清理；CSV 导入的文件选择器通过 desktop-e2e-only hook 指向 `tests/fixtures/desktop-import.csv`，导入解析、数据库写入、通知命令和备份恢复仍走真实 Tauri/Rust 路径。日志与截图写入 `artifacts/desktop-e2e/`。

当前开发环境已验证 Rust 编译与测试。若组织策略禁止执行 Cargo 生成的临时 build-script，应在允许本地编译的开发机或 CI 中运行测试；应用运行时不需要因此放宽权限。

## 离线、权限与无障碍边界

- 核心收支、日历、报告、导入、导出和备份不加载远程脚本、字体或图片，也不包含遥测或自动云同步。
- 可选 AI 地址只接受 `localhost`、回环 IPv4 或回环 IPv6；桌面 HTTP 客户端禁用系统代理和重定向。
- 外部网页仅有用户主动点击的 CRA 官方参考，并通过 Tauri scope 限制为 `https://www.canada.ca/*`。
- 桌面 capability 只开放 CSV 文件选择、报表保存、官方链接和实际使用的通知命令；不开放任意文件读取或目录揭示。
- 页面语言随中英文设置同步；主路由的可见输入均有 label 或 ARIA 名称。收支表行支持 `↑`、`↓`、`Home`、`End` 键移动焦点，危险操作仍需明确确认。

## 示例数据模式

在“设置 → 示例数据模式”中明确确认后，可加载 10 条本地示例交易，覆盖普通月份、旅行、计划房租、USD 外币、税务候选和异常高额记录。

- 示例交易使用独立批次标记，不会修改或覆盖已有记录。
- 移除操作需要再次确认，只软删除示例批次；普通用户记录不受影响。
- 如果编辑过示例交易，相关修改会随该示例批次一起移除。
- 税务示例只显示候选提示，仍需用户或专业人士确认。

## 日历、周期账单与提醒

“家庭日历”支持月、周、日视图。点击日期可查看当天事件和交易；编辑事件时可关联事件日期范围内的交易。

周期账单的生成规则：

- 自动或手动物化只创建 `Planned` 交易，重复启动不会重复创建同一 occurrence。
- Planned/Pending/Cancelled 与转账均不计入实际收入或支出。
- 付款后在收支记录中将状态明确改为 `Completed`，系统才保存报表金额并纳入统计。
- 停用周期项目只停止未来生成，不删除已有记录。
- 应用启动时会补查并物化计划记录；已有通知权限时会投递已到期提醒。

周期账单与周期事件还支持自定义 RRULE。MVP 只接受以下字段：`FREQ`、`INTERVAL`、`BYDAY`、`BYMONTHDAY`、`BYMONTH`、`COUNT`、`UNTIL`；未知字段或不支持的频率会被拒绝，模型和用户输入都不能绕过验证。周期事件当前生成全天事件，历史 occurrence 不会因之后修改模板而被静默重写。

桌面通知使用 Tauri notification 插件。浏览器预览只显示提醒数据，不请求系统权限；Windows 原生通知应在安装后的应用中验证。

## 报告导出

在“财务报告”中选择月份或年份后，可以导出当前报告：

- CSV 使用 UTF-8 BOM，金额列保存整数最小货币单位；商家和备注等文本会防止电子表格公式注入。
- Excel 包含摘要、实际交易、分类、支付方式和家庭成员工作表；摘要金额公式引用实际交易表，便于核对。
- CSV 与 Excel 只包含所选基础币种下的 `Completed` 收入/支出；Planned、Pending、Cancelled 和 Transfer 不会进入导出。
- 导出先完整生成文件，再原子替换目标；写入失败不会留下看似成功的残缺文件。
- “打印 / 保存 PDF”调用系统打印功能。在 Windows 中可选择 Microsoft Print to PDF；安装包环境验证保留到发布阶段。

浏览器开发预览支持 CSV 下载。Excel 和原生系统保存对话框需要在 Tauri 桌面应用中使用。

## CSV 导入

在“收支记录 → 导入 CSV”打开本地向导：

1. 使用系统文件选择器选择 UTF-8 或 UTF-8 BOM 的 `.csv` 文件；系统自动检测逗号、分号或制表符。
2. 预览列名和样例行，并映射日期、金额、商家、备注、收入/支出类型、币种及统一支付方式。
3. 选择日期格式与金额正负规则。金额直接解析为整数最小货币单位，不经过浮点数。
4. 检查无效行和潜在重复；重复判断使用日期、类型、整数金额、币种和规范化商家，默认跳过。
5. 明确勾选最终确认后才写入数据库。提交时会重新验证全部行，避免预览后数据状态变化。
6. 完成后可整批撤销；撤销使用软删除并保留导入批次与审计记录。

首版单文件上限为 25 MiB / 100,000 数据行，不会自动换汇。若某行币种不是所选默认币种，该行会被标记为无效，等待用户先完成可靠换算。浏览器开发预览不会读取任意本地文件路径；实际导入仅在 Tauri 桌面应用中执行，文件不会上传。

## 完整备份与恢复

“备份与恢复”创建版本化 `.homeledger-backup` 归档，保存在应用数据目录的 `backups` 文件夹。归档包含一致性 SQLite 快照、可检查的完整逻辑 JSON、数据库中仍有效的托管附件和 manifest；复制中的临时文件与孤儿文件不会进入备份。manifest 为每个文件记录大小与 SHA-256。

恢复前会重新校验归档、数据库 `integrity_check`、外键和 schema 兼容性，并自动创建 `pre_restore` 备份。用户必须输入 `RESTORE` 才会暂存恢复；运行中的数据库不会被覆盖。关闭并重新打开应用后才进行同目录原子切换，恢复时会把旧主库及 `-wal`/`-shm` sidecar 一并移入回滚区，避免旧 WAL 重放污染恢复后的快照；恢复后的数据库若无法启动会自动回滚。恢复来源与恢复前备份会重新登记到历史中。损坏、缺文件、路径不安全或版本过新的备份会被拒绝。

自动备份默认关闭。在“设置 → 自动定期备份”启用后，应用每次启动会在后台检查距离上次成功计划备份是否已达到设定天数；备份不会阻塞首屏。可保留 1–100 份成功的计划备份，超额时从最旧计划备份开始清理。手动备份和 `pre_restore` 恢复点不受自动清理影响。

## 税务资料整理与导出

“税务资料整理”按年度读取已完成的实际收入和支出。Planned、Pending、Cancelled 与 Transfer 不进入税务金额；不同报告币种不会在没有明确换算结果时混加。

- “可能涉及税务”规则和已确认税务标签只会生成候选清单，不会自动判断抵扣资格。
- 人工添加或移除标签会增加交易版本并写入审计事件，但不会修改日期、金额、币种、分类或备注。
- 选择“不涉及税务”或“个人支出”会把已人工复核的提示从候选金额中排除；选择“需要检查”则继续保留待复核状态。
- 标签汇总允许一笔交易有多个标签，因此各标签金额可能重叠，不能直接相加。
- CSV 使用整数最小货币单位并防止公式注入；Excel 包含 Summary、Income、Tax Candidates、Tag Totals、Missing Receipts 与 Attachments 六个工作表，摘要公式引用明细表。
- 页面可调用系统打印功能保存 PDF 摘要；Windows 安装环境中的打印流程保留到 Phase 6 发布验证。
- CRA 参考链接仅用于帮助人工检查。税务资格与保存期限应以 CRA 最新资料及专业意见为准。

## 生产构建

前端构建：

```powershell
pnpm build
```

构建 Windows x64 MSI 与 NSIS：

```powershell
pnpm tauri build
```

产物位于：

- `src-tauri/target/release/bundle/nsis/HomeLedger_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/HomeLedger_<version>_x64_en-US.msi`

NSIS 默认为当前用户安装，写入 `%LOCALAPPDATA%\HomeLedger`，无需管理员权限；MSI 面向全机安装，写入 `Program Files`，需要管理员权限。无界面部署可使用 `HomeLedger_<version>_x64-setup.exe /S`。正式分发前仍应配置可信代码签名证书。

Phase 6 已在干净的当前用户环境完成 0.1.0 安装、冷启动、临时 0.1.1 覆盖升级和卸载演练：注册版本正确更新，卸载删除程序与注册项，但不会删除 `%APPDATA%\com.homeledger.app` 中的数据库；升级和卸载前后数据库 SHA-256 保持一致。MSI 已成功构建并验证安装日志；无提升权限会按 Windows 预期以 Error 1925 拒绝全机安装。

## macOS 构建与发布验证

macOS 的构建入口位于 `.github/workflows/macos-release.yml`。在 macOS 14 runner 上会安装 universal Apple Rust target，运行 TypeScript、ESLint、Vitest 和离线 Tauri 构建，检查生成 `.app` 的 bundle identifier 必须为 `com.homeledger.app`，再用 [`scripts/macos_offline_smoke.sh`](./scripts/macos_offline_smoke.sh) 在隔离 HOME 中启动应用并确认本地 SQLite 已创建。当前 Windows 环境不能代替 macOS runner、Apple 签名证书或公证服务完成这一步。

推送版本 tag 后，workflow 的签名任务使用以下 GitHub Actions secrets：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD` 和 `APPLE_TEAM_ID`。签名/公证任务只创建 draft prerelease，发布前仍需在干净 macOS 用户目录执行核心离线启动、SQLite 初始化、备份恢复和卸载数据保留检查。

## Android / Google Play 构建与发布验证

Android 发布验证入口位于 `.github/workflows/android-play-verify.yml`。该工作流在干净的 Linux runner 中安装 JDK、Android API 35、NDK 与 Rust Android targets，生成 Tauri Android 工程，运行 TypeScript、ESLint、Vitest，并构建未签名 AAB artifact；它不会使用或要求任何签名密钥。可在本机先运行 `pnpm android:verify` 检查 JDK、SDK/NDK、环境变量和 Rust targets，再运行 `pnpm android:init` 与 `pnpm android:build:aab`。

签名、Play App Signing、Data safety 声明、隐私政策、Console listing 与内部测试的发布前记录，见 [Google Play 发布与验证清单](./docs/GOOGLE_PLAY_REVIEW.md)。未签名 CI artifact 不能上传 Google Play；必须由发布负责人使用受控的 upload key 签名后提交。

## 本地 AI

本地 AI 是可选功能。可在“设置 → 本地 AI”配置 Ollama 或 OpenAI-compatible loopback API（包括 LM Studio），填写模型名称、超时和最大上下文长度，并在保存前测试连接。未安装模型时，收支、日历和报告仍正常工作。

- 默认只允许 `localhost`、`127.0.0.1` 或 `::1` 地址。
- Ollama 连接测试读取 `/api/tags`；OpenAI-compatible 连接测试读取 `/v1/models`。测试不发送账目、事件或附件。
- 桌面端连接不使用系统代理、不跟随重定向，并限制模型列表响应大小；配置中不允许嵌入凭据、查询参数或任意路径。
- AI 只生成总结或建议，不计算最终金额。
- AI 总结默认只接收所选期间与上一期间的程序聚合结果，不接收商家、备注、附件或单笔交易 ID；生成内容出现聚合快照中不存在的数字时会被拒绝保存。
- 每次生成都会创建新的 `ai_summaries` 与 revision 记录，不覆盖旧版本或用户填写的报告说明。
- 分析具体交易前会列出日期、金额、商家、备注等发送范围并要求逐次确认。模型只能返回现有分类/税务标签 ID；分类和税务建议在用户点击“确认并应用”前不会改变事实数据。
- 自然语言查询默认只发送问题、当前日期、时区和启用的分类/支付方式/成员/地点名称，不发送交易记录。模型必须返回版本化 JSON 过滤计划；未知字段、虚构 ID、越界日期/金额/数量以及 SQL、路径或网络文本会被 Zod 和 Rust 拒绝。通过验证的计划仍需用户确认，随后仅转换为 `ListTransactionsInput` 并复用 SQLx 参数绑定。
- 税务建议始终是整理候选，界面固定显示“可能符合条件 · 需专业确认”；接受建议也不会形成抵税结论或修改金额。
- 分类和税务建议必须经用户确认后才会成为事实数据。
- 税务候选提示统一表述为“可能符合条件 · 需专业确认”，不构成抵税结论。

## 文档

- [实施计划](./PLAN.md)
- [架构设计](./ARCHITECTURE.md)
- [数据模型与 ERD](./DATA_MODEL.md)
- [需求差距审计](./REQUIREMENTS_AUDIT.md)
- [视觉系统](./design/DESIGN_SYSTEM.md)

## 税务免责声明

HomeLedger 只能帮助整理记录、分类和生成候选清单，不能保证某项支出可以抵税，也不能代替会计师或税务专业人士。最终税务处理必须由用户或专业人士确认。
