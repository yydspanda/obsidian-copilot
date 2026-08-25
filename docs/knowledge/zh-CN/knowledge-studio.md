# Knowledge Studio 与 Activity

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`。最近核对：2026-08-25。

## 本页目标

本页帮助你判断 Knowledge 是否真正就绪、查看后台编译进度，并在安全的时机暂停、继续、取消、重试或进入审核。

Knowledge Studio 是个人知识库的控制台；`Activity` 是其中的持久任务视图。关闭视图或重启 Obsidian 不会把已经持久化的任务历史当作不存在。

## 前置条件

- 使用 Windows 版 Obsidian Desktop。
- 插件已经启用。
- Project、Schema 和唯一 Knowledge Bundle 已通过校验。
- Bundle 恰好有一个 `sourceRoot`。
- Knowledge 使用的 DeepSeek V4 模型和密钥可用。

配置步骤见 [Bundle 配置](bundle-configuration.md)。

## 操作步骤：打开并确认就绪

可以用任一方式打开 Knowledge Studio：

1. 点击 Obsidian 左侧功能区的书库图标（提示为 `Open Knowledge Studio`）。
2. 打开命令面板，运行 `Open Knowledge Studio`。

打开后先检查顶部和页签，不要立即导入资料。

### 界面术语

| 英文界面                | 本手册中的中文 | 用途                                                 |
| ----------------------- | -------------- | ---------------------------------------------------- |
| `Knowledge Studio`      | 知识工作台     | 管理 Knowledge 全流程                                |
| `Setup & status`        | 设置与状态     | 分开查看本地 Workspace/模型就绪度                    |
| `Import folder`         | 导入文件夹     | 把外部文件夹复制为 Vault 来源快照                    |
| `Query`                 | 查询           | 只查询已接受、已应用的 Wiki                          |
| `Activity`              | 活动/任务      | 查看后台摄入、编译与应用状态                         |
| `Review`                | 审核           | 决定候选修改是否可以写入 Wiki                        |
| `Recovery`              | 恢复           | 处理不能由普通重试解决的事务状态                     |
| `Apply`                 | 应用到 Wiki    | 把已接受的候选修改事务性写入 Wiki                    |
| `Known applied outputs` | 已知应用输出   | 查看按精确正文合并的 Source / Forward 历史           |
| `Source Apply`          | 来源应用版本   | 最后一次普通 Source Apply 提交的页面基线             |
| `Forward revision`      | 前向修订       | 在不冒充重新编译的前提下，对当前 Wiki 页的已审核修订 |

`Recovery` 只有存在需要处理的恢复项时才显示；`Query` 只有当前适配器提供了查询能力时才显示。

### 先看 Setup & status

Studio 还不能打开主界面时，会先显示三张本地诊断卡；主界面已经可用时，也可以点击右上角 **Setup & status** 查看，并用 **Back to Studio** 返回。

| 卡片                    | 检查范围                                                                     | 对主流程的影响 |
| ----------------------- | ---------------------------------------------------------------------------- | -------------- |
| `Workspace`             | Project、唯一 Bundle、本地 Runtime / 持久状态                                | 未就绪会阻断   |
| `Knowledge model`       | Project 单独选择的 Knowledge 模型、支持范围、启用状态和本地凭证存在性        | 未就绪会阻断   |
| `Chat model (optional)` | 当前普通或 Project Chat 所选模型；用于普通对话和从新 Chat 回答衔接 Knowledge | 不阻断主流程   |

卡片之间互不冒充。例如，普通 Chat 模型缺 Key，不会把已经就绪的 Knowledge 模型判成失败；Knowledge 模型已配置，也不会替普通 Chat 选择模型。

**Configured locally** 的准确含义是“当前本地配置通过检查”，不是 **Online** 或 **Connected**。Setup 页不会 ping provider、验证 Key 真伪、查询余额、检查网络或探测本地模型服务器，也不会调用模型。卡片上的动作只打开现有 Chat、Copilot 设置、当前可唯一确定的 Project 文件或 Schema，或者刷新页面状态；不会自动创建 Project、目录或 Schema，不会修改 Bundle YAML、切换模型或写 API Key。打开现有 Copilot 设置页可能触发插件自己的版本更新检查，这与模型 provider 检查无关。

`Recovery` 和 Sources 缺失属于持久操作/来源处理，不是首配向导。出现时仍使用 Studio 原有的 Recovery 或 Sources 专用面板；Setup 页不会把它们改写成普通配置错误，也不会自动修复。

### 正常刷新与真正不可用的区别

完成 `Remove`、导入新来源，或修改 Project/设置后，插件可能需要撤销旧 generation 并重建当前运行代。这个正常间隙会显示中性的 `Refreshing Knowledge Studio…`：

- Studio 正在重新核对配置和持久状态；
- 旧代的操作、Query 和引用权限已撤销，界面按钮会暂时停用；
- 这不表示刚才的操作失败，也不需要立即重复点击或重载插件。

等待新代完成验证后，Studio 会自动返回可用界面。只有系统已判定存在需要处理的持久配置或 Runtime 等终态问题时，才会停在三卡 Setup 页面并显示对应原因。Setup 页顶部的 **Refresh displayed status** 只刷新当前本地状态展示；它不是 provider 测试，也不会自动修复配置。

### 就绪标准

先确认 `Workspace` 与 `Knowledge model` 都显示 **Configured locally**。`Chat model (optional)` 可以稍后配置，不影响 Knowledge 主流程。然后以下四点同时满足，才说明当前 Studio 可用于日常操作：

1. 顶部显示你的真实 Bundle ID。
2. Bundle ID 后显示 durable revision（持久版本号）。
3. `Activity` 打开后能看到 Bundle 状态和任务统计，而不是未连接占位页。
4. 页面没有 adapter、Sources 或未处理的 Recovery 阻断。

durable revision 是当前持久状态的版本标识。它会随任务或事务状态改变，不是文件数量，也不需要你手工编辑。`Refreshing Knowledge Studio…` 期间还未达到这个就绪标准，但它是正常过渡，不是红色故障结论。

## 认识 Activity

`Activity` 顶部先显示整个 Bundle 的运行门控，下面显示统计和任务列表。

### 统计数字

| 字段              | 含义                                         |
| ----------------- | -------------------------------------------- |
| `Total`           | 当前持久记录中的任务总数                     |
| `Active`          | 尚未进入普通终态的任务数，包括等待审核等状态 |
| `Awaiting review` | 已有候选修改、等待你决定的任务数             |
| `Failed`          | 已失败的任务数                               |
| `History`         | 已完成、已取消或普通失败等终态历史总数       |

Activity 只展示有限数量的旧终态行；如果出现 “older terminal jobs are hidden”，只是旧历史超出显示上限，不表示记录被删除。

### Bundle 状态

| 状态                | 含义                             | 你的动作                                     |
| ------------------- | -------------------------------- | -------------------------------------------- |
| `Running`           | 队列可以启动合格工作             | 正常使用；需要临时停下时可点 `Pause bundle`  |
| `Paused`            | 你主动暂停了 Bundle              | 准备好后点 `Resume bundle`                   |
| `Rate limited`      | 因请求速率限制而暂停             | 等待可恢复时间；按钮可用时再 `Resume bundle` |
| `Startup recovery`  | 启动恢复尚未完成                 | 等待，不要用手工编辑绕过                     |
| `Recovery required` | 存在需要明确处理的事务恢复       | 转到 `Recovery`，普通 `Resume` 不能绕过      |
| `Finalizing commit` | 写入已发生，系统还在完成持久确认 | 保持 Obsidian 打开并等待，不要修改目标 Wiki  |

### 任务状态

| 状态                | 正在发生什么                   | 是否需要你处理                               |
| ------------------- | ------------------------------ | -------------------------------------------- |
| `Queued`            | 等待后台工作器                 | 通常等待即可                                 |
| `Parsing`           | 读取并规范化来源               | 通常等待；PDF 问题可能在此失败               |
| `Analyzing`         | 从来源提取有证据支持的知识     | 会使用 Knowledge 模型                        |
| `Associating`       | 与现有知识建立关系             | 通常等待                                     |
| `Generating`        | 生成候选 Wiki 页面             | 会使用 Knowledge 模型                        |
| `Validating`        | 检查 OKF、引用、链接和候选结构 | 通常等待                                     |
| `Awaiting review`   | 候选修改已持久保存             | 点击该行的 `Review`                          |
| `Applying`          | 正在应用你已接受的事务         | 禁止手工改目标 Wiki；等待完成                |
| `Finalizing`        | 已提交但持久确认尚未结束       | 不是普通失败；等待或按 Recovery 指引处理     |
| `Paused`            | 任务停在应用前的安全阶段       | 根据 Bundle 状态决定继续或取消               |
| `Recovery required` | 自动写入被阻断，必须恢复       | 使用 `Recovery` 页提供的动作                 |
| `Failed`            | 当前尝试失败                   | 阅读失败阶段；仅在有 `Retry` 时直接重试      |
| `Cancelled`         | 当前尝试已被取消               | 来源文件没有因此被删除                       |
| `Completed`         | 队列已完成且没有待确认提交     | 可能是 Apply 成功，也可能是正常 `no_changes` |

任务行还会显示 `Attempt`、`Input revision` 和更新时间。`Newer source revision queued` 表示处理期间又观察到更新版本；让系统按顺序收敛，不要重复手工添加同一文件。

## 操作步骤：使用控制按钮

### `Pause bundle`

用于暂时停止整个 Bundle 启动后续合格工作。Pause 可以中止尚未进入 Apply 的处理中工作，并把它持久停在可恢复的安全状态；已经进入 `Applying` 的事务不会被半途截断。它不是撤销，也不会删除已保存的来源、Review 或历史。系统只会在允许暂停的状态显示按钮。

### `Resume bundle`

只在当前暂停原因允许人工继续时显示。`Startup recovery`、`Recovery required` 和 `Finalizing commit` 属于硬阻断，不能靠普通 Resume 跳过。

### `Cancel`

取消一个仍可取消的等待、暂停或非 Apply 处理任务。取消不会：

- 删除来源文件；
- 撤销已经应用的 Wiki；
- 把同一来源的未来更新永久禁用。

进入 `Applying` 后不会提供普通取消，以免造成写入状态不明确。

### `Retry`

只有“失败可重试、没有更新版本或同源活动任务、且不是 Apply 失败”的任务才会显示 `Retry`。没有按钮时，不要通过重复导入或改私有运行文件强迫重试；先处理页面提示的根因。

### `Review`

只在候选修改已持久保存、队列状态允许开始审核时显示。点击后会切换到 `Review` 并打开对应提案。详见 [Review 与 Apply](review-and-apply.md)。

## 当前页的 Source / Forward 来源

已应用 Wiki 页同时保留两项内部事实：最后一次普通 Source Apply 提交的基线，以及当前应读取的 effective 页头。没有 Forward revision 时两者相同；有活跃 Forward revision 时，检查器会明确显示 `Forward revision` 来源和 Source evidence 的适用边界。系统会在内部校验 Source-applied 哈希、effective 哈希和精确链路，不会把手工正文伪装成新的 Source Apply。

Forward 页仍可以显示原 Source citations，但它们只证明原来的来源片段，不是对人工改写内容的新证据。同一页可以安全连续提交多次 Forward revision；每次都必须从上一个 effective 页头精确开始，并且任何时刻只有一个当前页头。

Forward Review 接受后但 journal 尚未开始时，会显示 `Accepted revision ready to apply`。你可以重新 `Validate and apply`，或在系统仍能证明没有文件写入时选择 `End without writing`。后者只结束流程，不修改 Wiki，也不是回滚。进入 sticky Forward recovery 后，普通 Retry/Resume 不能绕过精确核对；当前卡片会提供 `Recheck / retry exact Apply` 和 `Keep current (no write)`，两者都会重新观察当前字节，并且不会覆盖第三状态。详见 [维护与恢复](maintenance-and-recovery.md#forward-revision-startup-recovery)。

## `no_changes` 为什么没有单独页签

`no_changes` 是后台编译的正常成功结果，不会制造空提案。你通常会看到：

- Activity 任务变成 `Completed`；
- `Review` 数量没有增加；
- Wiki 文件保持不变。

这表示系统已经证明当前来源和现有 Wiki 不需要产生修改。不要因为 Review 为空就立即重复导入；重复处理可能带来不必要的模型费用。

如果该页当前有一个已验证的 Forward 页头，`no_changes` 会保留它。只有后续普通 Source Apply 确实成功提交了同一 Source 的该精确页面，才会取代这个 Forward 页头；其他页的 Apply 也不会移除它。

## “Durable Activity is not connected” 表示什么

如果 Activity 显示：

```text
Durable Activity is not connected
No queue state is inferred while the Windows adapter is unavailable.
```

它不是“队列为空”，而是当前 Windows Knowledge 适配器没有连接，Studio 拒绝猜测任务状态。在这个状态下：

- 页面展示的不是可用 Activity；
- 不应假定后台任务正在正常运行；
- 不应尝试 Review、Apply 或导入新资料；
- 应先修复 Bundle、模型、密钥、平台或启动恢复问题，然后重新加载插件状态。

三卡 Setup 页面不是正常 generation 换代提示。它表示本地启动已经收敛到需要处理的配置或 Runtime 状态；在修复前不会启动未授权的模型工作或修改 Knowledge 文件。Recovery 和可恢复的 Sources 缺失仍由各自的专用面板呈现。

## 你应该看到什么

正常日常运行大致如下：

```text
Bundle Running
    ↓
Queued → Parsing → Analyzing → Associating → Generating → Validating
    ↓                                      ↓
Completed（no_changes）             Awaiting review
                                             ↓
                                      Review → Applying
                                             ↓
                                  Finalizing → Completed
```

部分阶段可能很短，界面刷新时未必每个都能肉眼看到；最终持久状态和提示才是判断依据。

## 如果结果不同

- Studio 一直 `Loading durable knowledge state`：等待当前启动恢复；若长期不变，重新打开视图并查故障排查。
- Studio 短暂显示 `Refreshing Knowledge Studio…`：正常等待，不要重复提交刚才的操作；只在长时间不恢复时转到故障排查。
- 打开后停在 Setup 页：按 `Workspace` 与 `Knowledge model` 两张卡分别处理；不要把可选 Chat 卡的问题误当成 Knowledge 故障。
- Activity 未连接：不要把它当成空队列；先解决适配器不可用。
- 一直 `Queued`：检查 Bundle 是否被暂停、是否 rate limited，或是否有 Recovery/Finalizing 阻断。
- `Failed` 没有 `Retry`：该失败不适合盲目重跑，或已有更新的同源任务；按失败阶段处理来源、配置或恢复状态。
- `Finalizing`：不要重复 Submit、关闭中断或手工修改目标文件；先等待持久确认。
- `Recovery required`：转到 `Recovery`。普通 Apply 只执行界面在当前精确状态下提供的 `Continue`、`Abandon` 或 `Check again`；Forward sticky recovery 使用其 Review 卡片上的两个精确动作。它们只允许新鲜复查后的有界精确重试，或保留当前文件且不写入，永远没有强制覆盖。
- Activity 已 `Completed`、Review 为空、Wiki 不变：这通常是 `no_changes`。

详见 [维护与恢复](maintenance-and-recovery.md) 和 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 打开 Studio、切换页签、读取 Activity 和刷新持久状态本身不会调用模型。
- `Pause`、`Cancel` 和单纯查看 Review 不会调用模型。
- `Resume` 可能允许已有排队任务继续；`Retry` 会重新排队，因此后续编译可能再次调用 DeepSeek并产生费用。
- 一次正常的新来源编译通常包含分析与生成两个 DeepSeek 请求。
- Activity 显示的是受控持久状态；禁止手工编辑插件的 Runtime、Manifest 或事务记录来改变它。

> Source / Forward 当前页头、重复 Forward 和对应恢复动作尚未完成用户计划的真实 Windows Obsidian 实机验收；现有自动化和 Windows 路径边界检查不等于已获平台认证。

## 相关页面

- [知识来源与导入](sources-and-import.md)
- [Review 与 Apply](review-and-apply.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [维护与恢复](maintenance-and-recovery.md)
- [故障排查](troubleshooting.md)
- [参考手册](reference.md)
