# 知识来源与导入

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`。最近核对：2026-08-12。

## 本页目标

本页帮助你区分“把文件放到允许的目录”和“把它登记为 Knowledge Source”，并选择正确的入口：

- 外部资料文件夹：在 Knowledge Studio 使用 `Import folder`（导入文件夹）。
- 已经位于唯一 `sourceRoot` 内的 Vault 文件：从 Obsidian 文件列表拖进 Chat，再选择 `Add to Knowledge`（加入知识库）。
- 只想让当前对话临时阅读文件：选择 `Use in this chat`（仅用于本次聊天）。
- 想把一条已经完成的 AI 回答整理成长期来源：在回答操作栏选择 `Create Knowledge Draft`，编辑并核对后创建。
- 已注册来源丢失或不再需要：在 Knowledge Studio 打开 `Sources` 页（来源）。

这些路径的效果不同；`sourceRoot` 是允许存放文件的 Vault 目录，`Sources` 页是已登记来源的维护入口。导入、捕获或注册来源只会启动后台知识编译，不会直接修改 Wiki。

## 前置条件

开始前必须满足：

1. Knowledge Studio 顶部显示真实 Bundle ID 和 durable revision。
2. `Activity`（活动）已经连接，没有 `Knowledge Studio unavailable` 或 `adapter unavailable`。
3. Bundle 恰好配置一个 `sourceRoot`。
4. DeepSeek Knowledge 模型与密钥已经配置好。

如果尚未完成，请先阅读 [15 分钟快速开始](quick-start.md) 和 [Bundle 配置](bundle-configuration.md)。

## 先选对入口

| 你的目的                                  | 使用入口                              | 是否复制到 `sourceRoot` | 是否登记为 Knowledge Source | 是否加入当前 Chat | 是否直接改 Wiki |
| ----------------------------------------- | ------------------------------------- | ----------------------- | --------------------------- | ----------------- | --------------- |
| 导入 Windows 上的一个外部资料目录         | Knowledge Studio → `Import folder`    | 是                      | 是                          | 否                | 否              |
| 注册已在唯一 `sourceRoot` 内的 Vault 文件 | 拖入 Chat → `Add to Knowledge`        | 否；文件已经在那里      | 是                          | 否                | 否              |
| 只让当前对话读取一个 Vault 文件           | 拖入 Chat → `Use in this chat`        | 否                      | 否                          | 是                | 否              |
| 把一条已完成 AI 回答整理成长期来源        | 回答操作栏 → `Create Knowledge Draft` | 是；创建内容寻址 `.md`  | 是                          | 不改变当前 Chat   | 否              |

Knowledge 不提供独立的 URL、浏览器或单文件 Windows Explorer 导入口。外部资料请以文件夹为单位导入。

## 操作步骤：导入外部文件夹

### 1. 打开文件夹选择器

1. 打开 Knowledge Studio。
2. 点击顶部的 `Import folder`。
3. 在 Windows 文件夹选择器中选择一个文件夹并确认。
4. 保持 Obsidian 打开，等待按钮下方出现汇总结果。

取消选择器不会产生导入、注册或模型请求。

### 2. 理解资料会放到哪里

系统会在唯一 `sourceRoot` 下保留所选文件夹的名称和内部层级。例如：

```text
外部文件夹：研究资料/
├── 论文.md
└── 参考文献/
    └── 报告.pdf

导入后：<sourceRoot>/研究资料/
├── 论文.md
└── 参考文献/
    └── 报告.pdf
```

这是一次性快照，不是同步关系：

- 外部原件只被读取，不会被 Knowledge 改写。
- 复制并登记成功后，导入的 Vault 副本成为 Knowledge 当前使用的来源记录。
- 以后修改外部原件，不会自动更新 Vault 副本。
- 以后修改 Vault 副本，会作为这个 Knowledge 来源的新版本被观察。

重新导入不能更新同一路径的不同字节：它只会报告 `conflicts`，不会覆盖 Vault 副本。如果要更新同一个逻辑来源，应该先备份，再在队列空闲时有意更新 Vault 内的来源副本，并确认 Activity 观察到新版本。如果要把新旧版本并列保存为两个来源，可以改用新的顶层文件夹名再次导入；旧路径仍会是已注册来源。不要通过删除文件来更新来源；误删后应使用下面的 Source Missing 流程。

### 3. 看懂导入汇总

界面会显示类似以下结果：

```text
Folder import completed. 5 imported · 0 reused · 2 skipped · 0 conflicts · 0 failed.
```

| 字段        | 中文含义                                | 你应该怎么做                                              |
| ----------- | --------------------------------------- | --------------------------------------------------------- |
| `imported`  | 新建了 Vault 副本或完成了新的来源注册   | 转到 `Activity` 查看编译进度                              |
| `reused`    | 目标文件和来源身份已经完全一致          | 无须处理；安全重复导入不会制造重复工作                    |
| `skipped`   | 文件类型没有进入当前 Knowledge 导入范围 | 需要时先转换成受支持格式                                  |
| `conflicts` | 目标路径已有不同字节或来源身份冲突      | 比较外部文件与 Vault 副本，保留一个明确版本；系统不会覆盖 |
| `failed`    | 某个合格文件的浏览器字节读取失败        | 确认文件仍可读取后，可以重新选择同一文件夹                |

`partially completed`（部分完成）不代表已成功的文件被回滚。成功项会保留，修复冲突或失败项后可以安全重试；完全相同的文件会显示为 `reused`。

复制或注册等系统性错误通常会让整个操作显示 `Folder import could not be completed`，而不是增加 `failed` 计数。错误出现前已经安全完成的项目仍可能保留；重新打开 Studio、确认 Activity 与 Vault 状态后再重试。

### 4. 转到 Activity

导入汇总只说明“复制与注册”阶段的结果，不代表 Wiki 已经生成。点击 `Activity`，等待每个新任务进入以下一种结果：

- `Awaiting review`：已有候选修改，进入 `Review` 审核。
- `Completed` 且 Review 为空：通常是 `no_changes`，表示无需修改 Wiki。
- `Failed`：查看失败阶段；只有出现 `Retry` 按钮的任务才适合直接重试。

完整状态说明见 [Knowledge Studio 与 Activity](knowledge-studio.md)。

## 文件夹导入的格式与上限

| 项目                     | 当前上限或规则                              |
| ------------------------ | ------------------------------------------- |
| 支持格式                 | `.md`、`.markdown`、`.txt`、`.pdf`          |
| 一次选择                 | 最多 1,000 个文件；包括随后可能被跳过的文件 |
| 单个合格文件             | 最多 8 MiB                                  |
| 一批合格文件总量         | 最多 128 MiB                                |
| 文本 parser              | 非空、严格 UTF-8、最多 8,000,000 个字符     |
| PDF parser               | 最多 2,048 页、最多 8,000,000 个提取字符    |
| 浏览器相对路径           | 最多 1,024 个字符                           |
| Vault 目标路径           | 最多 240 个字符                             |
| 同名同路径、字节完全相同 | 复用，不覆盖                                |
| 同名同路径、字节不同     | 冲突，不覆盖                                |

**应该**在导入前缩短特别深的目录或超长文件名。**禁止**通过手工篡改插件私有状态来绕过大小、路径或冲突检查。

系统会在读取第一个文件的内容字节前验证整批选择。包含不安全相对路径，或在 Windows 大小写规则下发生碰撞的路径（例如同一目录中的 `A.md` 与 `a.md`），会拒绝整批，而不是猜测应该保留哪一个。

批次预检只根据选择元数据和字节上限决定是否复制；复制/注册成功不等于 parser 已接受内容。GBK/ANSI、空文本、畸形 UTF-8、字符数超限、PDF 页数或提取字符超限会随后在 Activity 的 `Parsing` 阶段安全失败。

## 操作步骤：从 Chat 注册 Vault 文件

这一入口只用于已经位于 Vault 内、且路径在唯一 `sourceRoot` 下的文件。

> **放进 `sourceRoot` ≠ 已加入 Knowledge。** 手工放入只满足路径要求；`Add to Knowledge` 才完成显式登记。外部文件夹使用 `Import folder` 时，复制和登记会在一次操作中完成。

当前版本把单个 Vault 文件的登记按钮放在 Chat，是为了在发生任何状态变化前，让你明确选择临时上下文还是长期来源。你不需要先向文件提问，也不需要发送 Chat 消息；拖入文件并点击 `Add to Knowledge` 后，直接转到 `Activity` 即可。

1. 从 Obsidian 左侧文件列表把 `.md`、`.markdown`、`.txt` 或 `.pdf` 文件拖进 Copilot Chat。
2. 在 `Choose how to use this file` 卡片中选择用途。
3. 点击 `Add to Knowledge`。
4. 看到 `Added to Knowledge` 后，打开 Knowledge Studio 的 `Activity`。

如果显示 `This file is already registered in Knowledge`，说明它已经是持久来源；这不是失败。

不要从 Windows Explorer 把单个普通文件拖进 Chat 来代替这一步。当前 Knowledge 的外部入口是 `Import folder`，而 Chat 的 `Add to Knowledge` 要求文件已经存在于 Vault 的 `sourceRoot` 内。

### `Use in this chat` 与 `Add to Knowledge`

| 选择               | 实际作用                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| `Use in this chat` | 把文件加入当前 Chat 上下文；不注册来源，不启动 Activity，也不会形成可复利的 Wiki 资产 |
| `Add to Knowledge` | 注册现有 Vault 文件并启动后台编译；不会把文件加入当前 Chat 消息                       |
| 右上角关闭         | 放弃本次选择；不会改变 Chat 或 Knowledge                                              |

普通 Chat Context、Copilot Plus 和 Knowledge 是三套不同路径：

- Chat Context 服务于当前对话，生命周期随对话而定。聊天记录即使被保存成 Markdown，也只是普通笔记，不会自动登记为 Knowledge Source。
- Copilot Plus 是原项目的付费 Chat/Agent 与文档处理功能。
- Knowledge 是本项目的 Sources → Activity →（`no_changes`，或 Review → Apply）持久知识流程，不要求 Copilot Plus 许可证。

## 操作步骤：从完整 AI 回答创建 Knowledge Draft

这一入口只出现在**已经生成完毕、不是错误消息的 AI 回答**上。用户消息、错误回答和仍在流式生成的回答没有该动作。

1. 先用 Chat 理解、解释、比较或总结材料，等 AI 回答完整结束。
2. 在该 AI 回答的操作栏点击 `Create Knowledge Draft`。
3. 如果当前没有可绑定的 Knowledge Bundle/sourceRoot，系统会立即提示不可用，不会先让你编辑。正常打开时，窗口会显示并锁定本次目标 Bundle 与 Source root；运行代变化时只会停止提交，不会静默改投另一个目标。
4. 系统会先用回答复制时的清理规则去除隐藏 reasoning/tool 内容，再把最终正文预填到 `Markdown draft`；`Title` 起初为空。
5. 填写单行标题，并直接编辑正文。对照原书、论文或笔记核对事实，补上书名、章节、页码或其他可复查位置。
6. 勾选 `I reviewed this draft and want to register it as a Knowledge Source.`。
7. 点击 `Create source`。成功提示会显示新 Source 的 Vault 相对路径，并明确说明 Wiki 没有变化。
8. 打开 Knowledge Studio 的 `Activity`。后续编译可能正常得到 `no_changes`，也可能产生 Review；只有在 Review 中接受并成功 Apply，Wiki 才会改变。

创建窗口只接收你最终提交的标题和 Markdown 正文。它不会自动保存整段对话、用户提示词、Chat 文件上下文、结构化 citations 或原始证据关系。即使回答看起来引用了某本书，这个 Source 仍只是**你核对过的二级笔记**，不能自动升级成原始证据。重要知识应该由你在正文补充可核对的书名、章节、页码，并在需要严格证据链时另行导入原始 `.md` 材料或使用有证据的 Knowledge Query。

### 创建后实际发生什么

```text
完成的 AI 回答
      ↓ 清理隐藏 reasoning/tool 内容
空白标题 + 可编辑正文
      ↓ 人工核对并显式勾选
在唯一 sourceRoot 创建内容寻址 Markdown
      ↓ 以 managed_copy 登记 Source
Activity 后台编译
      ↓
no_changes，或 Review → 显式 Apply → Wiki
```

- 点击 `Create source` 本身不调用模型，不创建 Review，也不写 Queue 或 Wiki；它只完成本地文件发布和 Source 登记。
- 登记后的 generation refresh 会让来源观察器把它带入 Activity。该后台编译可能调用你配置的 Knowledge 模型并产生 API 费用。
- Source 路径形如 `<sourceRoot>/Knowledge Draft <内容摘要>.md`。标题与正文完全相同时，精确重试复用同一个 Source，不覆盖、不制造第二个身份。
- 在创建窗口改变标题或正文会产生新的内容摘要，因此再次创建的是一个新 Source。创建成功后，如果你有意编辑 Vault 内这个 managed copy，来源观察器会把新字节视为同一 Source 的新 revision。
- 重命名或删除这个 Vault 文件会让来源进入 `Missing`，旧引用权限失效；按本页后面的精确原路径流程恢复，或在满足条件时明确退役。
- 冲突或失败不会覆盖已有不同字节，也不会直接改变 Wiki。若文件已发布但登记回执不确定，不要手工改名或删除；先检查 Sources/Activity，再用完全相同的标题和正文重试，使操作按内容身份收敛。
- 提交期间可以点 `Stop creation` 请求停止，但文件发布和 Manifest 登记不是一个可以跨介质回滚的事务。停止提示不代表所有持久步骤都已撤销；先检查 Sources/Activity，再决定是否按完全相同内容重试。

### Knowledge Draft 输入限制

| 项目                      | 当前限制                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| 标题                      | 必填、单行、首尾不能有空白；JavaScript `string.length` 最多 200              |
| 正文                      | 必填；JavaScript `string.length` 最多 1,000,000                              |
| 最终渲染的 Markdown UTF-8 | 包含 `# 标题`、空行与正文在内，最多 2,000,000 bytes                          |
| 目标路径                  | 系统自动选择内容寻址 `.md`；Vault 相对路径仍受最多 240 个字符的 Windows 上限 |

JavaScript `string.length` 按 UTF-16 code unit 计数，一个 emoji 通常计为 2；字符上限和 UTF-8 byte 上限会同时检查。超出任一限制时不会创建或覆盖 Source，已编辑内容会保留在窗口中供你缩短后重试。

## Sources 页与来源缺失

当前分支已接入 `Sources` 页的来源生命周期功能并有自动化覆盖；受控删除、单一 Notice、`Check again` 零重建、精确原路径恢复，以及一次性来源的二次确认退役都已经通过 Windows 有界实测，只有物理右键提示仍未做现场验收。该页只在当前 Studio 快照包含来源生命周期模型时显示，并列出所有仍处于 active 注册状态的来源。缺失来源显示 `Missing`，页签徽标显示缺失数量。页面已经打开时也会自动刷新：系统观察到删除或改名后从 `Ready` 变为 `Missing`；只有精确原路径恢复且新捕获收敛后，才从 `Missing` 回到 `Ready`。同一同步批次出现一个或多个来源问题时，插件最多显示一条不含路径的通用 Notice，引导你打开 Sources，不会为每个文件连续弹窗。

可恢复的 missing、delete 或 rename 只隔离受影响来源，不再让整个 Studio 自动变成 unavailable。该来源的摄入与 Review 会停止，旧 Query citation 权限会失效；已经发布的正常运行代中，其他健康来源仍可继续工作。`capture_failed`、精确路径大小写错误、Windows 路径碰撞或未收敛的致命观察状态仍可能让运行代 fail closed。

有一种严格限定的冷启动状态：同一个 Bundle 既有可恢复的来源缺失证据，又只剩 `source_observation_pending` 阻断。此时正常 Queue release 继续保持关闭，但 Studio 会先打开一个仅限 `Sources` 的恢复界面。它只有查看来源、`Check again` 和 `Remove` 权限；后台 worker、模型、Query、Review、Apply 和 Wiki 写入均未获授权。这样可以处理缺失来源，又不会为了“能打开界面”而提前放行普通工作。

### 恢复到原路径

1. 把来源恢复到界面显示的**同一个 Vault 相对路径**；只放回别处或只改成相似大小写不算恢复。
2. 回到 `Sources`，点击 `Check again`。
3. 等待新运行代重新观察精确字节；如果字节发生变化，后续可能产生新的 Activity、模型请求和 Review。

如果你手中只有另一个副本，先由你核对内容并把它恢复到界面显示的精确原路径，再执行 `Check again`。当前 `Sources` 页没有“选择替代文件”或改绑到新路径的入口。

`Check again` 本身只要求重新核对，不会创建、复制、移动或覆盖任何文件，也不会假装文件已经恢复；只有新的持久观察证明来源可用后，后续编译才可能调用模型。

### Remove

`Remove` 是停止跟踪来源，不是删除文件。它要求第二次内联确认，并可能被真实的活跃 Queue/Activity、待决 Review/Apply、Recovery、事务或 rerun 工作阻断。目标来源尚处于 allocated/bound 的观察会在同一次退役提交中被原子终结，不会成为永久无法 Remove 的循环阻断。成功后：

- 来源文件和已经生成的 Wiki 文件都不会被删除。
- 只移除来源在 active Manifest 中的成员资格并撤销当前 provenance；该来源不再进入未来 Ingest、Review 或 Query citation。
- 既有 Queue、Review 和 Apply ledger 历史会保留，不会为了移除来源而抹掉审计记录。
- 来源身份和 Windows 路径保留在 Runtime v5 的受保护退役记录中，不能通过再次 `Add to Knowledge` 静默注册成一个“新”来源。

这是有意的持久退役，不是临时隐藏，也没有一键撤销。操作前应该备份。当前退役已有严格自动化覆盖，并已用一次性来源通过 Windows 二次确认 `Remove` 有界实测；现有真实来源没有被拿来做破坏性验收。

### Obsidian 文件菜单提示的边界

在 Obsidian 文件列表中右键已注册来源或包含它的文件夹，插件可加入一个警告和 `Open Knowledge Studio before deleting…` 导航项。它只是提示：Obsidian 没有统一可靠的 before-delete hook，因此该提示**不能拦截键盘删除、其他原生入口或 Windows Explorer 删除**。这些删除只能在事后进入 Source Missing 恢复流；插件不会操作 Windows 回收站。

## Grounded Query 的来源格式边界

四种格式都可以摄入和编译，但当前 Query 的来源证据能力不同：

| Source 格式 | 可摄入/编译 | 可成为当前综合回答的 Source evidence | 精确导航                 |
| ----------- | ----------- | ------------------------------------ | ------------------------ |
| `.md`       | 是          | 是                                   | 精确原句                 |
| `.markdown` | 是          | 否                                   | 当前不提供               |
| `.txt`      | 是          | 否                                   | 当前不提供               |
| `.pdf`      | 是          | 否                                   | 可作为检索引用跳到精确页 |

因此，`.markdown`、`.txt` 和 PDF 仍能产生并维护 Wiki；但如果你希望 `Query` 生成有来源支撑的综合回答，当前至少需要相应的 `.md` 来源。不要只改扩展名伪装格式；应把可核对文本保存为真实 Markdown 来源，再经过正常摄入和 Review/Apply。

## PDF 的正确使用方式

Knowledge 的 PDF 路径使用 Obsidian 本地 PDF 引擎逐页提取有界文本，不调用 Copilot Plus、Miyo、Brevilabs 或远程文档转换服务。原始 PDF 字节仍是证据：

- 从文件夹导入时，Vault 中的 PDF 副本是当前来源记录。
- 从 Chat 注册时，原来的 Vault PDF 是当前来源记录。
- 已接受的页引用会在打开前重新验证原始 PDF 字节，并跳到对应页。
- PDF 字节改变后，旧引用会失效。只有新的已应用来源证明才能产生当前引用；仅完成解析不会让旧按钮复活，如果新编译为 `no_changes`，旧 raw-hash 引用仍可能不可用。

当前没有 OCR。扫描图片型、加密、损坏、没有可提取文本、空文本或超出边界的 PDF 会安全失败，而不会猜测内容。此时应该先在你信任的工具中制作带文本层的 PDF 或 Markdown，再重新导入。

注意：当前 `Query` 可以在检索结果中展示并打开 PDF 页引用，但综合回答阶段暂不把 `pdf_page` 定位器作为模型证据。只有 PDF 页引用的命中可能显示检索结果，同时回答为 `Insufficient evidence`。`.markdown` 和 `.txt` 同样不能成为当前综合回答的可验证 Source evidence。详见 [Query、引用与 Save to Wiki](query-and-writeback.md)。

`Use in this chat` 的 PDF 处理仍沿用普通 Chat 的上下文规则，可能需要 Copilot Plus 或已配置的文档转换能力；这不等于 Knowledge 的本地 PDF 编译路径。

## 你应该看到什么

一次成功的导入或注册应形成以下顺序：

```text
导入/注册成功
    ↓
Activity 出现来源任务
    ↓
后台解析与两阶段编译
    ↓
Awaiting review 或 Completed（no_changes）
```

在 `Review` 提交接受前，Wiki 文件不应发生变化。外部文件夹的原件也不应被修改。

## 如果结果不同

- `Folder import is not available yet`：当前 Knowledge 适配器尚未就绪，先检查 Studio 顶部状态。
- `requires exactly one active Knowledge Bundle`：当前配置不是恰好一个有效 Bundle。
- `requires exactly one configured Knowledge source folder`：Bundle 的 `sourceRoots` 不是恰好一个。
- `selected folder exceeds ... limits`：减少文件数、单文件大小、批次总量或路径长度。
- `skipped` 很多：检查扩展名是否属于四种支持格式。
- `conflicts`：系统保护了已有 Vault 文件；先人工比较，不要期待重新导入自动覆盖。
- `Add to Knowledge` 提示文件在来源根目录之外：先把文件移到已配置的 `sourceRoot`，或用文件夹导入创建 Vault 副本。
- Activity 显示 `Completed` 但 Review 为空：优先按 `no_changes` 理解，不要反复导入制造重复任务。
- PDF 在解析阶段失败：确认它不是扫描型、加密、损坏、空文本或过大文件。

更多处理路径见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 文件夹选择、文件复制、来源注册和 PDF 文本提取都在本机完成。
- 外部绝对路径不会作为 Knowledge 来源路径持久保存；持久记录使用 Vault 相对路径。
- 新来源进入后台编译后，一次成功编译通常会向 DeepSeek 发起两个受控请求：分析和生成。源文本、Schema 以及必要的现有 Wiki 目标内容会发给 DeepSeek，并可能产生费用。
- 完全一致且有可复用成功证明的来源可以跳过新的模型工作；不要据此假定任何重复操作都必然零费用。
- `Use in this chat` 使用当前 Chat 的模型与数据路径，和 Knowledge 编译费用分开计算。

## 相关页面

- [15 分钟快速开始](quick-start.md)
- [Bundle 配置](bundle-configuration.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [Review 与 Apply](review-and-apply.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [隐私与安全](privacy-and-security.md)
