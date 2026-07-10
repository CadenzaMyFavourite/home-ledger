# HomeLedger 视觉与交互基线

> 状态：Phase 1 实现规范  
> 概念原生尺寸：1536 × 1024  
> 原则：概念图仅作视觉基准，实际 UI、文字、图表和控件必须由 React/CSS 渲染，禁止把截图作为界面交付。

## 1. 已接受概念

| 页面/状态           | 基准文件                            | 核心组件族                               |
| ------------------- | ----------------------------------- | ---------------------------------------- |
| Dashboard 浅色      | `concepts/dashboard-light.png`      | 应用壳、摘要带、趋势图、列表、状态行     |
| Dashboard 深色      | `concepts/dashboard-dark.png`       | 深色语义 token 与对比度                  |
| 收支记录 + 添加抽屉 | `concepts/transactions-light.png`   | 数据表、筛选、批量操作、Sheet、表单      |
| 月历 + 当日详情     | `concepts/calendar-light.png`       | 月网格、日期摘要、跨日事件、详情 Sheet   |
| 月度报告 + AI 草稿  | `concepts/monthly-report-light.png` | 确定性统计、图表、可编辑 AI 草稿         |
| 税务整理 + 候选提示 | `concepts/tax-workspace-light.png`  | 免责声明、候选表、人工审核、资料包检查   |
| 设置                | `concepts/settings-light.png`       | 二级导航、横向 Field、主题、AI、备份设置 |

`calendar-light-v1.png` 与 `tax-workspace-light-v1.png` 是审计留档，不是实现基准。前者有已修正的金额不一致；后者缺少用户要求的“可能符合条件”提示。

## 2. 视觉方向

- 产品类型：数据密集但安静的本地桌面工具，不是营销站。
- 构图：固定主侧栏 + 页面标题区 + 表格/日历/报告主画布；Sheet 是主要详情/编辑容器。
- 容器：优先开放画布、细分隔线、表格和列表。只在需要分组或强调时使用轻量 surface。
- 创意强度：克制的 6–7/10；识别点来自 teal focus/selection、精确排版与跨页面一致的行结构。
- 图像：产品 UI 不需要照片、插画或装饰性 raster asset。
- 禁止：bento 卡片堆、嵌套卡片、巨大圆角容器、玻璃拟态、发光、渐变、装饰胶囊、营销 eyebrow。

## 3. 颜色锁定

### 3.1 浅色

| Token                  |    建议值 | 用途                |
| ---------------------- | --------: | ------------------- |
| `--background`         | `#ffffff` | 主画布，必须是真白  |
| `--foreground`         | `#172033` | 主文字              |
| `--surface`            | `#ffffff` | 表格/面板           |
| `--sidebar`            | `#f7f9fb` | 主侧栏              |
| `--muted`              | `#f3f6f8` | 次级表面/hover      |
| `--muted-foreground`   | `#667085` | 帮助文字            |
| `--border`             | `#dce3e8` | 细边框和分隔        |
| `--primary`            | `#087f7a` | 主操作、选中、focus |
| `--primary-foreground` | `#ffffff` | 主按钮文字          |
| `--selection`          | `#e8f4f3` | 选中行/导航背景     |
| `--ring`               | `#0b918a` | 键盘 focus ring     |
| `--income`             | `#12843b` | 收入/正向           |
| `--expense`            | `#f05a14` | 支出                |
| `--event`              | `#1976d2` | 普通事件            |
| `--important`          | `#d9364f` | 重要事件            |
| `--travel`             | `#7455d9` | 旅行                |
| `--warning`            | `#b66a00` | 提醒/待确认         |
| `--ai`                 | `#6d48c7` | AI 草稿/建议边界    |

### 3.2 深色

| Token                  |    建议值 | 用途        |
| ---------------------- | --------: | ----------- |
| `--background`         | `#0b1220` | 主画布      |
| `--foreground`         | `#f8fafc` | 主文字      |
| `--surface`            | `#111827` | 表格/面板   |
| `--sidebar`            | `#0f172a` | 主侧栏      |
| `--muted`              | `#162234` | 次级表面    |
| `--muted-foreground`   | `#9aa7b8` | 帮助文字    |
| `--border`             | `#29364a` | 细边框      |
| `--primary`            | `#28b9ae` | 主操作/选中 |
| `--primary-foreground` | `#041311` | 主按钮文字  |
| `--selection`          | `#12323a` | 选中背景    |
| `--ring`               | `#39d0c5` | focus ring  |

语义色在深色中提高明度，但不改含义。所有状态还必须有图标或文字，不能只靠颜色。

## 4. 排版

- 字体栈：`Inter`, `Noto Sans SC`, `Microsoft YaHei UI`, system-ui, sans-serif。
- 金额/日期：启用 `font-variant-numeric: tabular-nums`。
- 页面标题：26px / 1.25 / 650。
- 区域标题：18px / 1.35 / 650。
- 表格/控件：13–14px / 1.4 / 400–550；不得继承浏览器默认 16px。
- 正文：14px / 1.55。
- Caption/帮助：12–13px / 1.45。
- 金额摘要：24–28px / 1.2 / 600。
- 中英文同一行保持稳定 baseline；不使用全大写装饰标签。

## 5. 几何与节奏

- 基础间距：4px；常用节奏 4/8/12/16/24/32。
- 页面 padding：24–32px；窄窗口降至 16px。
- 控件高度：36–40px；表格行 48–56px。
- 圆角：输入/按钮 6px，面板 8px，Sheet 无夸张圆角。
- 边框：1px；阴影只用于 Sheet/Dialog 的层级，不用于每个 panel。
- 主侧栏：约 220–240px；设置二级栏约 200px。
- 详情/表单 Sheet：400–430px；内容可内部滚动。

## 6. 图标清单

- 图标库：Lucide，outline，约 1.75px stroke。
- 常用尺寸：导航 18px；行状态 16px；摘要 24–28px。
- 主导航：House、FileText、CalendarDays、Bell、ChartNoAxesCombined、ReceiptText、Cloud/Archive、Settings。
- 金额：ArrowDownCircle（收入）、ArrowUpCircle（支出）、Scale（净额）、Landmark（年度）。
- 状态：CircleCheck、Clock3、TriangleAlert、CircleX、Paperclip、LockKeyhole、ShieldCheck。
- AI：Sparkles；税务候选提示：CircleAlert/Info。
- Button/Dropdown/Sidebar 内图标遵循 shadcn 尺寸，不写独立尺寸 class；使用 `data-icon`。

## 7. 组件族

### 7.1 应用壳

- `AppShell`
- `PrimarySidebar`
- `PageHeader`
- `GlobalSearch`
- `QuickAddMenu`
- `ToastRegion`
- `GlobalErrorBoundary`

### 7.2 数据与状态

- `SummaryStrip` / `SummaryItem`
- `StatusIndicator`（icon + text，variant）
- `MoneyText`
- `DataTable` + `TableToolbar` + `Pagination`
- `FilterBuilder` / `SavedFilterMenu`
- `ReviewQueue`
- `Empty`, `Skeleton`, `Alert`, `sonner`

### 7.3 表单与覆盖层

- `Sheet`：详情和快速录入；始终有 `SheetTitle`。
- `AlertDialog`：删除/覆盖确认。
- `Dialog`：导入向导、资料包预览等聚焦任务。
- `FieldGroup` + `Field`：全部表单；设置页使用 horizontal field。
- `InputGroup`：带图标的搜索/金额输入。
- `ToggleGroup`：主题、月/周/日/年等 2–7 项选择。
- `SelectItem` 必须在 `SelectGroup`。

### 7.4 图表与日历

- Recharts 图表包在 shadcn `ChartContainer` 内，提供文本摘要/数据表。
- FullCalendar 使用自定义 day cell 组件显示金额和事件；MVP 首先实现月视图。
- 图表和日历 tooltip 可键盘触达或提供同等文本信息。

## 8. 页面构成

### Dashboard

1. 标题、期间、全局搜索、快速添加。
2. 单一摘要带：本月收入/支出/净结余/本年结余。
3. 左主列：支出趋势 + 最近记录。
4. 右列：即将到期、重要事件、需要检查。

### 收支记录

1. 标题、条数、全局搜索、快速添加。
2. 搜索/筛选/导入导出工具条。
3. 有选择时才出现批量操作条。
4. 服务端分页/排序的数据表。
5. 右侧添加/编辑 Sheet。

### 日历

1. 期间导航、今天、视图切换、筛选。
2. 月网格为主要画布。
3. 点击日期打开当日详情 Sheet。
4. 交易、事件、提醒、备注、附件使用开放列表和 Separator。

### 报告

1. 确定性统计摘要带，明确“金额由本地数据库计算”。
2. 趋势/分类/支付方式/成员。
3. 用户月度说明。
4. AI 草稿独立 panel，显示生成状态、模型、范围、编辑/重生/删除/审核。

### 税务整理

1. 首屏常驻免责声明。
2. 程序计算摘要 + 候选记录表。
3. 右侧人工审核 panel。
4. 候选提示采用“可能符合条件 · 需专业确认”，不得显示为确定抵税结论。
5. AI 建议保持“未应用”，接受后才调用正常业务服务写入标签。

### 设置

1. 主侧栏 + 二级设置栏。
2. 语言/地区、主题、本地 AI、备份采用 horizontal Field。
3. AI 关闭时字段 disabled，核心功能可用提示常驻。

## 9. 可见文字白名单（首屏）

共同：`HomeLedger`、主导航八项、页面标题、期间、`快速添加`、搜索 placeholder。  
Dashboard：`本月收入`、`本月支出`、`本月净结余`、`本年结余`、`本月支出趋势`、`即将到期`、`最近记录`、`重要家庭事件`、`需要检查`。  
收支：筛选字段、导入/导出、表头、`添加支出` 及用户需求中的交易字段。  
日历：视图/筛选、星期、当日详情五个 section。  
报告：确定性统计、图表标题、用户说明、AI 审核动作。  
税务：完整免责声明、候选/审核/资料包文案、`可能符合条件 · 需专业确认`。  
设置：概念图中列出的全部设置字段。

不增加营销 slogan、假指标、装饰 badge 或未经需求支持的首屏说明。

## 10. 响应式策略

- 桌面设计基线：1536 × 1024；验证 viewport 1365 × 900 和 1536 × 1024。
- 1024–1364：主侧栏可折叠为 icon rail；右 Sheet 覆盖主区；表格保持水平滚动。
- 768–1023：工具条分两行；报告两列变一列；设置两列堆叠。
- 小于 768：为未来窄窗兼容，不声称手机 App；侧栏变 Drawer，Sheet 可全宽。
- 任何尺寸不裁切主按钮、表头或金额；不以缩小文字解决溢出。

## 11. Motion

- Sheet/Dialog：150–180ms ease-out。
- hover/focus：100–140ms。
- 图表进入动画可关闭，尊重 `prefers-reduced-motion`。
- 数据更新不整页闪烁；保留布局，局部 skeleton/transition。

## 12. 实现与验收

- 每个基准页面完成后，在 Browser/IAB 以原生尺寸与常用桌面尺寸截图。
- 同一 QA pass 使用 `view_image` 检查概念与实现截图。
- 对比至少：可见文字、布局、字体、背景/语义色、边框/圆角、icon、行密度、Sheet、响应式、交互状态。
- 所有有意偏差必须记录原因。正确性偏差（例如概念旧版错误合计）以程序计算和修正版概念为准。
- raster 概念图只保存在 `design/concepts`，不进入生产 bundle。
