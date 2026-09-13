# 参考手册

> 适用范围：Windows 个人版当前行为。若本页与界面冲突，以同版本界面和最新手册为准。

## 界面中英文对照

| 英文界面               | 中文含义                                         |
| ---------------------- | ------------------------------------------------ |
| Knowledge Studio       | 个人知识工作台                                   |
| Setup & status         | 本地设置与状态检查                               |
| Configured locally     | 本地配置通过；没有验证联网、余额或服务可用性     |
| Needs setup            | 需要用户完成本地配置                             |
| Needs attention        | 持久环境或运行状态需要处理，不会自动修复         |
| Query                  | 查询                                             |
| Activity               | 活动/后台任务                                    |
| Review                 | 审核                                             |
| Recovery               | 恢复                                             |
| Import folder          | 导入文件夹                                       |
| Create Knowledge Draft | 把核对、编辑后的完整 AI 回答登记为 Source        |
| Apply                  | 把已接受变更应用到 Wiki                          |
| Save to Wiki           | 把当前回答保存为 managed source，再进入 Activity |
| Durable revision       | 持久状态版本号                                   |
| Source fact            | 来源直接支持的事实                               |
| Inference              | 基于证据推导的判断                               |
| Supported              | 证据足以支持回答                                 |
| Partial                | 只能支持部分回答                                 |
| Insufficient evidence  | 证据不足，不生成无根据结论                       |
| Known applied outputs  | 按精确正文合并的已知 Source / Forward 应用历史   |
| Source Apply           | 普通来源编译并应用的页面基线                     |
| Forward revision Apply | 对当前 Wiki 页完成的已审核前向修订               |
| End without writing    | 只在写入开始前结束已接受 Forward；Wiki 不变      |

## Setup & status 三张卡

| 卡片                  | 检查什么                                                | 是否阻断 Knowledge |
| --------------------- | ------------------------------------------------------- | ------------------ |
| Workspace             | Project、Bundle、唯一选择、本地 Runtime 与持久状态      | 是                 |
| Knowledge model       | Project 的 Knowledge 模型、支持配置、启用状态与本地凭证 | 是                 |
| Chat model (optional) | 当前普通或 Project Chat 模型的本地配置                  | 否                 |

这些卡片是只读投影。被动检查不会调用模型或向 provider 发请求；**Configured locally** 不代表 Online、Connected、Key 有效、有余额或本地模型服务可达。

| Setup 动作                                     | 作用                                                                     | 不会做什么                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Open Chat                                      | 打开已有 Chat                                                            | 不创建 Project，不自动选择模型                                |
| Open Copilot settings                          | 打开已有 Copilot 设置                                                    | 不写 Key、不验证 provider；设置页本身可能做插件版本更新检查   |
| Open Project file / Open selected Project file | 打开唯一 Bundle 所属、唯一 Project 或 Chat 中当前精确选中的 Project 文件 | 不改 Bundle YAML；没有精确当前选择时不在多个 Project 中猜一个 |
| Open Knowledge rules                           | 仅在当前有效 Bundle 可唯一确定时打开 Schema                              | 不创建或修复 Schema                                           |
| Refresh displayed status                       | 刷新当前本地状态展示                                                     | 不 ping provider，不自动建目录、写配置或修复持久状态          |

正常 generation 换代继续显示中性的 `Refreshing Knowledge Studio…`。Recovery 与 Sources 缺失继续使用各自的专用面板，不由 Setup 卡片替代。

## Activity 任务状态

| 状态              | 含义                        | 常见下一步                |
| ----------------- | --------------------------- | ------------------------- |
| Queued            | 等待 worker                 | 等待                      |
| Parsing           | 读取并规范化 Source         | 等待；不要改该文件        |
| Analyzing         | DeepSeek 提取来源支撑的知识 | 等待                      |
| Associating       | 与现有知识建立关系          | 等待                      |
| Generating        | 构造候选 Wiki 页面          | 等待                      |
| Validating        | 校验候选 ChangeSet          | 等待                      |
| Awaiting review   | 等待你的决定                | 打开 Review               |
| Applying          | 正在执行已授权事务          | 不要中断或编辑目标        |
| Finalizing        | 文件已提交，等待持久确认    | 查看 Recovery，等待       |
| Paused            | 应用前暂停                  | 原因允许时 Resume         |
| Recovery required | 必须先恢复事务              | 打开 Recovery             |
| Failed            | 本次尝试失败                | 修复原因后按资格 Retry    |
| Cancelled         | 本次尝试已取消              | 需要时重新产生输入        |
| Completed         | 已完成且无待确认事务        | 无动作；可能是 no_changes |

## Bundle 状态

| 状态              | 含义                     |
| ----------------- | ------------------------ |
| Running           | 可以开始合格工作         |
| Paused            | 用户暂停了新工作         |
| Rate limited      | 因提供商限制等待安全恢复 |
| Startup recovery  | 启动恢复尚未完成         |
| Recovery required | 新工作和自动写入被阻断   |
| Finalizing commit | 等待已提交事务的持久确认 |

## Recovery 状态

| 状态                    | 含义                          | 可能动作                                     |
| ----------------------- | ----------------------------- | -------------------------------------------- |
| Accepted, not started   | Review 已接受，Apply 尚未开始 | Continue                                     |
| Decision required       | 需要明确决定怎样结束 Apply    | Continue / Abandon；若提案已过期则仅 Abandon |
| Transaction active      | 持久事务正在进行              | Check again                                  |
| Apply blocked           | 当前不允许自动写              | Check again                                  |
| Commit finalizing       | Wiki 已提交，确认仍在完成     | Check again                                  |
| Global transaction      | 另一个 Vault 事务占用写入槽   | Check again                                  |
| Queue recovery required | Queue 因事务恢复暂停          | Check again                                  |
| Queue commit pending    | 等待已提交事务确认            | Check again                                  |

“提案已过期”表示提案生成后 Knowledge 状态发生了变化。本次 Apply 尚未写入 Wiki 文件；请先 `Abandon`，再重新生成并 Review 新提案。

### Forward revision 状态与恢复规则

`Accepted revision ready to apply` 和 sticky `recovery_required` 的专用按钮都已在当前 Review UI 接入。命令进行时两个 sticky 按钮都会禁用；当前 generation 没有 Forward 命令能力时也会禁用。

| 状态 / 动作                      | 含义                                                                                                            | 写入规则                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Accepted revision ready to apply | 接受决定已保存，journal 与 Wiki 写入尚未开始                                                                    | Validate and apply，或在仍能证明零写入时 End without writing       |
| Applying accepted revision       | durable journal 已开始管理这次精确转换                                                                          | 等待或 reload 后由 startup recovery 收敛                           |
| Forward Apply needs recovery     | 文件既非 exact-before 也非 exact-after，或写后证明不完整                                                        | sticky；不自动重试，不强制覆盖                                     |
| Recheck / retry exact Apply      | 先重读当前字节；accepted after-state 只收敛确认，合格 exact-before 每次命令最多一次 CAS，第三状态继续阻断       | 只有合格 exact-before 可能写入                                     |
| Keep current (no write)          | 先重读；exact-after 收敛为已提交；可安全重试的 exact-before 被拒绝；其他状态只有在 journal 阶段允许时才零写终结 | 不写；按阶段记录写入前放弃、不确定写入后外部取代或已提交后外部取代 |
| Force overwrite                  | 永远不可用                                                                                                      | 无 force 路径                                                      |

### Known applied outputs 的提案资格

| 行状态                       | 含义                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Available                    | 候选由普通 Source Apply 历史证明，且当前文件/路由都精确有效 |
| Current file is not applied  | 当前 Wiki 字节不是已证明的 effective 页头，不能提案         |
| Selected output is current   | 候选与当前有效正文相同，无需发起变更                        |
| Forward origin not supported | 该行只有 Forward 权威；当前还不能用它发起另一条提案         |
| Detail too large             | 已知输出可列出，但当前不授权载入详情并提案                  |

已知输出会按精确内容哈希合并，并按 `Source Apply`、`Forward revision Apply` 的顺序分开保留来源。每个来源都会保留自己的已验证次数、最新 Apply 时间与 Manifest 版本信息。同一正文同时具有两种来源时显示 mixed，不会重新标签为某一种。mixed 本身不会自动授权提案；只有当前详情的规范权限可由 Source Apply 证明时才能提案，若详情权限是 Forward 则明确阻断。

## 文件夹导入结果

| 界面结果  | 含义                                              |
| --------- | ------------------------------------------------- |
| imported  | 新复制并进入持久注册流程的文件数                  |
| reused    | 目标已存在且字节/注册兼容，安全复用               |
| skipped   | 不支持的格式或没有唯一 parser                     |
| conflicts | 目标字节、类型、大小写或注册不兼容；没有覆盖      |
| failed    | renderer 读取某个所选文件的字节失败；批次继续处理 |

内部 receipt 还跟踪 discovered、eligible 和 imported bytes，但当前 UI 汇总不显示它们。复制、发布或注册等系统性错误会让整批操作显示 `Folder import could not be completed`，不会被计入 `failed`。

## 支持格式与批量上限

| 项目                     | 当前限制                                                  |
| ------------------------ | --------------------------------------------------------- |
| 支持导入后缀             | `.md`、`.markdown`、`.txt`、`.pdf`                        |
| 每批选择文件数           | 最多 1,000                                                |
| 单个合格文件             | 最多 8 MiB                                                |
| 每批合格文件总量         | 最多 128 MiB                                              |
| 文本内容                 | 非空、严格 UTF-8、最多 8,000,000 个字符                   |
| PDF 内容                 | 最多 2,048 页、最多 8,000,000 个提取字符                  |
| Schema                   | 非空、严格 UTF-8、最多 1,000,000 bytes                    |
| Vault 目标路径           | 最多 240 个字符                                           |
| 文件夹相对路径条目       | 最多 1,024 个字符                                         |
| Query 输入               | 最多 1,000 个字符                                         |
| Knowledge Draft 标题     | 必填单行、首尾无空白；JavaScript `string.length` 最多 200 |
| Knowledge Draft 正文     | 必填；JavaScript `string.length` 最多 1,000,000           |
| Knowledge Draft 渲染结果 | 标题、空行和正文合计最多 2,000,000 UTF-8 bytes            |
| Save to Wiki 标题        | 最多 256 个字符                                           |

这些是产品边界，不是建议的日常批量大小。为了便于审核，通常应该使用更小的主题批次。

## Bundle 字段

| 字段          | 类型       | 含义                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------ |
| `version`     | 数字       | 当前配置版本，使用 `1`                                                   |
| `id`          | 字符串     | Vault 内唯一 Bundle ID                                                   |
| `sourceRoots` | 字符串数组 | user-managed 与 system-managed 来源所在根目录；当前日常链路要求恰好一个  |
| `wikiRoot`    | 字符串     | 系统可提议写入的 Wiki 根目录                                             |
| `schemaRef`   | 字符串     | 用户维护的 Schema 文件                                                   |
| `reviewMode`  | 枚举       | `always`、`multi_file` 或 `trusted_generated_only`；当前都不会自动 Apply |

完整示例和路径规则见 [Bundle 配置](bundle-configuration.md)。

## 能力矩阵

| 能力                                               | 当前状态                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Windows Obsidian Desktop                           | 支持                                                                                    |
| 单人、一个有效 Bundle、一个 sourceRoot             | 支持                                                                                    |
| `.md` / `.markdown` / `.txt` / 可提取文本 PDF 摄入 | 支持                                                                                    |
| 文件夹一次性快照                                   | 支持                                                                                    |
| Vault 文件 Add to Knowledge                        | 支持                                                                                    |
| 完整 AI 回答 Create Knowledge Draft                | 已实现，并通过自动化与有界 Windows 实测                                                 |
| Activity / Review / 显式 Apply / Limited Recovery  | 支持                                                                                    |
| Grounded answer Source evidence                    | 当前只支持 `.md`                                                                        |
| PDF 检索引用与精确页跳转                           | 支持；不进入综合回答 evidence                                                           |
| Save to Wiki → no_changes 或 Review/Apply          | 支持                                                                                    |
| Source / Forward effective 页头和检查器来源披露    | 已实现并有自动化；用户计划的真实 Windows Obsidian 验收待完成                            |
| 重复 Forward revision 精确链                       | 已实现并有 Windows 路径/大小写边界检查；真实 Windows Obsidian 验收待完成                |
| Forward-only 历史输出发起另一提案                  | 当前不支持                                                                              |
| Sources Missing / 精确原路径复查                   | 已接入并通过 Windows 有界实测                                                           |
| 来源退役                                           | 已接入并通过 Windows 有界实测                                                           |
| Setup & status 三卡本地诊断                        | 已实现并有自动化；Windows 主窗口已配置路径已验收，配置失败 / Recovery / popout 实机待补 |
| 物理右键提示                                       | 已接入；Windows 实机待验收                                                              |
| 文件夹持续同步                                     | 不支持                                                                                  |
| URL / 浏览器 / 单文件 Explorer Knowledge 导入      | 不支持                                                                                  |
| OCR / 扫描 PDF                                     | 不支持                                                                                  |
| 自动 Review / 自动 Apply                           | 不支持                                                                                  |
| 新路径替换来源 / 自动删除来源或 Wiki               | 不支持                                                                                  |
| 多 Bundle 自动选择                                 | 不支持                                                                                  |
| 跨平台 Knowledge Studio                            | 不支持                                                                                  |
| 多实例 / OneDrive / 网络文件系统                   | 未验收                                                                                  |

> 本轮 R3c-b4/b5 的 effective 页头、重复 Forward 链和 sticky recovery 终结动作尚未由用户在真实 Windows Obsidian 中验收。表中的“已实现”只表示代码与自动化已就绪，不表示 Windows 实机验收已经完成。

## 网络调用速查

| 操作                                             | 是否调用 DeepSeek                               |
| ------------------------------------------------ | ----------------------------------------------- |
| 打开 Studio、查看 Setup、启动预检、Recovery 核对 | 否                                              |
| 从 Setup 打开 Copilot 设置                       | 不调用 DeepSeek；设置页可能执行插件更新检查     |
| 枚举/复制文件夹、本地 PDF 提取、SHA-256 校验     | 否                                              |
| 新 Source 编译                                   | 通常是，分析与生成两个阶段                      |
| 已有持久证明且输入/输出精确未变化                | 否                                              |
| 读取已验证的 Forward effective 页头              | 否；不调用模型修复或重新编译                    |
| 有合格证据的 Grounded Query                      | 是，单独回答请求                                |
| 无合格证据的 Query                               | 否，返回 Insufficient evidence                  |
| Save to Wiki 点击本身                            | 创建本地 managed source；随后编译可能调用       |
| Create Knowledge Draft 点击本身                  | 创建并登记本地 managed source；随后编译可能调用 |
| Review 选择                                      | 否                                              |
| Apply                                            | 否，执行本地确定性事务                          |

## 术语

### Bundle

一个 Project 声明的知识边界：Sources、Wiki、Schema 和审核策略。

### Manifest

持久记录已注册 Source、来源身份和成功编译结果的内部清单。用户不应手工编辑。

### Source-applied 基线

最后一次成功普通 Source Apply 为某个页面提交的精确正文。当 Forward revision 活跃时，Manifest 仍保留这个真实基线，不会把人工正文冒充为重新编译结果。

### Effective 当前页头

现在应被检查器和 Query 读取的精确 Wiki 正文。没有活跃 Forward revision 时它等于 Source-applied 基线；有活跃 Forward revision 时它等于链上最后一个已验证 Forward 哈希。

### Forward revision

用户审核后对当前 Wiki 页的前向修订。重复 Forward 在同一 Bundle / Source / 页上形成单一活跃链：来源基线哈希不变，每一次都以上一个 effective 哈希作为精确 CAS 前件。只有成功提交同一 Source 精确页面的后续普通 Source Apply 才能取代它；其他页的 Apply 和 `no_changes` 都会保留它。

### managed copy

插件在 sourceRoot 创建并登记、可以由用户有意更新的本地来源副本。Folder Import 创建外部文件夹的精确快照；Chat Knowledge Draft 创建核对、编辑后的 AI 回答 Markdown。外部原件不会持续同步，Vault 副本字节变化会形成来源的新 revision。

### Chat Knowledge Draft

用户从一条完成的非错误 AI 回答创建的 `managed_copy` Markdown Source。正文预填前清理隐藏 reasoning/tool 内容，标题初始为空；用户必须编辑、核对并显式勾选确认。窗口绑定并显示打开时的 Bundle/sourceRoot，换代不会改投新目标。它不自动继承 Chat citations 或原始证据关系，创建本身不调用模型或写 Wiki；`Stop creation` 只是请求停止，持久边界不确定时必须检查 Sources/Activity 后再精确重试。

### user-managed source

本来就在 sourceRoot 内、由用户维护并通过 Chat `Add to Knowledge` 注册的文件。

### no_changes

编译器和校验证明当前输入不需要改变 Wiki。任务 Completed，但没有空 Review，也没有 Apply。

### ChangeSet

模型提出、Core 严格验证的一组候选文件变化。它不是写入授权。

### Review

你对 ChangeSet 中每个文件或区块作出的接受/拒绝决定。

### Apply

在重新验证提案、来源、目标和事务状态后，把已接受变化写入 Wiki 的本地事务。

### pipeline fingerprint

来源解析、Schema、编译器、模型行为和输出契约的组合身份。Source 字节没变但这些规则改变时，系统仍可能重新编译。

### durable revision

当前持久状态的单调版本。命令基于旧 revision 时会 stale，而不是覆盖新状态。

### Runtime v9

当前 Vault 私有持久状态的外层格式。v5 曾在 v4 的完成证明基础上引入受保护的来源退役 tombstone 与降级保护；当前 v9 继续保留这份证明，同时承载后续增加的持久权威。旧版本升级由插件原子处理。它不是 Bundle 的 `version: 1`，也不应由用户手工编辑。

### OKF

Knowledge Bundle 输出所遵循的可互操作知识结构约定。它不是数据库、向量索引或 Agent Runtime。当前 production 还强制：生成目标必须为 `.md`；普通知识页必须有 YAML frontmatter 和非空字符串 `type`；`index.md` frontmatter 只能含 `okfVersion`，且只有 Bundle 根 `index.md` 可声明 `"0.1"`；`log.md` 不得有 frontmatter；Markdown/Wiki 链接、URL/裸 URI、电子邮件地址、原始 HTML 标签和 delete 仍禁用。自定义 Schema 不能放宽这些约束。

## 相关页面

- [手册首页](index.md)
- [Bundle 配置](bundle-configuration.md)
- [知识来源与导入](sources-and-import.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [故障排查](troubleshooting.md)
