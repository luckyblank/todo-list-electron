# To-Do List 开发与维护指南

本指南说明项目的运行、构建、模块边界、SQLite 生命周期和发布约束。产品行为见 [用户使用指南](06-user-guide.md)，需求与设计依据见 [产品需求](01-product-requirements.md)、[界面设计](02-ui-ux-design.md)和 [技术架构设计](03-technical-architecture.md)。本指南以当前源代码为维护依据；验收结果应随具体发布记录更新。

## 环境与依赖

使用 Windows x64、Node.js 22.12 或以上版本和 npm。开发环境建议统一到团队选定的 Node 24 版本，并保留项目的 `package-lock.json`，通过 `npm ci` 复现依赖。

当前锁定的主要技术包括 Electron 45、Vue 3、TypeScript、Pinia、electron-vite、better-sqlite3 13、Vitest 和 electron-builder。准确版本以 [package.json](../package.json) 与 lockfile 为准，不在维护时直接替换为未验证的 latest。

### 安装依赖

在项目根目录执行：

```powershell
npm ci
```

安装后的 `postinstall` 调用 [verify-native.mjs](../scripts/verify-native.mjs)，使用项目锁定的 Electron 可执行文件，以 `ELECTRON_RUN_AS_NODE=1` 运行 [native-check.mjs](../scripts/native-check.mjs)，真实打开 SQLite 并读取版本。原生依赖检查失败应在开发前处理，不能仅确认 JavaScript 包已下载。

### SQLite 原生模块配置

better-sqlite3 13 使用 Node-API，并随 npm 包提供对应平台的预编译二进制。本项目使用 Windows x64 的预编译文件，打包配置保留 `npmRebuild: false`，避免 electron-builder 额外触发不必要的 node-gyp 和 Visual Studio 编译流程。

不要为解决一次运行错误直接恢复 `electron-builder install-app-deps`、执行通用原生重建或把 `npmRebuild` 改为 true。先检查当前 Node、Electron、CPU 架构、依赖锁定版本和预编译文件是否完整，再通过原生验证脚本确认实际加载。升级数据库驱动后，如果新的发行方式发生变化，需要重新评估该配置。

## 常用命令

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:electron
npm run build
npm run start
npm run icons
npm run package:win
npm run verify:package
```

- `dev`：启动 electron-vite 开发服务与 Electron，开发渲染端口固定为 127.0.0.1:5173。
- `typecheck`：分别检查主进程与 preload 的 TypeScript，以及 Vue SFC 与共享契约。
- `lint`：检查源代码、测试、脚本和构建配置。
- `test`：通过专用 runner 在 Electron 的 Node 运行时中执行 Vitest。
- `test:electron`：构建后使用独立 UUID 数据目录验证正式 preload、Vue DOM 交互、SQLite、多窗及托盘菜单回调；不发送桌面输入，原生测试窗口保持隐藏。
- `build`：先做类型检查，再生成 `out/main`、`out/preload` 和 `out/renderer`。
- `start`：使用 Electron 预览已构建内容；先执行 build。
- `icons`：根据 SVG 源文件重新生成渲染侧 SVG、PNG 和 Windows ICO。
- `package:win`：构建并生成 Windows x64 NSIS 安装包。
- `verify:package`：打包后使用发行目录内的 Electron 校验 app.asar 资源、初始任务、图标与字体许可，并从打包依赖实际加载 SQLite；该命令不启动桌面窗口。

仅通过 `npm run package:win` 生成面向用户的 NSIS Setup 安装程序。`dist` 中的解包目录是打包过程的中间产物，不作为 portable 版本交付。

单独运行一组测试可以使用：

```powershell
npm test -- tests/integration/database.test.ts
npm test -- tests/integration/storage-manager.test.ts
```

不要把测试 runner 改回直接使用系统 Node 执行 Vitest。现有 [run-tests.mjs](../scripts/run-tests.mjs) 用锁定的 Electron 运行测试，使 SQLite 加载与应用实际运行环境保持一致；Vitest CLI 从其 package.json 所在目录定位，避免访问未导出的包子路径。

## 数据目录隔离

安装版默认使用 `app.getPath('userData')`，Windows 对应 `%APPDATA%\To-Do List`。未打包的开发与构建预览默认使用项目下的 `.dev-data`，避免写入安装版用户数据。

自动化或手工隔离验证可设置 `TODO_DATA_DIR`：

```powershell
$env:TODO_DATA_DIR = Join-Path $env:TEMP 'todo-list-isolated'
npm run dev
```

测试完成后，在该 PowerShell 会话中移除覆盖：

```powershell
Remove-Item Env:TODO_DATA_DIR
```

该环境变量是开发与运行环境配置，不通过 renderer 接收，也不允许用户界面传入任意数据库路径。测试用例使用独立临时目录；递归清理前核验路径位于预期临时目录并具有测试前缀，不能针对真实用户数据运行清空操作。

任务的正式数据源是 SQLite。不得在 Pinia、LocalStorage 或小窗中增加另一套持久化任务副本。

仅打包后的正式应用在全新数据库初始化入口写入两条持久化引导任务，一条已完成、一条未完成。TaskRepository、开发模式和仓储测试默认仍为空库。初始化判断必须区分全新数据与已有用户，不能仅根据当前任务数量为零重新填充；升级、重启和用户删除全部记录都不触发补种。

引导文案在 [initialTasks.ts](../src/main/database/initialTasks.ts) 维护。主进程以 `app.isPackaged` 配置 StorageManager；管理器再检查初始化标记，仓储仅在新建 schema 时将结构与初始数据放入同一事务。备份验证和恢复不传入种子选项，不得借恢复入口重新添加引导任务。

## 目录与职责

- [src/main/index.ts](../src/main/index.ts)：应用装配、单实例、IPC 注册、操作队列、关闭握手和窗口协作。
- [src/main/ipc/security.ts](../src/main/ipc/security.ts)：登记窗口、主 frame、受信 URL 和消息大小校验。
- [src/main/window/bounds.ts](../src/main/window/bounds.ts)：主窗初始比例、工作区适配和位置恢复。
- [src/main/window/MiniWindow.ts](../src/main/window/MiniWindow.ts)：专注小窗的创建、位置、置顶和关闭。
- [src/main/window/TrayController.ts](../src/main/window/TrayController.ts)：系统通知区域图标、右键菜单、备份反馈和退出入口。
- [src/main/database/TaskRepository.ts](../src/main/database/TaskRepository.ts)：任务规则、修订检查、事务及 SQLite 访问。
- [src/main/database/migrations.ts](../src/main/database/migrations.ts)：有序结构迁移。
- [src/main/recovery/StorageManager.ts](../src/main/recovery/StorageManager.ts)：固定数据目录、备份、恢复和连接生命周期。
- [src/preload/index.ts](../src/preload/index.ts)：通过 contextBridge 暴露具名接口，不暴露原始 ipcRenderer。
- [src/shared/contracts.ts](../src/shared/contracts.ts)：任务、快照、设置、窗口与 API 结果类型。
- [src/shared/validation.ts](../src/shared/validation.ts)：输入规范化、长度与枚举校验。
- `src/renderer/src/app`：主应用装配、侧栏和自定义标题栏。
- [MiniApp.vue](../src/renderer/src/app/MiniApp.vue)：专注小窗的未完成列表、完成操作与窗口控件，复用任务 store。
- `src/renderer/src/features/tasks`：任务列表、编辑器、选择器、store、草稿与备份交互。
- `src/renderer/src/shared/ui`：自定义选择器、对话框、状态页和通知。
- `src/renderer/src/shared/theme`：颜色、间距、字体和组件状态。

新增能力先扩展契约和业务规则，再接组件；不要从 Vue 组件直接导入 Electron、文件系统或数据库驱动。

## 窗口与视觉维护

### 主窗口

主窗使用 `frame: false`、自定义标题栏和自绘窗口控制按钮，初始基准为 1200 × 800。窗口工作区不足时按比例缩小，并保存用户调整后的 normal bounds 与最大化状态。位置加载必须校验显示器工作区，防止外接显示器移除后窗口不可见。

顶部拖动区域使用 `app-region: drag`，窗口按钮和其他可点击控件明确使用 `no-drag`。新增顶部交互时需要核对该边界，避免按钮外观存在却收不到点击。

### 图标

应用图标源文件为 [resources/app-icon.svg](../resources/app-icon.svg)。修改源文件后运行 `npm run icons`，同步生成 `resources/app-icon.png`、多尺寸 `resources/app-icon.ico` 和 renderer 资产。主窗口、小窗、安装包和任务栏应引用同一套应用图标。

### 选择器与焦点

排序、优先级和显示密度统一使用 [CustomSelect.vue](../src/renderer/src/shared/ui/CustomSelect.vue)，避免增加原生 select 与现有视觉和键盘行为分叉。该组件负责弹层定位、选中状态、方向键、Enter、Esc、外部点击和对话框内浮层目标。

输入框聚焦只改变单层边框，不叠加第二圈 outline。组合输入由容器统一表示焦点；按钮、导航和复选框仍保留可辨识的键盘焦点提示。

优先级统一通过 [PriorityFlag.vue](../src/renderer/src/features/tasks/PriorityFlag.vue) 表达：高为暖红、普通为绿色、低为灰色。修改等级表达时同步列表、详情、选择器和小窗，仍保留文字语义。

侧栏手动折叠使用 `settings.sidebarCollapsed`；窄窗口自动折叠是视图适配，不应覆盖用户的持久偏好。

### 专注小窗

小窗首次约 360 × 480，位于主窗所在显示器的右下工作区，支持拖动、大小调整、置顶和返回主窗口。位置及置顶信息写入 `mini-window-state.json`。

主窗口与小窗通过受限 preload 接口访问同一主进程仓储。任务写入成功后，主进程发布新的完整快照；两个窗口接收同一数据变化。不要让小窗直接读 SQLite，也不要为小窗复制业务规则或持久化文件。

登记小窗为受信窗口时，仍必须核验其 webContents、主 frame 和 URL。窗口控制接口要区分主窗与小窗权限，不能因为增加第二个窗口而退化为只验证 URL。

### 系统托盘

TrayController 在 `app.whenReady()` 后创建，由主进程保留整个实例，避免 Tray 被垃圾回收。图标来自应用自定义资源，提供 16、20、24、32 像素对应的缩放表示，并设置 To-Do List 提示文字。

托盘右键菜单包括打开工作台、打开小窗、新建任务、小窗置顶、关闭小窗、立即备份和退出应用。小窗状态变化后调用 `refresh()` 更新置顶勾选和可用状态。单击或双击托盘图标唤回工作台。

托盘备份复用主进程的操作队列与 StorageManager。控制器防止重复触发，执行时显示“备份中…”，结束后通过 Windows 托盘气泡给出简短反馈；反馈不包含任务正文或完整路径，错误交给主进程诊断回调。真正退出时调用 `dispose()` 清理托盘。

该入口是 Windows 系统通知区域的 Tray 菜单，不使用 `setUserTasks` 或任务栏 JumpList，也不注册开机自启动。后续维护不要把窗口唤回、任务新增和数据库操作重新实现在托盘模块内部；通过已有回调接入同一业务流程。

## 任务状态与提交协议

每次任务写入携带 `dataEpoch`。更新、完成和删除另外携带任务 `expectedRevision`；重排携带 `expectedCollectionRevision`。主进程验证通过并完成事务后，才返回成功快照。

新增草稿使用稳定 `createRequestId` 去重。即使首次响应丢失，也不能生成新请求 ID 盲目重试；任务删除并清理后，已消费的请求 ID 仍不能重新创建该任务。

编辑表单是独立草稿，不直接修改 store 中的已提交任务。出现失败或修订冲突时保留输入。完成切换传递明确的布尔目标值，不把 toggle 当作跨进程写入协议。

同一 `dataEpoch` 内比较集合版本；恢复数据后轮换 epoch，renderer 清理旧状态并接收完整快照。不要跨 epoch 直接比较版本数值，否则恢复较早备份可能被误当作旧响应丢弃。

拖拽只在全部任务、空搜索、手动排序、没有未保存草稿且没有提交中的操作时开启。放下后一次提交完整正常任务 ID 顺序，仓储验证无遗漏、重复或未知 ID，并在事务内更新。上移下移复用同一业务入口。

## 数据结构与迁移

`data/tasks.sqlite` 包含以下核心表：

- `tasks`：任务内容、状态、优先级、顺序、修订、系统时间和删除撤销字段。
- `create_requests`：已消费的新增请求标识与任务 ID，不随过期删除项清理。
- `settings`：有 schema 的显示偏好白名单。
- `app_meta`：集合修订号。

结构版本由 `PRAGMA user_version` 管理。新增字段或表时追加有序迁移，不修改已经发布的历史迁移。为旧任务给出明确默认值，并补充迁移与旧数据测试。遇到高于当前支持版本的数据库时阻止写入，不以重新建库解决。

数据库使用单连接、DELETE journal 和 FULL synchronous。事务回调只做同步数据库工作；备份文件处理、用户确认和异步等待放在事务之外。同步查询变慢时先测量并定位，必要时把仓储适配迁入单独 Worker，保留一个逻辑写入者。

## 备份与恢复维护

StorageManager 固定管理 `data`、`backups` 和 `recovery` 子目录，不接受 renderer 自由文件路径。备份 ID 只允许来自受控目录的文件名，校验 basename、真实路径与符号链接，防止跳出应用目录。

首次有效数据库建立后创建基线备份；启动及定时检查距上次成功日常备份的时间，保留最近 7 份日常备份。保护备份保留最近 3 份，手动备份不参与每日轮换。备份使用 SQLite 一致快照，验证后发布；失败只产生备份警告，不撤销已保存任务。

健康恢复的顺序为：处理草稿、主进程进入独占模式、排空已接收操作、验证暂存备份、生成当前数据保护备份、事务替换数据、轮换 epoch 并广播快照。

损坏恢复先验证暂存副本，再写入恢复阶段标记，关闭旧连接，将原数据库及固定的 journal/WAL/SHM 文件隔离到 recovery 目录，受控切换新文件并重新打开。成功后才清除恢复标记；任一步中断都不能在下次启动误建空库。

`.initialized.json` 用于识别已有数据目录，`.recovery-pending.json` 用于识别未完成恢复。不要在维护脚本中直接删除这些标记以绕过错误。迁移、恢复或排查损坏问题时，先保留原数据库和隔离文件。

## 关闭与后台任务

主窗口的关闭按钮只隐藏工作台至托盘，不销毁 renderer、草稿或数据库连接，也不关闭专注小窗。隐藏窗口无需丢弃确认；真正退出才处理草稿。小窗关闭只结束该窗口，两者互不影响。

托盘“退出应用”才进入真正退出流程：renderer 先处理草稿，主进程停止接收新变更、等待操作队列，再 `await storage.shutdown()`，最后销毁小窗、托盘和主窗口。后台备份可能仍持有 SQLite 连接，不能只调用同步 close 后立即退出。

界面在退出请求后变成无响应或崩溃时，主进程仍需提供受保护的退出回退，避免 `closePending` 状态永久阻断后续退出。回退对话框只用于异常退出路径，不能代替正常草稿确认。任何真正结束应用的入口都应汇总到同一存储关闭流程。

取消退出时清除退出意图和等待状态；已打开的草稿保护期间，托盘新建不能覆盖待处理动作。主窗 X 始终只隐藏，不能因为一次已取消的退出请求而在后续点击时意外退出整个应用。

## 日志与问题排查

本地 `application.log` 记录时间、操作类别与错误码，达到轮换阈值后保留上一份日志。日志不写任务标题、描述、撤销 token 或完整 IPC payload。

存储错误先查看错误码、数据路径和标记状态。读取失败时不能将空列表当作恢复策略；写入失败时检查事务回滚与草稿是否保留；恢复失败时保留原始、暂存和隔离文件，再修复具体阶段。

如果 SQLite 无法加载，先重新执行原生验证脚本，核对锁定依赖、平台和 CPU 架构。不要复制另一台机器或另一架构的 `.node` 文件覆盖当前依赖，也不要在未确认原因时删除用户数据库。

## 验证与发布

发布前依次完成类型检查、lint、单元与集成测试、生产构建，以及真实安装包验证。测试覆盖职责包括选择器、输入与窗口边界、SQLite 提交和回滚、删除撤销、备份恢复、初始化标记及路径保护。

桌面验证还需要检查自定义窗口按钮与拖动、显示缩放、中文输入法、自定义下拉键盘路径、侧栏持久化、真拖拽、小窗置顶与双窗任务同步，以及关闭主窗隐藏至托盘、托盘唤回、右键菜单和真正退出。分别验证全新安装、升级、重启留存和从备份恢复；记录实际系统、版本与结果。

运行命令成功不自动代表上述人工场景已经验收。性能目标也需要用明确机器、任务规模和采样方法实测，不能将设计目标写成测量结论。

正式交付只提供 Windows x64 NSIS 安装包。主窗图标资源及依赖原生二进制需要同时验证打包后加载；更新时保持稳定 appId 和用户数据目录，卸载默认保留用户数据。

当前尚未配置公开分发所需代码签名证书与自动更新渠道。公开发布前补充签名、安装与升级验证；自动更新、macOS 和 Linux 交付需要各自的兼容性与发布方案。
