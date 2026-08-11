# 15 分钟快速开始

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`、DeepSeek V4。这里的 15 分钟指人工配置与操作时间，不包含模型排队、网络等待或长 PDF 解析时间。

## 目标

用一份小型、可核对的来源完成第一次 Sources → Activity →（`no_changes`，或 Review → Apply）流程；如果产生了已应用 Wiki，再执行第一次 Query。

本页不会把 `no_changes` 当成失败，也不会为了演示而绕过 Review。Wiki 只有在你明确接受并 Apply 后才会改变。

## 前置条件

- 已完成 [安装、升级与 DeepSeek V4](installation-and-model.md)。
- 已完成 [Bundle 配置](bundle-configuration.md)。
- 打开 Knowledge Studio 后显示真实 Bundle ID，Activity、Review、Query 已连接，且没有 Recovery 阻断。
- DeepSeek 账户有可用额度，网络可以访问 DeepSeek 官方 API。
- 先用一份不含秘密、体积很小的测试资料；不要把唯一原件作为第一次验收材料。

## 操作步骤

### 1. 准备一个可人工核对的来源文件夹

在 Vault 外创建一个临时文件夹，例如 `Knowledge Acceptance`，并在里面新建 `first-source.md`：

```markdown
# 知识库验收来源

- 事实：Personal Knowledge Studio 的首次验收日期是 2026-08-11。
- 决定：所有模型生成的 Wiki 修改都必须先由本人审核。
- 约定：原始来源保留在 Sources，接受后的综合知识保留在 Wiki。
```

你可以换成自己的真实小笔记，但最好包含清楚的事实、决定或定义。第一次不要使用扫描版 PDF、加密 PDF、超大文件、URL、电子邮件地址或复杂附件。

如果你使用 [Bundle 配置](bundle-configuration.md) 中的首次 Schema，它会要求模型在有明确事实时提出根目录下的 `facts.md`，因此更容易观察到非空 Review；模型和严格校验仍可能合法返回 `no_changes`，本手册不会承诺某个概率性输出。

### 2. 导入文件夹

1. 打开 **Knowledge Studio**。
2. 点击顶部 **Import folder**。
3. 在 Windows 系统文件夹选择器中选择刚才的 `Knowledge Acceptance` 文件夹。
4. 等待导入回执完成。
5. 打开 **Activity** 查看新任务。

这是一次性快照，不是同步关系。系统会把合格文件复制到：

```text
<sourceRoot>/Knowledge Acceptance/first-source.md
```

外部原件不会被改名、删除或持续监视。导入后的 Vault 副本成为 Knowledge 的持久来源；以后修改外部原件不会自动更新 Vault 副本。

### 3. 观察 Activity 到终态

Activity 会从持久队列读取真实状态。一个来源可能依次经过解析、分析、关联、生成和验证。

等待本次任务出现以下结果之一：

- **Awaiting review / Review**：编译器提出了 Wiki 修改，继续下一步。
- **Completed / no_changes**：处理成功，但没有必要修改 Wiki；跳到“如果得到 no_changes”。
- **Failed**：先查看失败是否可重试，按提示修复模型、文件或配置后再使用 **Retry**。

不要因为任务短暂没有变化就再次导入同一文件。精确相同的来源会复用已有副本和身份，正常情况下不会制造重复模型请求。

### 4. 审核并 Apply

如果出现 Review：

1. 打开 **Review** 页签或从 Activity 进入对应提案。
2. 逐个查看目标文件、操作类型和内容差异。
3. 核对每个重要事实是否来自刚才的来源，而不是模型猜测。
4. 对合格的 create/update 文件选择整文件或合格区块；也可以使用 **Accept all** 接受所有当前可接受修改。
5. 点击 **Submit review** 提交决定。接受决定会进入显式 Apply；当前界面不是模型自动写入，也不需要再寻找第二个 Apply 按钮。
6. 等待 Activity 完成最终提交确认。
7. 在 Vault 的 `wikiRoot` 中打开生成页面，核对实际字节和内容。

当前 delete 提案只能拒绝，不能接受。目标被外部修改、父目录不存在、路径被文件占用或快照已经过期时，Review 会停止写入；不要强行绕过。

### 5. 如果得到 no_changes

`no_changes` 是有持久证明的成功结果，不会生成空 Review，也不会写 Wiki。

如果这是一个全新空 Wiki，而你希望完成 Review/Apply 验收：

1. 确认测试来源确实含有一条明确事实。
2. 确认 Schema 明确要求在有受支持事实时维护 `facts.md`。
3. 修改 Vault 中的来源副本，加入一条新的、可核对的事实并保存。
4. 等待 watcher 为新字节创建新 Activity；不要只重新导入完全相同的外部文件。
5. 如果仍为 `no_changes`，保留结果并查看 [故障排查](troubleshooting.md)，不要手工伪造 Review 或编辑私有 Runtime。

### 6. 执行第一次 Query

只有存在已接受且已应用、当前字节仍通过校验的 Wiki 页面时，才进行这一步。

1. 打开 **Query**。
2. 提一个能由测试来源直接回答的问题，例如：“首次验收日期是什么？审核约定是什么？”
3. 检查结果状态：**Supported**、**Partial** 或 **Insufficient evidence**。
4. 检查每条结论是 **Source fact** 还是 **Inference**。
5. 点击引用，确认它能定位到精确 Markdown 证据；重要结论必须亲自读来源。

Query 只搜索当前 Bundle 已接受并应用的 Wiki，不会退回整个 Vault 搜索。没有合格证据时返回 **Insufficient evidence**，并且不会调用模型。

如果结果为 Supported 或 Partial，且包含至少一个已验证结论，可以试用 **Save to Wiki**。保存并不直接写 Wiki：它会创建受管理的 Markdown 来源并重新进入 Activity；随后可能以 `no_changes` 收敛，也可能进入 Review → Apply。详见 [Query、引用与 Save to Wiki](query-and-writeback.md)。

### 7. 做一次重启持久性检查

1. 记录当前 Activity 终态和已应用 Wiki 文件。
2. 正常关闭并重新打开 Obsidian，或停用再启用 Copilot。
3. 重新打开 Knowledge Studio。
4. 确认 Bundle ID、Activity 终态和 Wiki 内容仍在。
5. 对完全相同且输出完整的来源，重启扫描不应重复创建 Review 或重复调用模型。

如果重启后出现 Recovery，使用界面提供的 **Continue**、**Abandon** 或 **Check again** 中当前允许的操作；不要删除或编辑插件的私有运行状态文件。

## 预期结果

完成一次正常快速验收时，你应该能确认：

- 外部测试文件保持不变，Vault 中出现一份受管理的来源副本。
- Activity 展示真实持久任务，而不是演示数据。
- 有修改时，系统停在 Review，只有你的显式接受才会 Apply。
- 无修改时，任务以 `no_changes` 成功结束，Review 保持为空。
- Apply 后的 Wiki 页面位于配置的 `wikiRoot` 内。
- Query 只使用已应用 Wiki 和重新验证过的来源证据。
- 重启后状态仍能恢复，且相同输入不会无故重复处理。

满足以上适用分支后，插件就可以进入当前 Windows 单人、单 Bundle、单 `sourceRoot` 范围内的日常使用。

## 如果结果不同

| 现象                           | 先检查什么                                               | 不要做什么                                     |
| ------------------------------ | -------------------------------------------------------- | ---------------------------------------------- |
| Import folder 不可用           | Studio 是否就绪、是否恰好一个 Bundle 和一个 `sourceRoot` | 不要把外部绝对路径写进 Bundle                  |
| 导入回执出现 skipped           | 文件是否为 `.md`、`.markdown`、`.txt` 或 `.pdf`          | 不要把跳过的格式改后缀伪装成文本               |
| 导入回执出现 conflict          | Vault 目标已存在但字节不同，或目标是目录                 | 不要覆盖 Vault 目标来假装“重试成功”            |
| Activity 一直为空              | 是否导入成功、来源是否注册、Studio 运行代是否刷新        | 不要反复选择同一文件夹制造重复操作             |
| Review 为空                    | Activity 是否以 `no_changes` 完成                        | 不要把空 Review 当成数据丢失                   |
| Apply 被阻断                   | 父目录、目标字节、Review 快照或 Recovery 是否变化        | 不要手改 Runtime 或绕过显式审核                |
| Query 为 Insufficient evidence | 是否已有被接受并应用的 Wiki，来源证据是否仍匹配          | 不要期望 Query 搜索全部 Vault 或引用未应用提案 |
| 重启后要求 Recovery            | 是否有未完成 Apply、最终确认或队列恢复状态               | 不要删除事务文件或随意选择不可用动作           |

详细处理步骤见 [Knowledge Studio 与 Activity](knowledge-studio.md)、[Review 与 Apply](review-and-apply.md) 和 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 文件夹导入在本地读取选中的文件，并把合格文件复制到 Vault；不会保存外部绝对路径，也不会修改外部原件。
- `.md`、`.markdown`、`.txt` 和带文本的 PDF 在本地解析。当前没有 OCR；扫描版、加密或损坏 PDF 会失败关闭。
- 一个成功进入完整 Knowledge 编译的来源通常产生两次 DeepSeek 请求，来源正文、Schema 和必要的现有 Wiki 内容会离开本机。
- Review、Reject 和 Apply 是本地持久操作，不会因为点击审核本身再次调用模型。
- 有合格证据的 Query 通常产生一次 DeepSeek 请求；无证据 Query 为零请求。
- **Save to Wiki** 会形成一个新来源，随后可能再次产生两阶段编译费用。
- API Key 不会写入来源、Wiki、Review、日志或 Knowledge Runtime；请继续使用 Obsidian Keychain 保存它。

## 相关页面

- [中文使用手册首页](index.md)
- [安装、升级与 DeepSeek V4](installation-and-model.md)
- [Bundle 配置](bundle-configuration.md)
- [知识来源与导入](sources-and-import.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [Review 与 Apply](review-and-apply.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [维护与恢复](maintenance-and-recovery.md)
- [隐私与安全](privacy-and-security.md)
- [故障排查](troubleshooting.md)
