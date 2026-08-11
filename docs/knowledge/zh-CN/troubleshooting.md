# 故障排查

> 原则：先读界面状态，再执行界面明确允许的动作。不要通过编辑私有 Runtime 或反复导入来“撞过去”。

## 本页目标

按你看到的症状找到安全的下一步。如果一个问题涉及 `Applying`、`Finalizing`、`Recovery required` 或文件字节冲突，先备份整个 Vault。

## Knowledge Studio 启动、刷新与不可用

### 显示 Refreshing Knowledge Studio…

这是中性、无操作的安全过渡页，不是红色 unavailable 故障。它通常出现在启动核对，或 `Check again`、`Remove`、导入、Project/设置变化促使插件撤销旧 generation 并建立新代时。

- 操作、Query 和旧引用会暂时停用，防止误用旧代权限。
- 这不表示前一步失败；不要立即重复点击、导入或重载插件。
- 正常情况下，完成持久状态和配置验证后会自动返回 Studio。

如果长时间停在这里，按下方“Studio 一直显示加载或 Refreshing”处理。只有系统已判定存在需要处理的持久配置、Runtime 或 Recovery 等终态问题时，才应显示红色 `Knowledge Studio unavailable`。

### 显示 Knowledge Studio unavailable，正文提示 No project has a Knowledge Bundle configuration

原因：当前 Project 没有 `copilot-project-knowledge-bundle`。

处理：按 [Bundle 配置](bundle-configuration.md) 创建配置、目录和 Schema，然后等待插件自动重新验证。

### 显示 Knowledge Studio unavailable，正文提示 invalid 或 adapter unavailable

依次检查：

1. 是否在 Windows Obsidian Desktop，而不是移动端或其他平台。
2. 是否只有一个有效 Bundle；当前不会自动选择多个 Bundle。
3. Bundle 是否只有一个 sourceRoot。
4. sourceRoot、wikiRoot 和 schemaRef 是否存在、互不重叠、大小写精确一致。
5. DeepSeek V4 模型、官方 endpoint 和 API Key 是否可用。
6. Recovery 页是否有阻断项。

修改设置或 Project 后，系统会自动重建 generation；中间可能短暂显示 `Refreshing Knowledge Studio…`，通常不需要反复重载插件。

### Studio 一直显示加载或 Refreshing

先等待启动恢复和来源扫描完成。这个无操作页面本来就不显示 Activity 或 Recovery 页签，因此不要把“先检查这些页签”当成能够继续操作的前置条件。如果长时间不变：

1. 停止新的导入、Project/设置修改和来源文件编辑，不要重复提交刚才的动作。
2. 查看 Obsidian 错误控制台，但不要复制密钥、来源内容或请求/响应正文。
3. 如果页面始终没有恢复，你此时无法从 Studio 证明是否存在 Apply/Finalizing；按未知状态处理，先停止并备份完整 Vault，再禁用并启用插件一次。
4. 重新启动后，若 Recovery 页签出现，先按其中明确允许的动作处理；若出现红色 unavailable，则按它的正文继续排查。仍不恢复时保留备份并停止操作，不要编辑私有 Runtime。

## 文件夹导入问题

### 点 Import folder 后没有变化

- 系统对话框取消选择是正常 no-op。
- 确认你选择的是文件夹，不是单个文件。
- 确认只有一个有效 Bundle 和一个 sourceRoot。
- 查看按钮旁的聚合提示和 Activity。

### imported 为 0，reused 大于 0

相同文件已经按精确字节存在并注册。这是安全、幂等的成功结果，不会重复启动模型任务。

### 出现 skipped

文件格式不受支持，或文件没有唯一 parser。当前只接受 `.md`、`.markdown`、`.txt`、`.pdf`。

### 出现 conflict

目标路径已经存在不同字节、目录、大小写变体或不兼容注册。系统不会覆盖。

处理：比较外部文件和 Vault 副本，决定保留哪一个；在 Activity 没有活跃写入时手工换一个导入根目录名称，或先有意识地整理 Vault。不要直接删除插件私有状态来强迫覆盖。

### 出现 failed 或部分成功

已成功文件会保留。修复权限、路径或存储问题后，用同一文件夹精确重试；相同字节会 reused。若每个文件都系统性失败，停止重试并查看错误类别。

### 为什么外部目录改了，Vault 没变

文件夹导入是一次性快照，不是同步。再次导入时，相同字节复用，不同字节报告冲突。

## Sources 与来源缺失

> 来源缺失隔离、复查、精确恢复和一次性来源的二次确认 `Remove` 都已通过 Windows 有界实测；现有真实来源没有被拿来做退役验收。

### Sources 显示 Missing

这表示系统不能在该来源注册时的精确 Vault 相对路径证明文件仍然可用。可恢复的 missing/delete/rename 只隔离受影响来源：它的摄入与 Review 停止，旧 Query citation 权限失效；已经发布的正常运行代中，其他健康来源和 Studio 不应因此整体 unavailable。Sources 页面已打开时也会自动从 `Ready` 刷新到 `Missing`；只有精确原路径恢复且新捕获收敛后才回到 `Ready`。

安全处理只有两条：

1. 需要继续使用：把文件恢复到 `Sources` 显示的**精确原路径**，再点 `Check again`。只有放在其他目录、改变大小写或重新导入为另一条路径都不算恢复。
2. 永久停止跟踪：点 `Remove`，阅读后果并完成第二次确认。

当前没有“选择替代文件”或改绑到新路径的入口。`Check again` 只重新核对持久状态，不会创建、复制、移动或覆盖文件，也不会把一次失败核对伪装成成功。

### 为什么启动后只能使用 Sources

如果冷启动只被同一个 Bundle 的可恢复来源缺失和 `source_observation_pending` 卡住，系统会在正常 Queue release 之前提供一个最低权限的 Sources-only 恢复界面。这里只能查看来源、`Check again` 或 `Remove`；worker、模型、Query、Review、Apply 与 Wiki 写入都保持关闭。恢复精确原路径并复查，或安全退役该来源后，系统会重新走完整启动验证。

### Remove 按钮没有出现

真实的活跃 Queue/Activity、待决 Review/Apply、Recovery、事务或 rerun 工作会阻断退役。先让相应工作到达稳定终态，再刷新 Sources；目标来源尚处于 allocated/bound 的观察会由退役提交原子终结，不需要等待它形成永久循环。不要编辑私有 Runtime/Manifest 来强制启用按钮。

Remove 成功后不会删除来源文件或既有 Wiki 文件。它只移除 active Manifest 成员资格并撤销该来源的 provenance 与未来摄入、Review、Query citation 权限；既有 Queue、Review、Apply ledger 历史会保留，来源身份与路径也会保留在受保护退役记录中，防止再次 `Add to Knowledge` 时被静默注册成新来源。当前没有一键撤销。

### 文件菜单提示没有阻止删除

这是预期边界。插件只在 Obsidian 文件菜单中显示警告并导航到 Knowledge Studio；它不能拦截键盘删除、其他原生删除入口或 Windows Explorer 操作，也不能访问回收站。外部删除发生后，使用上述 Source Missing 流程。

## Activity 问题

### Completed 但 Review 为空，Wiki 没变化

最常见原因是 `no_changes`：编译成功，但当前 Wiki 不需要修改。它不会生成空 Review，也不会写 Wiki。

如果你明确预期新页面：

- 确认 Schema 要求确实会产生相应页面。
- 确认 Source 有可提取内容。
- 检查 Activity 是否为 `Failed` 或 unresolved repair，而不只是 Completed。
- 不要反复改几个空格来强迫模型生成。

### Awaiting review

任务正在等待你。点击行内 `Review` 或切换到 Review 页，完成每个文件/区块的决定并提交。

### Rate limited / Paused

Rate limited 表示提供商或队列要求等待。普通用户 Pause 可以在安全时 Resume；Recovery 类型 Pause 不能用 Resume 绕过。

### Failed

只有按钮启用时才 Retry。先读安全错误类别：

- provider/rate limit：检查 DeepSeek 服务和额度。
- source changed：等待新观察，或重新打开 Activity。
- invalid source/PDF：修复来源内容；若文件已缺失，按 Sources 的精确原路径恢复或安全退役流程处理。
- output repair unresolved：先恢复或有意识地处理异常 Wiki 输出。

### Finalizing 长时间不结束

先进入 Recovery 并 `Check again`。不要 Cancel、Pause 或手工编辑目标 Wiki。重启后仍不变时，停止操作并备份。

## Review 与 Apply 问题

### Accept 按钮禁用

可能原因：

- 提案只允许 Reject。
- 目标或来源自快照后已变化，Review 已 stale。
- 另一事务占有全局写入槽。
- Recovery 或 finalizing 阻断 Apply。
- 你还没有决定每个文件和 changed block。

刷新 Review；不要通过改 DOM、编辑 Runtime 或重复点击绕过。

### Submit review 按钮禁用

必须给每个文件作出决定；允许区块级选择时，每个 changed block 也必须决定。页面底部会提示尚未完成。

### Apply 后页面没有立即出现

先看 Activity 是否处于 `Applying` 或 `Finalizing`。只有持久确认完成后才把它当成成功。不要在这个窗口手工创建同名文件。

### Nested create 被阻止

Windows 写入适配器要求新文件的父 Wiki 目录已经存在。先在安全状态下创建所需父目录，再重新产生/处理提案；系统不会为此隐式创建未知目录。

## 文本与 Schema 解析问题

### `.md`、`.markdown` 或 `.txt` 在 Parsing 失败

Knowledge 文本 parser 只接受非空、严格 UTF-8、可按原字节 round-trip 的文本；单文件还必须不超过 8 MiB 和 8,000,000 个字符。Windows 常见的 GBK/ANSI 文件即使已经成功复制/注册，也会在随后 Parsing 阶段失败。

用可信编辑器把原文件显式转换为 UTF-8，核对内容后再更新 Vault Source。不要只改扩展名，也不要把解码错误的乱码保存成“UTF-8”。

### Schema 无法读取

Schema 必须非空、严格 UTF-8，且不超过 1,000,000 bytes。修复后，在没有 `Applying`/`Finalizing` 时禁用并启用插件或完整重启 Obsidian；当前 watcher 不会只因 Schema 文件保存而自动建立新 generation。

## PDF 问题

### PDF 被跳过或失败

确认：

- 文件扩展名为 `.pdf`。
- PDF 未加密、未损坏，且包含可复制文本。
- 原始文件不超过 8 MiB，页数不超过 2,048，提取文本不超过 8,000,000 个字符。
- 它位于受支持的导入或 sourceRoot 路径中。

扫描图片型 PDF 需要 OCR，而当前 Knowledge 不提供 OCR。

### 点击 PDF 引用打不开原页

来源 PDF 字节可能已经改变，或 Query/插件代次已被替换。重新执行 Query 获取当前引用；不要尝试复用旧 citation token。

### PDF 出现在检索结果，但回答仍 Insufficient evidence

当前 PDF 页可以作为检索命中和可打开引用显示，但直接 PDF evidence 不参与现有 synthesized-answer 路由。这是当前支持边界，不是 Plus 订阅问题。

## Query 问题

### No applied Wiki excerpt matched

Query 只搜索已接受、已 Apply、且哈希仍验证通过的 Wiki。未审核 Source、普通 Vault 笔记和已外部改变的 Wiki 不会被偷偷加入。

先完成 Review/Apply，或换一个与已应用 Wiki 更接近的问题。

### Insufficient evidence

系统找到的证据不足以支持答案。查看 `Evidence still needed`，继续补充来源；不要把它理解为模型服务失败。

如果来源只有 `.markdown`、`.txt` 或 PDF，它们可以摄入和生成 Wiki，但当前不能作为 grounded-answer 的 `.md` Source evidence；PDF 仍可显示检索命中和页跳转。需要综合回答时，补充真实 `.md` 来源并重新走 Review/Apply。

### 引用突然失效

新 Query、来源变化、插件重载或 generation 更新会撤销旧的不透明引用。重新查询并使用新引用。

### Save to Wiki 不可用

只有当前、受支持的 Supported 或 Partial 回答，且至少有一个已验证 claim 时才能保存。Insufficient evidence、旧 Query、来源已变或 writeback generation 不可用都会禁用保存。

## DeepSeek 问题

- 确认显式选择 `deepseek-v4-flash` 或 `deepseek-v4-pro`。
- 旧 `deepseek-chat`、`deepseek-reasoner` 不会自动迁移。
- 确认使用官方 endpoint、Key 有效且账户有额度。
- thinking 模式下不要强行配置不支持的 Temperature、Top P 或 Frequency Penalty 组合。
- 网络错误后不要连续重复导入；先看 Activity 是否已经持久成功，避免重复费用。

## 安全收集诊断信息

可以记录：

- Windows、Obsidian 和插件版本。
- Bundle 是否 ready、durable revision、Activity/Recovery 状态。
- imported/reused/skipped/conflict/failed 的计数。
- 脱敏错误名称和发生时间。
- 相对路径的匿名化描述。

不要记录：

- API Key、Authorization header。
- DeepSeek 请求/响应正文。
- Source、Schema、Wiki 的私人内容。
- 外部绝对路径和个人用户名。
- 插件私有 Runtime 全文。

## 数据、网络与费用影响

排查 Studio 配置、Recovery、路径和本地文件通常不需要模型。Retry、重新编译、Query 和 Save 后的编译可能调用 DeepSeek；确认状态后再操作。

## 相关页面

- [15 分钟快速开始](quick-start.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [维护与恢复](maintenance-and-recovery.md)
- [参考手册](reference.md)
