# 维护与恢复

> 适用范围：Windows 个人版。恢复功能是对持久状态的受限操作，不是通用“强制修复”按钮。最近核对：2026-08-25。

## 本页目标

这页帮助你长期维护 Knowledge Bundle、正确备份，并在 `Recovery` 或异常终止后使用系统允许的恢复动作，而不破坏可追溯性。

## 前置条件

- Knowledge Studio 能显示 Bundle ID 和 durable revision。
- 你知道 Sources、Wiki、Schema 各自的目录。
- 你有整个 Vault 的可恢复备份，而不只是 Wiki 的副本。

## 日常健康检查

每次集中导入后按这个顺序检查。修改 Schema 时，先确认没有 `Applying`/`Finalizing`，再禁用并启用插件或完整重启 Obsidian；当前 watcher 不会因为只保存 Schema 文件就自动建立新运行代。

1. 打开活动（`Activity`），确认 Bundle 状态最终回到 `Running`。
2. 处理 `Awaiting review`，不要长期积压无法判断来源的提案。
3. 确认没有 `Applying`、`Finalizing` 或 `Recovery required` 长时间停留。
4. 打开审核（`Review`），确认所有待决文件都有明确决定。
5. 做一次代表性查询（`Query`）；本批含 `.md` 或已应用 PDF provenance 时，打开至少一个当前支持的来源引用。
6. 再执行 Vault 备份或 Git 提交。

`Completed` 且 Review 为空可能是 `no_changes`，不是错误。它表示这个输入已经处理，但没有需要你应用的 Wiki 修改。

## 推荐备份方式

### 日常 Git 备份

你可以用 Git 版本化 Sources、Wiki、Schema 和普通笔记。建议：

- 一次导入完成、Review 已处理后提交一次。
- 修改 Schema 前提交一次，修改并稳定后再提交一次。
- 不把 API Key、密码或令牌写进版本库。
- PDF 等大文件很多时，评估 Git LFS 或额外的文件备份方案。

### 完整恢复备份

Git 通常不覆盖插件所有私有状态。需要真正可恢复的快照时：

1. 等待 Activity 没有 `Applying` 或 `Finalizing`。
2. 退出 Obsidian，或至少禁用插件并确认写入停止。
3. 备份整个 Vault，包括隐藏的 `.obsidian` 配置目录。
4. 验证备份能在另一个位置正常读取。

旧安装若仍使用标准 API Key 存储，`.obsidian/plugins/copilot/data.json` 可能包含明文密钥。应该先迁移到 Obsidian Keychain；无论是否迁移，完整 Vault 备份都应加密并限制访问。

**禁止**只复制或回滚插件的 Runtime、Manifest、事务 journal 中某一个文件。它们共同描述一次持久事务，混合不同时间点的文件可能让系统安全阻断。

## 什么时候可以重启

- `Running`、`Paused`、`Completed`、`Awaiting review`：通常可以正常退出并重启。
- `Parsing`、`Analyzing`、`Generating`：可以退出，但未完成工作可能在下次启动恢复或重试。
- `Applying`、`Finalizing`：应该等待它到达稳定终态；除非应用已失去响应，不要主动中断。
- `Recovery required`：可以重启，但重启不会替你作出需要人工授权的决定。

重启后，若 `Recovery` 页签出现就先处理它；没有该页签时先看 Activity。不要因为列表暂时为空就立即重复导入；系统需要先完成持久状态核对和来源扫描。

这个启动核对，以及 `Check again`、`Remove`、导入或 Project/设置变化触发的正常 generation 换代，都可能短暂显示中性 `Refreshing Knowledge Studio…`。此时旧代权限已撤销，操作按钮暂停；这不表示刚才的操作失败。等待新代自动就绪，不要重复点击或通过编辑私有 Runtime 绕过核对。只有已判定的持久配置、Runtime 或 Recovery 等终态问题才会显示红色 `Knowledge Studio unavailable`。

### Forward revision startup recovery

从 `Known applied outputs` 提出的历史版本若未能在接受后立即开始 journal，会独立显示在 `Review`：

- `Accepted revision ready to apply` 表示决定已持久保存但尚未创建文件 journal；它不会因为 reload/disable 消失。若仍要应用，点击 `Validate and apply` 重试当前精确核对。若改变主意，可在界面仍能证明 journal 和 Wiki 写入从未开始时点击 `End without writing`；这会记录“写入前结束”，不改 Wiki，也不创建 journal、Apply ledger 或 overlay。
- `Applying accepted revision` 表示 durable journal 已拥有这次单页转换。若它长时间停留，重新加载插件会在启动期只凭持久 journal 和当前文件字节继续核对，不会调用模型、parser parse 或网络。
- `Forward Apply needs recovery` 表示文件既不匹配 journal 的精确 before，也不匹配精确 after，或写后验证无法可靠完成。此状态是 sticky，没有普通 Retry/Resume；当前 Review 卡片会提供两个专用动作，但系统不会自动覆盖文件，reload 也不会自行清除冲突。

遇到 sticky Forward recovery 时，先备份整个 Vault，并记录界面显示的页面路径与冲突类别。不要直接编辑 Runtime、Manifest、journal 或 ledger，也不要反复点击普通 Apply。

Forward 恢复执行器始终先重新读取当前 Wiki 的精确字节，再决定哪一个动作合法。当前 Studio 已在 `recovery_required` 卡片接入 `Recheck / retry exact Apply` 和 `Keep current (no write)`；只有当前 generation 提供 Forward 命令能力且没有其他命令在进行时，按钮才可用。它们不接受用户自报的文件状态，每次都先由恢复边界重新观察。

| 恢复动作                      | 精确观察后的行为                                                                                                                                                | 会不会写 Wiki                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Recheck / retry exact Apply` | 始终先重读文件。已是精确 accepted after-state 时只收敛确认；仍是 exact-before 且 journal 处于允许重试的写入阶段时，本次命令才做一次 exact CAS；第三状态保持阻断 | 只有合格 exact-before 可能写；after-state 与冲突状态都不写                       |
| `Keep current (no write)`     | 始终先重读文件。exact-after 收敛为已提交；普通、仍可重试的 exact-before 会被拒绝；其余只在当前 journal 阶段允许零写入终结时才保留当前字节                       | 从不写；终局按阶段记录“写入前放弃 / 写入结果不确定后外部取代 / 已提交后外部取代” |
| 强制覆盖                      | 永远不合法                                                                                                                                                      | 没有 force 路径，不会猜测、回滚或覆盖外部字节                                    |

`Keep current (no write)` 不是把冲突冒充为 Apply 成功，也不会把每一种 journal 阶段统一冒充为“外部取代”。它保留 Vault 字节不变：写入前阶段记录“写入前放弃”，写入结果不确定阶段记录“不确定写入后外部取代”，已有提交标记的阶段记录“已提交后外部取代”。任何路径都不会为了结束 recovery 而强制写文件。

### Forward 链与 Source Apply 取代

同一 Bundle / Source / Wiki 页的多次 Forward 修订会形成一条精确链：每一次都必须从上一个 effective 当前哈希开始，但仍保留最后一次 Source Apply 哈希作为不变的来源基线。一次成功的后续 Forward Apply 可以在精确身份和 CAS 链路一致时取代上一次 Forward。

普通 Source Apply 只在它成功提交了同一 Source 的这一个精确目标页时，才能成为持久的取代证明并移除该页的活跃 Forward 层。对其他页的 Apply 会保留这个 Forward 页头；真实 `no_changes` 也会保留它，因为 `no_changes` 只证明无需写入，不会虚构一笔新 Source Apply ledger。

## Recovery 动作

恢复（`Recovery`）页只显示当前状态允许的按钮。没有按钮不是界面损坏，而是系统拒绝猜测一次危险写入应该怎样结束。

| 动作          | 何时出现                                        | 含义                       | 使用原则                     |
| ------------- | ----------------------------------------------- | -------------------------- | ---------------------------- |
| `Continue`    | 已接受但未开始，或无 journal 且可安全决定的状态 | 重新核对后继续原来的 Apply | 只有你仍希望应用原提案时使用 |
| `Abandon`     | 尚未开始文件写入、且系统明确允许放弃            | 放弃该 Apply 决定          | 确认不需要该提案后使用       |
| `Check again` | 活跃、阻断、finalizing 或全局事务状态           | 重新读取持久状态           | 它不强制继续，也不回滚文件   |

### Accepted, not started

Review 已接受，但 Apply claim 尚未开始。先确认目标 Wiki 没有被你手工修改；若仍要应用，选择 `Continue`。

### Decision required

存在 Apply claim，但没有可继续执行的 transaction journal。你可以在系统允许时选择 `Continue` 或 `Abandon`。不要同时手工修改相关 Wiki 文件。

### Transaction active / Commit finalizing

系统正在完成或确认一笔持久事务。使用 `Check again`，并等待状态推进。不要 Pause/Resume 来绕过它。

### Apply blocked / Queue recovery required

自动写入已停止。先查看阻断原因和 Recovery 项；普通 `Resume` 不会清除事务恢复要求。

### Global transaction

另一个 Vault 级事务占有写入槽。等待它结束，然后 `Check again`。当前版本面向单实例个人使用，不要同时开启两个 Obsidian 实例操作同一 Vault。

## 来源或输出被外部修改

### Source 改变

修改已注册 Source 会产生新的来源观察，并可能触发重新编译。旧 Query 引用和旧 Save 权限可能立即失效，这是防止引用过期字节的正常行为。

### Source Missing

当前分支的 `Sources` 页会把可恢复的 missing/delete/rename 持续显示为 `Missing`；这类问题只隔离受影响来源，不应让已经发布的正常 Studio 运行代整体 unavailable。已经打开的 Sources 页也会自动从 `Ready` 刷新为 `Missing`；精确原路径恢复并完成新捕获后，再自动回到 `Ready`。删除与恢复往返、一次性来源的二次确认退役都已经通过 Windows 有界实测。

如果冷启动只被同一 Bundle 的来源缺失和 `source_observation_pending` 共同卡住，Studio 会提供一个启动前的 Sources-only 恢复界面。此时只能查看来源、`Check again` 或 `Remove`；Queue worker、模型、Query、Review、Apply 与 Wiki 写入仍保持关闭。这不是普通 Studio 已经放行。

- 能恢复原文件时：放回界面所示的同一个 Vault 相对路径，再点 `Check again`。
- 只有另一个副本时：先由你核对并恢复到界面所示的精确原路径，再点 `Check again`；当前界面不会从任意新路径替换或覆盖来源。
- 确定永久停止跟踪时：使用 `Remove` 并完成第二次确认。

Remove 不删除来源文件或既有 Wiki 字节，但会从 active Manifest 移除该来源、撤销当前 provenance 和未来摄入/审核/引用权限，并永久保留来源身份与路径，防止静默重新注册。既有 Queue、Review 和 Apply ledger 历史会保留；目标来源尚处于 allocated/bound 的观察会在退役提交中被原子终结。真实的活跃 Queue/Activity、待决 Review/Apply、Recovery、事务或 rerun 工作仍可能阻断 Remove；按钮不可用不是界面故障。

`Check again` 或 `Remove` 促使系统重建运行代时，界面可能先进入上述中性 refreshing 页，再返回正常 Studio 或 Sources-only 恢复界面。不要因为这个间隙重复恢复文件、重复退役或删除私有状态。

Obsidian 文件菜单只能提示并导航到 Studio，不能拦截键盘或 Windows Explorer 删除，也不能访问回收站。

### Wiki 输出丢失或变化

系统会对已跟踪的输出做存在性和 SHA-256 核对。缺失或字节变化可能触发 repair compile：

- 如果模型提出修复，会停在 Review。
- 如果输出仍旧异常而模型声称 `no_changes`，任务会进入不可自动重复的 unresolved repair，而不是无限调用模型。
- 恢复精确字节后，新的观察可以重新证明状态正常。

不要通过直接修改私有 Runtime 来把 repair 标成成功。

### 外部导入目录改变

文件夹导入是一次性快照。导入以后，Vault 内的 managed copy 才是 Knowledge 的来源记录；外部目录后续变化不会自动同步。需要更新时再次导入：相同字节会复用，不同字节会报告冲突且不会覆盖。

## 应该停止操作并先备份的情况

- Recovery 长时间显示 `Transaction active` 或 `Commit finalizing`，且重启后不变。
- Wiki 文件已改变，但 Activity/Review 无法解释这次变化。
- 插件报告 Runtime、Manifest 或 transaction journal 损坏。
- Windows 文件系统出现路径大小写冲突、junction/reparse point 或权限异常。
- 同一 Vault 曾被两个 Obsidian 实例同时写入。
- 你准备手工恢复一批 Sources 或 Wiki 文件到历史版本。

此时保持现场，退出 Obsidian，复制完整 Vault，再按 [故障排查](troubleshooting.md) 收集不含敏感内容的诊断信息。

## 你应该看到什么

健康终态通常是：

- Bundle：`Running`。
- Activity：没有活跃或恢复中的任务。
- Review：没有你尚未决定的提案。
- Recovery：没有恢复项时页签不显示；出现页签表示有内容需要查看。
- Query：能读取已经 Apply 的 Wiki，并能打开仍有效的引用。

## 数据、网络与费用影响

- `Check again`、启动预检和恢复核对本身不应调用模型。
- 重新编译 Source 或 repair compile 可能调用 DeepSeek，并产生费用。
- 精确未变化、且输出仍完整的观察会复用持久成功证明，不应再次调用模型。
- 完整 Vault 备份可能包含个人资料、聊天记录和插件配置，请加密并控制访问。

> 重复 Forward、精确恢复动作和 Source Apply 取代规则已有自动化与 Windows 路径/大小写边界检查，但尚未完成用户计划的真实 Windows Obsidian 实机验收。

## 相关页面

- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [Review 与 Apply](review-and-apply.md)
- [长期使用规范](operating-guidelines.md)
- [隐私与安全](privacy-and-security.md)
- [故障排查](troubleshooting.md)
