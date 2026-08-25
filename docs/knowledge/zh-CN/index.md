# Personal Knowledge Studio 中文使用手册

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`、DeepSeek V4。最近核对：2026-08-25。

## 先说人话：这个插件能帮你做什么

你可以把 Personal Knowledge Studio 理解成一个“不会擅自改你笔记的资料整理助手”。它把你明确挑选的文章、笔记、纯文本和 PDF，整理成一个可审核、可追溯、以后还能继续查询和积累的 Markdown Wiki。

它可以帮你：

- 登记 Vault 里的资料，或把一个外部文件夹安全复制进来源目录；
- 在后台阅读资料，并根据你的 Schema 提议主题页、事实页、比较、摘要或其他知识页；
- 在真正写入前，把候选修改停在 `Review` 给你检查；
- 只把你明确接受的 create/update 修改 `Apply` 到 Wiki；
- 从已经审核并应用的知识中查询答案，并回到原始证据核对；
- 把值得长期保留的有证据 Query 结果再次送入审核流程，让知识库逐步积累。

它不会因为“文件放进某个目录”或“Chat 里出现一段文字”，就自动把内容当成正式知识；也不会绕过你直接改写 Wiki。最短路径是：

```text
挑选资料 → 登记为 Knowledge Source → 后台整理 → 你审核 → Apply 到 Wiki → Query 与复用
```

## Chat 在这里能产生什么

普通 Chat 是解决“眼前这次任务”的临时工作台。你可以让它解释难懂内容、总结或比较文件、梳理想法、列提纲、起草文字或生成待办。它首先产生的是一段 **Chat 回答**；你可以复制回答，使用 Chat 原有的插入光标、替换选区等操作，或把一条已经完成的 AI 回答整理成 Knowledge Draft。

聊天记录即使被自动保存或手工保存成 Markdown，也仍然只是普通聊天记录，不会因此自动成为 Knowledge Source、Review 或 Wiki。只有在已完成、非错误的 AI 回答上显式选择 `Create Knowledge Draft`，编辑标题和正文、核对原始材料并勾选确认后，系统才会创建并登记一个新的 Source。流式生成中的回答、用户消息和错误消息没有这个入口。

| 你做的动作                                        | 当下产生什么                                     | 这个动作会不会写入 Knowledge Wiki         |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| 普通 Chat                                         | 回答、解释、总结、比较、提纲、草稿或待办         | 不会                                      |
| `Use in this chat`                                | 文件成为本次对话的临时上下文                     | 不会                                      |
| `Add to Knowledge`                                | 持久登记一个现有 Vault 文件，并启动后台 Activity | 不会；可能得到 Review 或 `no_changes`     |
| `Create Knowledge Draft`                          | 把核对、编辑后的 AI 回答登记为 managed Source    | 不会；可能得到 Review 或 `no_changes`     |
| Knowledge Studio → `Query`                        | 有证据状态、结论和可打开引用的只读回答           | 不会                                      |
| Query → `Save to Wiki`                            | 一个受管理的新 Source，再次进入后台编译          | 不会；结果为 `no_changes` 或 Review→Apply |
| Review 中接受 → `Submit review`（随后受控 Apply） | 审核决定；只有接受的 create/update 才会写入 Wiki | 会，且只写你明确接受的修改                |

把 Vault 文件拖进 Chat 后出现的两个按钮，含义完全不同：

- **Use in this chat**：只让当前对话临时读取文件；不登记、不启动 Activity。
- **Add to Knowledge**：只登记文件并启动长期知识流程；不会把文件加入当前 Chat，也不会生成一段 Chat 回答。看到成功提示后，直接去 Knowledge Studio 的 `Activity` 即可，不需要再发送消息。

如果你想围绕已审核知识做可追溯问答，应使用 Knowledge Studio 的 `Query`；普通 Chat 适合临时思考和写作，不能替代 Knowledge 的证据、Review 与 Apply 链路。

`Create Knowledge Draft` 会先清理不属于最终可见回答的隐藏 reasoning/tool 内容，再把正文预填到可编辑窗口；标题起初为空，必须由你填写，并且只有显式勾选“已经核对”后才能创建。它不会自动带上 Chat 的文件上下文、结构化 citations、对话历史或原始证据关系。因此，它是**你核对过的二级笔记**，不是原书或论文的替身；应该在正文里补上书名、章节、页码或可核对位置。

点击创建本身只在本地生成内容寻址的 Markdown Source 并完成登记，不调用模型，也不直接写 Wiki。随后 Activity 对这个 Source 的编译可能调用你配置的 Knowledge 模型并产生费用；结果可能是 `no_changes`，也可能进入 Review，只有显式接受并 Apply 后 Wiki 才会变化。完整操作见 [知识来源与导入](sources-and-import.md#操作步骤从完整-ai-回答创建-knowledge-draft)。

## 为什么文件放进来源目录后，还要点 Add to Knowledge

这里有两个容易混淆的动作：

1. **把文件放进 `sourceRoot`**：只表示文件位于 Bundle 允许使用的 Vault 目录内。
2. **登记为 Knowledge Source**：表示你明确同意让系统长期跟踪这份文件，并允许后台编译开始。

所以，**放进 `sourceRoot` 不等于已经加入 Knowledge**。未登记的文件不会进入 `Activity`。当前版本把“单个 Vault 文件的登记入口”放在 Chat 的拖拽卡片里，是因为这里会先让你明确选择“只用于本次聊天”还是“长期加入 Knowledge”；这只是当前界面入口，并不表示你必须先和文件聊一轮。

这样分开可以避免误放在目录里的临时文件被静默处理、产生模型费用或进入长期知识。如果资料来自 Vault 外部，请使用 Knowledge Studio 的 `Import folder`：它会把“复制到 `sourceRoot`”和“登记来源”一次完成，不需要再去 Chat 点一次 `Add to Knowledge`。

## 一份资料怎样变成长期知识

```text
sourceRoot 内的 Vault 文件 ── Add to Knowledge（只登记）──┐
                                                        ├─→ 已登记 Source
Vault 外部文件夹 ─────── Import folder（复制 + 登记）────┤
完整 AI 回答 ─── Create Knowledge Draft（编辑 + 确认）────┘
                                                               ↓
                                                        Activity 后台编译
                                                         ↙             ↘
                                                no_changes              Review
                                                                          ↓
                                                                    显式 Apply
                                                                          ↓
                                                                         Wiki
                                                                          ↓
                                                               Query / 引用跳转
                                                                          ↓
                                                                  Save to Wiki
                                                       （先生成受管理 Source，再重走审核）
```

`no_changes` 是正常成功结果：模型和确定性校验认为当前 Wiki 无须修改，因此不会制造一个空 Review。

## 先理解三层

| 层              | 内容                                                                                | 谁负责                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources（来源） | 已完成登记的文章、笔记、纯文本、PDF、核对过的 Chat 草稿，以及保存回知识库的查询成果 | 你维护 user-managed 来源；Folder Import 与 Chat Draft 创建可有意更新的 managed copy；Query Save 创建不可编辑的内容寻址 capture；编译器只读已注册来源 |
| Wiki（知识页）  | 摘要、主题页、实体页、比较和综合结论                                                | 系统提出修改，你审核后写入                                                                                                                           |
| Schema（规则）  | Wiki 的目录、语言、页面约定和维护规则                                               | 你定义并谨慎版本化                                                                                                                                   |

`sourceRoot` 是允许存放来源文件的 Vault 目录；Knowledge Studio 的 `Sources` 页显示的是已经登记、正在被系统跟踪的来源。两者不是同一个概念。

## 从哪里开始

- 第一次打开 Studio：先看自动出现的 **Setup & status**；如果 Studio 已经可用，也可以从右上角再次打开它。
- 第一次使用：阅读 [15 分钟快速开始](quick-start.md)。
- 还没有配置模型：阅读 [安装、升级与 DeepSeek V4](installation-and-model.md)。
- 需要创建目录、Schema 和 Bundle：阅读 [Bundle 配置](bundle-configuration.md)。
- 要导入外部文件夹、Vault 文件或 PDF：阅读 [知识来源与导入](sources-and-import.md)。
- 想看后台任务为什么停住：阅读 [Knowledge Studio 与 Activity](knowledge-studio.md)。
- 准备决定哪些内容写入 Wiki：阅读 [Review 与 Apply](review-and-apply.md)。
- 想查询、打开引用或沉淀回答：阅读 [Query、引用与 Save to Wiki](query-and-writeback.md)。
- 遇到恢复提示或准备备份：阅读 [维护与恢复](maintenance-and-recovery.md)。
- 希望知识库长期不腐化：阅读 [长期使用规范](operating-guidelines.md)。
- 关心上传了什么、密钥在哪里：阅读 [隐私与安全](privacy-and-security.md)。
- 想判断何时用 Knowledge Studio、何时用 Copilot Plus，以及下一步是否值得投入：阅读 [产品评估与 Copilot Plus 对比](product-evaluation-and-plus-comparison.md)。
- 结果与预期不同：阅读 [故障排查](troubleshooting.md)。
- 查界面术语、状态、格式和上限：阅读 [参考手册](reference.md)。

## 当前支持什么

- Windows Obsidian Desktop 中的 Knowledge Studio。
- 一个有效 Bundle 和一个来源根目录。
- 摄入 `.md`、`.markdown`、`.txt` 和带可提取文本的 `.pdf`。
- 外部文件夹的一次性、安全快照导入。
- Vault 文件从 Chat 选择“仅用于本次聊天”或“加入知识库”。
- 从一条已经完成的 AI 回答创建可编辑、需显式确认的 Knowledge Draft Source；创建动作本身不调用模型或写 Wiki。
- 持久 Activity、两阶段 DeepSeek 编译、`no_changes`、Review、显式 Apply 和有限 Recovery。
- 只查询已接受并已应用的 Wiki；当前 `.md` 来源引用和 PDF 页引用会在打开前重新验证来源。
- 区分 Source-applied 页面基线与 effective 当前页头；已验证的 Forward revision 可被检查器和 Query 诚实读取，不需要模型 repair。
- 在同一页形成有精确前后哈希的重复 Forward revision 链；普通 Source Apply 只在真正提交同一精确页面时取代它，`no_changes` 保留它。
- 已接受但写入尚未开始的 Forward 可以 `End without writing`；sticky `recovery_required` 卡片提供 `Recheck / retry exact Apply` 与 `Keep current (no write)`。它们只允许新鲜复查后的有界精确重试或零写入终结；零写终局会按 journal 所处的写入前、写入结果不确定或已提交阶段如实记录，不会一律冒充外部取代，也永远不强制覆盖。
- 将受支持的 Query 回答通过 `Save to Wiki` 重新送入 Sources → Activity →（`no_changes`，或 Review → Apply）流程。
- `Sources` 页隔离缺失来源、复查精确原路径并二次确认安全退役；删除、单一 Notice、零覆盖复查、精确恢复和一次性来源退役已通过 Windows 有界实测，只有物理右键提示仍仅由自动化覆盖。

## 当前不要期待什么

- 文件夹持续同步、OneDrive 同步语义或监视外部原件变化。
- URL、浏览器剪藏器或单文件 Windows Explorer 作为独立 Knowledge 导入口。
- 扫描 PDF 的 OCR、加密 PDF 或损坏 PDF 修复。
- 自动接受、自动 Apply、模型直接写 Wiki 或静默覆盖冲突文件。
- 从任意新路径替换来源、自动删除来源文件、自动删除 Wiki 页、撤销退役或完整历史归档。
- 多 Bundle 选择、多用户协作、双 Obsidian 实例或跨平台支持。
- 把只有 Forward 来源的历史输出直接当成另一条提案的候选正文；打开该行的 `View exact output` 详情后会明确显示不支持原因。

这些限制不会阻止当前约定范围内的个人日常使用，但它们决定了你应该怎样组织 Vault 和备份。

## 如何判断系统已就绪

第一次打开 Knowledge Studio，如果配置还没完成，页面不会只丢给你一句笼统的 `unavailable`。它会把本机能判断的状态拆成三张卡：

| 卡片                    | 它回答的问题                                                                | 是否阻断 Knowledge 主流程 |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------- |
| `Workspace`             | Project、Bundle 和持久运行环境是否已经通过本地检查                          | 是                        |
| `Knowledge model`       | Project 单独选择的 Knowledge 模型与凭证是否已经在本地配置                   | 是                        |
| `Chat model (optional)` | 当前普通 Chat 模型是否已在本地配置；用于聊天、解释和 Chat → Source 辅助流程 | 否                        |

`Chat model (optional)` 即使显示 **Needs setup**，也不会把已经就绪的 Knowledge 编译、Review、Apply 或 Query 判为不可用。反过来，普通 Chat 能回答问题，也不能证明 Knowledge Project 使用的模型已经配好；两条模型链必须分开看。

卡片显示 **Configured locally** 只代表本地选择、启用状态、受支持配置和凭证存在性已经通过检查，**不代表模型服务在线、API Key 有效、账户有余额或本地模型服务器可连接**。这个页面的被动检查不 ping provider、不调用模型，也不产生模型费用。

当 `Workspace` 与 `Knowledge model` 都显示 **Configured locally** 后，返回 Studio，再确认：

1. 顶部显示你的真实 Bundle ID。
2. 能看到 durable revision（持久版本号）。
3. `Activity` 已连接，能够显示真实队列状态。
4. 没有需要处理的 Recovery 阻断。

卡片上的按钮只会打开现有 Chat、Copilot 设置、当前可唯一确定的 Project 文件或 Schema，或者刷新当前显示。它们不会替你创建 Project、目录或 Schema，不会改 Bundle YAML、切换模型、写 API Key 或自动修复配置。打开现有 Copilot 设置页本身可能触发插件的版本更新检查；这与 Setup 页的零 provider、零模型被动检查不是一回事。

如果不满足，请先按 [故障排查](troubleshooting.md) 中的“Knowledge Studio 启动、刷新与不可用”处理，不要尝试编辑插件的私有运行文件。

## 规范词语

- **必须**：违反后可能导致不可用、失去可追溯性或触发安全阻断。
- **禁止**：当前明确不支持，不能用变通手段绕过。
- **应该**：长期维护建议，短期不执行通常不会立即损坏数据。
- **可以**：可选操作。

## 版本与验收说明

本手册按当前 Windows 个人版行为编写。当前版本的 folder import production path、Activity、独立 Review/Apply、Query、Save to Wiki、PDF 和恢复链路已有自动化与有界 Windows 实机证据，足以在本手册约定范围内作为个人知识库正常使用。来源缺失隔离、单一 Notice、零覆盖复查、精确恢复和一次性来源退役已经实测。Chat → Knowledge Draft 也已通过真实 Chat UI 的有界 Windows 验收：从一条已保存的完整非错误 AI 回复进入编辑器，完全替换为一次性草稿后创建 Source，并以 completed / `no_changes` 收敛；Wiki 没有变化。该验收没有声称当前 Chat provider 成功联网生成了新回答。

三卡 `Setup & status` 已有自动化覆盖，并通过 Windows Obsidian 主窗口的已配置路径有界验收：Workspace / Knowledge 本地就绪、可选 Chat 缺 Key、刷新展示和返回 Studio 均符合预期，且三卡交互没有模型请求，也没有修改 Sources、Wiki、Knowledge、Projects 或 `data.json`。插件启动本身按既有设计推进了私有 Runtime observation bookkeeping；启动收敛后三卡刷新与返回保持 Runtime 精确不变。为避免破坏真实配置，本轮没有现场制造 no Project / invalid Bundle、Recovery、Sources-only、自然 generation `Refreshing` 或 popout Setup；这些边界仍以自动化为证据，不能写成已全部实机验证。

这不等于所有能力已在一次完整 Golden Flow 中验收：物理系统文件夹对话框的人工点击、同一文件夹批次产生非空 Review、不同字节冲突、物理右键提示或完整 Golden Flow 仍未写成已完成验收。它是 Windows 个人版，不是多用户、多 Bundle、跨平台或无人值守自动写入系统。手册会说明这些边界，但不会把它们冒充故障或已经支持的扩展能力。

本轮新增的 Source / Forward effective 页权威、混合来源历史、重复 Forward 链和 sticky recovery 终结动作已有自动化、格式检查与 Windows 路径/大小写边界证据，但尚未完成用户计划的真实 Windows Obsidian 实机验收。它们当前是“已实现、待 Windows 实测”，不是已获平台认证。

工程架构、事务证明和验收历史不在用户手册中展开；需要时参阅仓库的 `designdocs/` 和 `TODO.md`。
