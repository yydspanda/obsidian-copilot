# Review 与 Apply

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`。最近核对：2026-08-14。

## 本页目标

本页帮助你审核后台编译产生的候选修改，并理解 Wiki 在什么时刻才会真正改变。

核心规则只有一句：后台编译器只能提出 Proposal（提案）；你在 `Review` 中完成决定并点击 `Submit review` 后，系统才可能进入受控 `Apply`。当前没有自动接受或自动 Apply。

## 前置条件

- Knowledge Studio 已就绪，Activity 已连接。
- 至少一个任务处于 `Awaiting review`，或 `Review` 页签显示数字角标。
- Bundle 不处于 Recovery 或 Finalizing 阻断。
- 审核期间没有其他程序或窗口修改提案涉及的 Wiki 目标文件。

如何判断任务状态见 [Knowledge Studio 与 Activity](knowledge-studio.md)。

## Review 为空不一定是故障

以下情况都可能让 `Review` 显示 `No proposals are awaiting review`：

- 尚未导入或注册来源；
- 来源仍在 Activity 中排队、解析或编译；
- 编译得到正常 `no_changes`，任务直接 `Completed`；
- 提案已经被接受、拒绝或应用，不再属于待审核项；
- 新提案正在完成持久交接，稍后刷新才会出现。

如果 Activity 已 `Completed` 且没有失败或 Recovery，优先把空 Review 理解为 `no_changes`，不要反复导入同一资料。

## 从已应用历史版本提出新 Review

在已应用 Wiki 页的检查窗口中，`Known applied outputs` 会列出系统能够由持久记录验证的已知输出。当前页仍精确匹配最近一次应用结果、所选项是较早的已知输出、并且 Studio 只有一个可路由的 Knowledge Bundle 时，详情会显示 `Propose this output`。

这个动作不是 Restore、Revert 或 Rollback，也不会立即修改 Wiki。它只把所选历史正文发布为一条新的 pending Forward Review，然后用不含写权限的引用打开 Knowledge Studio 的 `Review`。快速重复点击只会合并为同一次提案与一次导航；若插件换代，旧窗口不能把提案发到新运行代。

在这类 Review 中：

1. 重新阅读当前正文与历史候选的差异；
2. 选择整页接受、允许时逐块接受、人工编辑，或拒绝；
3. 点击 `Validate and apply selection`。系统先持久保存接受决定，再立即用当前 Source、Schema、引用、Manifest 和目标文件执行新的确定性核对；只有核对通过才创建 crash-safe journal 并尝试 exact-file 写入。拒绝不会写 Wiki；
4. 若接受决定已经持久保存，但 journal 因 reload、disable、依赖漂移或暂时故障尚未开始，页面会显示 `Accepted revision ready to apply`。这个状态不会因为关闭视图或重新加载而消失；再次点击 `Validate and apply` 会重试当前核对，不会重做或替换已经保存的决定；
5. 若 journal 已经开始，则页面改为 `Applying accepted revision` 或需要人工处理的 recovery 状态，而不是回到 pending Review。

Forward Review 与普通编译 Review 使用不同的持久协议，但按钮语义相同：接受操作会进入受控 Apply。历史输出提案会先持久保存接受决定，再进行一次全新的确定性复核；若这两个阶段之间中断，`Accepted revision ready to apply` 提供显式重试入口。任何外部文件变化都会阻断覆盖。

若同时配置多个 Bundle，当前 Studio 不提供可靠的跨 Bundle 导航，因此 `Propose this output` 保持不可用；查看历史输出本身仍是只读的。

首版对同一 Wiki 页只支持一个未被拒绝的 Forward revision lifecycle。已经接受但永久无法通过新鲜核对的条目目前不能在界面中 abandon；已经提交的 lifecycle 也不能直接再叠加另一条历史输出提案。它们会保持可见并 fail closed，而不是被隐藏或强制覆盖。先恢复导致核对失败的 Source、Schema、Manifest 或文件条件；若无法恢复，请保留备份并使用受支持的故障排查流程，绝不要直接删除私有 Review、journal、overlay 或 ledger。

## 操作步骤：打开提案

1. 打开 Knowledge Studio 的 `Review`。
2. 如果有多个待审核项，点击顶部的 `Proposal 1`、`Proposal 2` 等按钮选择一个。
3. 也可以在 Activity 的 `Awaiting review` 任务上点击 `Review`，直接打开对应提案。
4. 先阅读提案头部，再逐文件检查差异。

提案头部包含：

- 文件数量；
- `Sources`：本次候选修改对应的来源引用；
- `OKF`：页面结构是否通过确定性校验；
- `Citations`：引用结构是否通过校验；
- `Links`：链接结构是否通过校验。

只有看到这些标志为 `valid`，才说明提案声明的结构校验已通过；它们不能代替你对内容真伪和意义的判断。当前生成校验仍拒绝所有 Markdown/Wiki 链接、URL/裸 URI、电子邮件地址和原始 HTML 标签，因此 `Links: valid` 表示提案没有这些不支持的内容，不表示链接解析能力已经开放。

## 先看懂每个文件

每张文件卡会显示目标路径、操作类型、完整性状态和可用审核能力。

### 操作类型

| 操作     | 含义               | 当前能否接受                       |
| -------- | ------------------ | ---------------------------------- |
| `create` | 新建一个 Wiki 页面 | 目标仍为空且校验通过时可以         |
| `update` | 更新已有 Wiki 页面 | 现有内容仍与提案读取版本一致时可以 |
| `delete` | 删除已有页面       | 当前禁止接受，只能拒绝             |

当前版本不支持通过 Knowledge 删除 Wiki 页面。即使提案中出现 `delete`，也会显示为 `reject_only`，不能用任何方式绕过。

### 完整性状态

| 状态          | 含义                                   |
| ------------- | -------------------------------------- |
| `current`     | 目标仍与提案生成时的预期一致           |
| `stale`       | 目标文件内容已变化，旧提案不能安全接受 |
| `missing`     | 原本应存在的目标不见了                 |
| `occupied`    | 原本要新建的路径已被其他内容占用       |
| `directory`   | 目标路径现在是目录而不是文件           |
| `unavailable` | 当前无法可靠读取或验证目标             |

### 审核能力

| 能力             | 含义                                               |
| ---------------- | -------------------------------------------------- |
| `blocks_allowed` | 可以整文件接受，也可以逐个 Changed block 决定      |
| `exact_only`     | 只能整文件接受或拒绝，不能局部选择                 |
| `reject_only`    | 当前只能拒绝；界面会显示 `Acceptance blocked` 原因 |

`stale`、`missing`、`occupied`、`directory`、`unavailable` 和 `delete` 通常会导致 `reject_only`。这是一项保护，不是需要关闭的限制。

## 操作步骤：作出决定

### 整体决定

- `Accept all`：对所有可接受文件选择整文件接受，并自动拒绝只能拒绝的文件。
- `Reject all`：拒绝本提案的全部文件，不写 Wiki。

### 单文件决定

- `Accept file`：接受该文件的完整候选内容。
- `Reject file`：拒绝该文件的全部修改。

### 按块决定

只有 `blocks_allowed` 文件会在每个 `Changed block` 上显示：

- `Accept block`：保留这个修改块；
- `Reject block`：不采用这个修改块。

切换到按块决定后，**必须**为该文件的每个 Changed block 明确选择接受或拒绝。上下文块只用于帮助阅读，不需要单独决定。

### 提交决定

1. 为提案中的每个文件作出决定。
2. 如果使用按块审核，为每个 Changed block 作出决定。
3. 确认 `Submit review` 不再禁用。
4. 点击 `Submit review` 一次，然后等待结果。

如果全部拒绝，系统结束提案且不写文件。如果至少接受一项，系统会再次校验当前快照和最终选中内容，然后在同一提交动作中进入 Apply；当前界面没有另一个需要点击的独立 Apply 按钮。

## 人工审核清单

点击 `Submit review` 前，至少检查：

- 候选结论是否确实由列出的 Source refs 支撑；必要时从 Vault 手工打开这些来源核对；
- 候选引用信息是否对应来源摘录或 PDF 页；Review 本身没有 Query 式的精确引用按钮；当前 production `.md` 导航只支持精确原句；
- 候选内容是否把模型推断误写成来源直接陈述的事实；
- 页面路径、标题、链接和语言是否符合 Schema；
- 更新是否保留已有页面中仍然有效的内容；
- 新结论是否与旧结论冲突，若冲突是否明确表达；
- 是否意外暴露密码、API Key、身份令牌或其他敏感信息；
- 高风险医疗、法律、财务结论是否已回到原始来源人工核对。

OKF、Citations、Links 显示 `valid` 只说明机器可验证的结构符合规则，不代表现实世界中的结论必然正确。

精确的 Markdown/PDF 引用按钮位于已应用知识的 `Query` 中。Review 阶段应根据 `Sources` 和差异内容手工核对来源；不要把 Query 的 `Source fact` / `Inference` 标签当成 Review 当前会显示的控件。

## Apply 期间的规则

接受提交后，Activity 可能依次显示 `Applying`、`Finalizing`、`Completed`。

在 `Applying` 或 `Finalizing` 期间：

- **禁止**手工编辑本提案涉及的 Wiki 文件；
- **禁止**再次提交同一 Review；
- **禁止**关闭插件后直接修改私有 Runtime、Manifest 或事务记录；
- **应该**保持 Obsidian 打开，等待持久确认完成。

Apply 是受控事务：系统会重新确认提案、目标内容和持久状态仍然匹配。出现漂移时会阻断，而不是静默覆盖你的文件。

Forward Apply 若显示 `Applying accepted revision`，说明 journal 已持久化，但当前运行代未必仍有后台任务继续推进；长时间停留时重新加载插件，让 startup recovery 继续核对。若显示 `Forward Apply needs recovery`，系统已经遇到不能安全猜测的精确文件冲突：当前界面只读、不会自动重试或覆盖，重新加载也不会自行清除 sticky recovery。先备份 Vault，再按 [维护与恢复](maintenance-and-recovery.md) 的 Forward recovery 说明处理。

## 你应该看到什么

### 接受并成功应用

- 顶部反馈为 `Changes applied.`；
- 对应 Review 从待审核列表消失；
- Activity 最终进入 `Completed`；
- 只有你接受的 create/update 内容出现在 Wiki；
- 未接受文件或修改块保持不变。

### 全部拒绝

- 反馈为 `The proposal was rejected without writing files.`；
- 提案从待审核列表消失；
- Wiki 文件不变。

### 需要恢复

- 反馈说明 Review 已持久保存，但 Apply 需要 Recovery；
- Activity 或 Bundle 显示 `Recovery required`；
- 使用 `Recovery` 页提供的动作，不要重新创建或强行覆盖目标文件。

## 如果结果不同

- `Submit review` 仍禁用：还有文件或 Changed block 未决定，或者当前接受/拒绝能力未连接。
- `Acceptance unavailable`：当前决定包含接受项，但安全 Apply 能力不可用；不要把它改成全拒绝来掩盖配置问题，除非你确实希望放弃提案。
- `This review changed before submission`：提案快照已经刷新；重新阅读当前版本再决定。
- `proposal or target files changed` / `stale`：目标内容发生漂移。先备份并检查当前 Wiki，然后拒绝旧提案。如仍需新提案，应等待已经明确排队的 rerun，或修改 Source 形成新版本；不要假定相同输入会自动重新编译。若要修改 Schema，须按 [Schema 变更规范](operating-guidelines.md#schema-变更规范) 在安全状态禁用/启用插件或完整重启后，才会进入新 generation。
- `occupied`：create 目标路径已经存在。检查该文件是否由你或其他流程创建，拒绝旧提案并解决路径所有权；系统不会覆盖。
- create 的父 Wiki 目录不存在：系统不会静默创建未跟踪目录。先在 `wikiRoot` 边界内创建或确认正确的父目录，刷新 Studio，再重新审核当前可用提案。
- `reject_only`：按卡片中的 `Acceptance blocked` 原因处理；当前提案只能拒绝该文件。
- `selected changes did not pass deterministic validation`：局部接受后的最终页面不再满足 OKF、引用或链接规则。调整选择，或拒绝后修改 Source；若修改 Schema，按 [Schema 变更规范](operating-guidelines.md#schema-变更规范) 安全重启运行代后再观察新编译。
- `Recovery required`：停止普通 Review 操作，转到 [维护与恢复](maintenance-and-recovery.md)。

不要为了让按钮恢复而直接编辑插件私有状态。更多情形见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 阅读差异、选择接受/拒绝和确定性复核本身不需要新的模型请求。
- 接受提交会写入你选中的 Wiki create/update、Manifest 和持久事务状态；全部拒绝不会写 Wiki。
- 本次提案在生成阶段通常已经使用过 DeepSeek，费用发生在 Activity 的编译阶段。
- 如果你在拒绝后修改 Source，或按 [Schema 变更规范](operating-guidelines.md#schema-变更规范) 修改 Schema 并安全重启运行代，新的编译可能再次产生 DeepSeek 请求和费用。
- 当前没有自动 Apply、后台直接写 Wiki 或可接受的 delete。

## 相关页面

- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [知识来源与导入](sources-and-import.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [长期使用规范](operating-guidelines.md)
- [维护与恢复](maintenance-and-recovery.md)
- [故障排查](troubleshooting.md)
