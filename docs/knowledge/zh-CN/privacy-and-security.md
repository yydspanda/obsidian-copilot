# 隐私与安全

> 核心原则：文件管理和校验尽量在本机完成；真正的编译与有证据回答会把必要内容发送给你配置的 DeepSeek 服务。

## 本页目标

理解数据在哪里、哪些操作会联网、API Key 怎样保存，以及当前版本有意不自动执行哪些危险动作。

## 数据流概览

| 数据或操作                                   | 默认位置                                                               | 是否可能发送给 DeepSeek                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 外部文件夹枚举和复制                         | 本机                                                                   | 复制本身不会                                                                               |
| 外部绝对路径                                 | 只用于系统选择过程，不作为 Knowledge 来源身份持久化                    | 不会作为导入元数据发送                                                                     |
| Bundle 与 Vault 相对路径元数据               | 本机配置/持久状态                                                      | 编译时会发送 Bundle ID、source/wiki/schema/target 相对路径和必要哈希；它们不是外部绝对路径 |
| Vault Source 原始内容                        | 本机 Vault                                                             | 编译该 Source 时会发送必要内容                                                             |
| Schema 内容                                  | 本机 Vault                                                             | 编译时会发送，用于指导组织和输出                                                           |
| 必要的现有 Wiki 内容                         | 本机 Vault                                                             | 更新关联页面时可能发送                                                                     |
| PDF 文本提取                                 | 本机 Obsidian/PDF.js                                                   | 提取本身不会；提取出的页面文本可进入编译请求                                               |
| Query 问题                                   | 内存/当前 Studio                                                       | 有合格证据时会发送给回答路由                                                               |
| Query 的 Wiki 上下文和合格 `.md` Source 摘录 | 从已验证内容临时构造                                                   | 有合格证据时会发送正文、Wiki 相对页路径、标题路径和内容哈希                                |
| Chat Knowledge Draft                         | 只把用户最终确认的标题与编辑后正文保存为本地 managed Source            | 点击创建不会；随后编译该 Source 时会发送必要内容                                           |
| 启动预检、Recovery 核对、未变化跳过          | 本机                                                                   | 不应发送                                                                                   |
| API Key                                      | 新安装/已迁移：Obsidian Keychain；旧标准存储：可能明文存在 `data.json` | 只作为 HTTPS 请求凭据，不应写入 Review、Runtime 或日志                                     |

## DeepSeek 会收到什么

### 编译 Source

一个正常的知识编译通常包含两个阶段：分析和生成。请求可能包含：

- 该任务授权的 Source 文本。
- 当前 Schema 规则。
- 为更新目标页所必需的已有 Wiki 内容。
- Bundle ID，以及 Source、Wiki、Schema、授权目标的 Vault 相对路径和必要的内容哈希等协议元数据。
- 输出语言和受支持的行为配置。

内容会被放在固定数据边界内；Schema、来源正文和 Wiki 内容不能提升模型权限。模型只能提出 ChangeSet，不能直接访问 Vault 或写文件。

### 执行 Query

只有已经接受并 Apply、且当前哈希验证通过的 Wiki 会参与检索。当系统还能重新证明精确 `.md` Source 摘录时，可能发送：

- 你的问题。
- 有界的 Wiki 上下文。
- 命中 Wiki 的 Vault 相对页路径、标题/标题路径和内容哈希。
- 精确的 `.md` Source 摘录和不透明证据 ID。

没有合格 Source 证据时，系统返回 `Insufficient evidence`，不调用回答模型。

### 创建 Chat Knowledge Draft

`Create Knowledge Draft` 只处理一条已经完成的 AI 回答。预填前会清理隐藏 reasoning/tool 内容；真正写入 Source 的只有你最后提交的标题与编辑后 Markdown 正文。窗口还会显示并绑定当前 Bundle/sourceRoot，但不会把外部绝对路径写进草稿正文。系统不会随之自动持久化用户提示词、完整聊天记录、Chat 文件上下文、结构化 citations、原始来源关系或模型内部隐藏内容。

这个创建动作在本机完成内容寻址文件发布与 Manifest 登记，本身不调用模型、不创建 Review，也不写 Wiki。登记后，来源观察和 Activity 编译遵循普通 Source 的数据路径：必要的草稿正文、Schema、相对路径元数据和关联 Wiki 内容可能发送给你配置的 Knowledge 模型，并产生 API 费用。草稿是人工核对的二级笔记，不应被当作自动验证过的原始证据。

## API Key 规范

- 应该通过 Obsidian 设置配置 DeepSeek Key，并使用 **Advanced → API Key Storage** 迁移到 Obsidian Keychain。旧标准磁盘模式可能把 Key 明文保存在插件 `data.json`。
- 迁移前的 `data.json`、完整 Vault 备份和任何历史副本都必须按密钥材料加密、限制访问；迁移不会自动擦除你已经复制出去的旧备份。
- 禁止把 Key 写进 Source、Schema、Wiki、Project frontmatter、截图或 Git 仓库。
- 开发用 `.env.test` 只适合本地测试，不是日常用户配置入口。
- 如果 Key 曾出现在聊天、日志、提交或截图中，应立即到提供商控制台吊销并重新生成。

Knowledge 路由只接受当前审核过的 DeepSeek V4 身份和官方 endpoint。旧模型身份或自定义 endpoint 不会被静默替代。

## 文件夹导入的安全边界

- 选择外部文件夹后，系统只读取允许格式并复制到唯一 sourceRoot。
- 外部原件不会被编辑、重命名、删除或持续同步。
- 相同目标且字节完全一致时复用。
- 不同字节、目录冲突、大小写冲突或不安全路径不会被覆盖。
- 不持久化外部绝对路径作为来源身份。
- 批次可以部分完成；已安全完成的文件保留，重试会收敛。

导入完成后，Vault 内副本是 Knowledge 的来源记录。以后修改外部原件不会自动更新它。

## PDF 与 Copilot Plus

Knowledge 的 PDF 导入和页引用使用本地、按原始字节验证的解析路径，不依赖 Brevilabs/Miyo 或 Copilot Plus PDF 转换服务。

这不等于普通 Chat 的所有 PDF 上下文能力都已被替换。Chat 中的 `Use in this chat` 仍属于现有 Chat/PDF Context 路径；`Add to Knowledge` 才走本手册描述的本地 Knowledge 解析链路。

当前不支持 OCR、扫描型无文本 PDF、加密 PDF 或损坏 PDF。不要为绕过限制把敏感 PDF 上传到未知转换网站。

## 写入保护

- 后台 worker 没有 Apply 权限。
- Review 不会自动接受。
- `Apply` 会在写入前重新验证目标、提案和持久状态。
- 冲突文件不会静默覆盖。
- Delete 当前保持禁用。
- `Save to Wiki` 先创建 managed source，再经过正常编译；结果可能是 `no_changes`，也可能进入 Review→Apply，它不是直接写 Wiki。
- `Create Knowledge Draft` 先创建可有意更新的 `managed_copy` Source；创建本身不调用模型或写 Wiki，后续编译可能以 `no_changes` 收敛，也可能进入 Review→Apply。
- 内容寻址创建和 exact replay 不会覆盖已有不同字节；冲突或失败不会用草稿改写已有文件或 Wiki。
- 引用打开前会重新验证来源字节；来源变化会撤销旧引用。

## 日志、截图和求助

提交诊断信息前：

- 只报告状态、计数、错误类别和必要的相对路径。
- 删除 Source 正文、Query 内容、模型请求/响应和 Authorization header。
- 遮盖 Bundle 中的私人名称、项目名称和文件名。
- 不上传插件私有 Runtime 文件；它可能包含来源路径和持久操作身份。
- 截图要确认没有 API Key、聊天内容或个人文件预览。

## 当前未覆盖的环境

当前产品边界没有宣称安全支持：

- OneDrive 或其他同步软件在写入期间改变文件。
- 两个 Obsidian 实例同时操作同一 Vault。
- 恶意本地进程在极短窗口替换 Windows junction/reparse namespace。
- 所有断电和磁盘故障时序。
- 多用户共享写入或网络文件系统。

这不代表这些场景一定损坏数据，而是你不能把它们当成已验收使用方式。

## 你应该看到什么

正常情况下：

- 导入摘要只显示聚合结果，不需要暴露外部绝对路径。
- 编译前后 Wiki 不会在你没有 Apply 的情况下变化。
- 无证据 Query 显示 Insufficient evidence。
- 冲突显示为 conflict，而不是覆盖。
- Recovery 和 stale 状态会阻止危险写入，而不是自动猜测。

## 数据、网络与费用影响

分析、生成和有证据 Query 会使用 DeepSeek 额度。启动、文件复制、本地 PDF 提取、哈希校验、Recovery 读取、精确未变化跳过，以及点击 `Create Knowledge Draft` / `Save to Wiki` 完成本地捕获和登记，都不会因为自身而产生模型费用。新 Source 随后进入 Activity 的编译可能调用配置模型并产生费用。

## 相关页面

- [安装、升级与 DeepSeek V4](installation-and-model.md)
- [知识来源与导入](sources-and-import.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [长期使用规范](operating-guidelines.md)
- [故障排查](troubleshooting.md)
