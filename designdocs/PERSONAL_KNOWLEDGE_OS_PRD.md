# Personal Knowledge OS PRD / 个人知识操作系统产品需求

Status: Draft for implementation

Last updated: 2026-07-16

Primary user: the repository owner as a long-term daily user

Primary platform: Obsidian Desktop on Windows

配套文档：技术架构见 [`PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md)，开源实现复用边界见 [`OPEN_SOURCE_REUSE_PLAN.md`](./OPEN_SOURCE_REUSE_PLAN.md)。

---

## 1. Executive Summary

要构建的是一套运行在 Obsidian 内的个人知识操作系统，而不是再增加一个聊天机器人。它把助手、笔记和知识引擎连接成同一条日常闭环：用户把文章、文档、网页、笔记或想法放进系统，系统将其编译为可读、可链接、可追溯的 Wiki；用户可以围绕这些知识提问、研究和创作；有价值的答案和新洞察可以经过审核继续沉淀；系统还会持续发现陈旧内容、矛盾、断链和知识缺口。

产品以 Windows 上的 Obsidian Copilot 为壳，复用现有 Chat、模型 Provider、搜索、文件解析、写入预览和 Project 能力。新增的核心产品表面是全页 `Knowledge Studio`，它负责来源、Wiki、审核、活动、维护和知识图谱；Chat 仍是随时可用的助手入口。Markdown 和原始资料始终属于用户，索引、图谱和模型输出均为可重建的派生层。

第一条必须跑通的体验不是“搭完所有基础设施”，而是：

> 拖入一个来源 → 选择加入知识库 → 看到分析进度 → 审核多文件变更 → 写入相互连接的 Wiki → 提问并跳转到引用 → 再次摄入未变化内容时立即跳过。

## 2. Problem Statement

### 2.1 谁有这个问题

主要用户是长期用 Obsidian 管理研究、项目、阅读、决策和创作的个人用户。第一阶段直接以仓库所有者自己的真实 Vault 和长期使用体验为产品验证环境，不为抽象企业客户或团队协作设计。

### 2.2 当前问题

- 笔记是静态文件，助手对话是临时会话，两者之间缺少稳定的知识沉淀闭环。
- 普通搜索能找到文字，传统 RAG 能临时拼接片段，但很难持续维护“这个主题现在知道什么、依据是什么、后来发生了什么变化”。
- 导入资料、等待模型、处理失败、审核结果和重新摄入通常分散在不同界面，用户不知道系统正在做什么。
- AI 生成内容要么不保存，要么直接写入，缺少好用的多文件审核、来源追踪和撤销机制。
- 大量笔记最终形成目录和链接，但缺少一个能帮助发现主题、关系、矛盾和知识缺口的工作台。

### 2.3 为什么痛苦

- 同一份资料在每次问题中被重新理解，时间和模型费用不能形成复利。
- 重要结论留在聊天里，数周后难以找回或验证。
- 自动整理如果不可追溯，会逐渐污染 Vault；过度确认又会让产品难以使用。
- 用户要自己记住资料放在哪里、是否已经处理、哪些页面受它影响。

### 2.4 当前证据

- 用户明确希望把当前项目长期作为自己的助手、笔记和知识引擎，优先把个人体验做到最好。
- 当前分支已经具备成熟 Chat、上下文、Search v3、文件解析，以及 Source Manifest、Queue/Transaction/Compiler/Review Core、strict runtime state foundation、create/update 文件 adapter 代码和最小 Windows Knowledge Studio shell。Windows 启动只初始化私有 runtime state；真实 workflow coordinator、Windows 实机验收、safe delete、Chat 入口、查询闭环和启动恢复仍未接通。
- 对 `llm_wiki`、`llm-wiki-compiler`、`claude-obsidian`、OKF 和 Graphiti 的代码审计显示，优秀项目正在共同收敛到两阶段摄入、增量 manifest、持久队列、来源追踪、渐进检索、审核和维护闭环。

## 3. Target User and Jobs-to-be-Done

### 3.1 Primary Persona

一个在 Windows Obsidian 中长期管理多领域资料的个人用户：进行深度研究、整理、审核、问答和创作；愿意配置自己的模型和知识目录，但不愿为了日常使用维护不必要的服务器、数据库或复杂 taxonomy。

### 3.2 Core Jobs

1. 当我遇到值得保留的资料时，我希望可以直接丢给系统，它会说明处理状态并把内容连接到已有知识，而不是只生成一个孤立摘要。
2. 当我提出问题时，我希望得到基于自己知识库的答案，并能一键跳到真正支持结论的原文位置。
3. 当对话产生好结论时，我希望把它保存成新页面、更新已有页面或记录为决策，而不需要手工复制整理。
4. 当知识变化或互相矛盾时，我希望系统保留历史和来源，告诉我发生了什么，而不是静默覆盖旧内容。
5. 当知识库逐渐变大时，我希望能从主题、关系、时间和当前活动理解它，而不是靠记住文件路径。
6. 当系统失败、重启或切换设备时，我希望任务可恢复、文件不损坏、派生数据可重建。

## 4. Product Principles

1. **体验优先，但不以失控换流畅。** 信任机制应融入进度、引用、diff 和撤销，不用大量警告打断用户。
2. **一次使用与长期沉淀明确分流。** 所有拖入内容都能选择“只用于本次对话”或“加入知识库”。
3. **知识必须复利。** 新来源优先更新已有概念、关系和综合页面，而不是无限增加摘要文件。
4. **原始来源不可被静默改写。** Raw Sources、用户笔记和 LLM 维护的 Wiki 有清晰 ownership。
5. **默认好用，不强迫先设计分类法。** 系统提供合理默认结构，并允许以后调整 Schema 和目录。
6. **渐进披露。** 默认展示答案、关键来源和下一步；细节、完整 trace、图谱和校验结果按需展开。
7. **本地优先、模型可替换。** Markdown 是主数据；索引、图谱、队列状态和模型均可替换或重建。
8. **Windows-first。** 当前只为 Windows Obsidian Desktop 设计、开发和验收；允许使用真正改善体验的桌面能力，但领域逻辑与 Windows/Obsidian I/O 仍通过 adapter 分离。
9. **开源复用可追踪。** 可以直接复用优秀代码，但必须锁定 commit、保留许可证和来源，并修复不适合当前项目的假设。

## 5. Solution Overview

### 5.1 Two Product Surfaces

```text
Obsidian Chat sidebar
├── 随时提问、讨论和创作
├── 当前笔记 / 选区 / 附件上下文
├── “只用于本次对话”与“加入知识库”分流
└── 引用跳转、保存到 Wiki、打开相关知识

Knowledge Studio full-page tab
├── Home      今日入口、最近知识、待处理事项
├── Sources   来源、状态、ownership、重新摄入
├── Wiki      页面树、主题、来源卡片、相关页面
├── Review    写入前 ChangeSet + 写入后 Review Inbox
├── Activity  队列、进度、失败、暂停、恢复、重试
├── Graph     关系、社区、知识缺口和探索
└── Health    lint、新鲜度、断链、孤立页、矛盾
```

Chat 和 Knowledge Studio 不是两个产品。它们共享同一个知识模型、任务队列、来源身份、引用、检索和写入事务。

### 5.2 Core Experience Modes

| 模式       | 用户看到的体验                     | 系统职责                                   |
| ---------- | ---------------------------------- | ------------------------------------------ |
| Capture    | 拖入、粘贴、选择文件或监听指定目录 | 解析来源、生成稳定身份、去重、排队         |
| Understand | 阶段式进度和完成摘要               | 两阶段分析，发现受影响页面，生成 ChangeSet |
| Ask        | 带 citation chips 的回答           | Wiki 优先检索，必要时回读 Raw Source       |
| Explore    | 主题、相关页面、来源和图谱浏览     | 组合 index、搜索、wikilink 和社区信号      |
| Create     | 从对话生成笔记、综合、决策或计划   | 提供目标、来源和 diff，支持保存或编辑      |
| Review     | 批量接受、编辑、拒绝和稍后处理     | 写入前审批与写入后知识问题分离             |
| Maintain   | Health 报告和修复建议              | 检查 freshness、断链、孤立页、引用和矛盾   |

### 5.3 The Golden Ingest Flow

1. 用户把 Markdown、PDF、网页或 Vault 文件拖入 Chat 或 Knowledge Studio。
2. 系统给出两个清晰动作：`Use in this chat` 和 `Add to Knowledge`。
3. 选择加入知识库后立即出现任务卡：解析 → 分析 → 关联 → 生成 → 校验 → 等待审核。
4. 分析阶段先产出来源摘要、概念、实体、主张、关系和候选目标页；生成阶段只修改已确定的目标集合。
5. 完成后显示结果卡：创建几页、更新几页、发现几项矛盾、引用是否完整。
6. 用户打开多文件 ChangeSet，按文件或变更块接受、编辑、拒绝，也可以全部接受。
7. 系统按 journal 计划更新 Wiki、manifest、index、hot 和 log；只有 commit marker 完成后才显示成功并刷新派生搜索索引。
8. 用户立即可围绕新知识提问，答案引用能跳到来源页、标题、行范围或 PDF 页码。
9. 同一来源内容和 pipeline fingerprint 未变化时，再次摄入直接显示 `Up to date`，不调用模型。

### 5.4 Ask, Save, and Reuse Flow

1. 用户在任意页面提问，系统先显示当前知识范围。
2. 回答中的关键结论附 citation chips；点击打开来源并定位。
3. 推断、建议和证据不足的部分使用不同视觉语义，不伪装成来源事实。
4. 用户可选择 `Save to Wiki`、`Update existing page`、`Create decision` 或 `Keep in chat only`。
5. 保存动作生成 ChangeSet；确认后，新内容在后续问题中能被检索并显示其来源链。

### 5.5 Review Has Two Different Meanings

```text
Write-time ChangeSet Review
生成内容尚未写入 → 查看多文件 diff → accept / edit / reject → 可恢复事务应用

Knowledge Review Inbox
内容已经存在 → contradiction / duplicate / missing page / stale / suggestion
→ resolve / dismiss / research / create follow-up ChangeSet
```

两者不能混为一谈。任何“先写盘、事后再 review”的实现都不能替代写入前 ChangeSet。

## 6. Functional Requirements

### P0 — First Complete Experience

- 支持至少 Markdown、纯文本和当前已能稳定解析的 PDF 来源。
- 从 Chat 拖入文件时提供一次使用/加入知识库分流。
- 使用持久队列展示任务阶段、进度、暂停、取消、恢复和重试；`awaiting_review` 不走通用取消，只能通过 durable Accept/Reject 决策退出。
- 使用 SHA-256 加 pipeline fingerprint 做幂等摄入。
- 生成 Source Manifest、OKF-compatible Wiki 页面和 claim-level citation 元数据。
- 提供多文件 ChangeSet，包含 before hash、来源、校验和可编辑 diff。
- 通过 pre-state journal、确定性写入顺序和 commit marker 提供可恢复事务语义，再更新现有 Search v3 索引。
- 问答返回可点击引用，并支持把答案再次保存到知识库。
- 插件重启后，未完成任务恢复为可见待处理状态，不自动消耗模型额度。

### P1 — Daily Knowledge Workbench

- 全页 Knowledge Studio，包含 Sources、Wiki、Review、Activity 和 Health。
- 来源卡片显示 local/external/missing、最近摄入、影响页面和重新摄入入口。
- `hot → index → domain → page` 渐进浏览，以及 Quick / Standard / Deep 查询档位。
- 写入后 Review Inbox 支持矛盾、重复、缺页、过期和研究建议。
- Lint 区分确定性错误与 LLM 建议，并生成可审核修复 ChangeSet。
- 监听用户授权目录的变化，支持重命名、删除和 ownership 迁移。
- 支持从 Windows Explorer 拖入来源，并正确处理 CRLF、大小写不敏感路径、保留设备名和文件占用冲突。

### P2 — Knowledge Exploration

- 使用 Obsidian metadata cache 增量构建链接图，不全量逐文件扫描。
- Graphology/Sigma 提供社区、搜索、过滤、预览和位置缓存。
- 在现有 Search v3 之上加入可解释的一跳图扩展，而不是增加第二套搜索引擎。
- 展示孤立节点、稀疏社区、桥接节点和 surprising connections。
- 允许从知识缺口或图谱节点直接发起研究任务。

### P3 — Temporal and Agent Expansion

- 在 Markdown/OKF 内支持 `observedAt`、`validFrom`、`validTo`、`supersedes` 和 `contradicts`。
- 只有真实历史和多跳问题超过 Markdown 链接能力后，才可选接入 Graphiti 外部投影。
- Agent Runtime 可以调用同一套 capture、query、ChangeSet 和 review 能力，但不能绕过权限与事务。

## 7. First Vertical Slice

### 7.1 Scope

首个版本只选择一个真实 Knowledge Bundle 和一个主要模型配置，跑通完整闭环：

```text
one source
→ persistent job
→ two-stage compile
→ multi-file ChangeSet
→ OKF Wiki write
→ grounded answer
→ citation jump
→ unchanged-source skip
```

它不是一次性的 demo。队列、manifest、事务、引用和重启恢复从第一版就按长期使用要求实现。

### 7.2 Acceptance Criteria

- [ ] 用户能从 Chat 把一个受支持文件加入指定 Knowledge Bundle。
- [ ] UI 在 300ms 内显示已入队状态，不等待模型调用完成。
- [ ] 同一 source identity 不会产生重复的并行任务；处理中再次变化会安排一次 rerun。
- [ ] 分析结果先确定受影响页面，生成阶段不能越过该目标集合写文件。
- [ ] 写入前可以查看所有 create/update/delete；默认不修改 Raw Source。
- [ ] 任一文件 before hash 冲突时，整个 ChangeSet 停止并要求重新生成或重新审核。
- [ ] 应用失败或崩溃恢复后，不会留下“manifest/任务标记成功但页面未完成”的半提交状态。
- [ ] 每个关键 Wiki 主张都能回到 source ID 和 locator；回答引用可以打开对应来源。
- [ ] 插件重启后非 applying processing 任务恢复为 pending；applying 进入 recovery gate；已持久化的 pending review 在新 claim 前完成协调，并等待用户恢复。
- [ ] 内容和 pipeline fingerprint 未变化时不调用 LLM，且 UI 明确显示已是最新。
- [ ] 在 Windows Obsidian Desktop 完成全部流程，并通过 Windows 路径、CRLF、文件占用和大小写冲突 fixture。

## 8. Success Metrics

所有指标只在本地记录，不要求遥测或账号体系。

### Primary Metric

**Knowledge reuse rate**：确认写入的知识，在之后 30 天内被问答、创作、链接浏览或维护任务实际重新使用的比例。

第一阶段先建立基线，不伪造目标值。产品成功的质性标准是：一周后提出相关问题时，系统能直接复用之前摄入和确认的知识，而不是再次从零理解原始资料。

### Secondary Metrics

- Time to first grounded answer：从加入来源到第一次可引用回答的时间。
- Ingest completion rate：受支持 fixture 成功形成可审核 ChangeSet 的比例。
- ChangeSet acceptance / edit / rejection rate：生成内容真正有用的程度。
- Citation navigation success：发出的引用可以实际打开并定位的比例。
- Compounding coverage：新来源更新已有相关页面而非只创建孤立摘要的比例。
- Queue recovery success：重启、暂停和失败后可恢复任务的比例。
- Unchanged skip rate：相同内容与 pipeline fingerprint 被正确跳过的比例。
- Daily friction：完成一次加入、审核和提问所需的用户操作数与等待中断次数。

### Guardrails

- 未经授权修改 Raw Source：必须为 0。
- 静默写入 generated Wiki 之外的文件：必须为 0。
- 引用指向模型未读取内容：必须为 0。
- 取消任务导致误删已有共享页面：必须为 0。
- Project 或 Bundle 范围泄漏：必须为 0。

## 9. Dependencies and Constraints

- 复用当前 LLM Provider、DeepSeek 配置、文件解析、Search v3、Tool Registry 和 ApplyView 能力。
- 新核心逻辑必须是纯 TypeScript；Vault、模型和 UI 通过 adapter 注入。
- Obsidian Vault API 没有跨文件原子事务；文件观察者可能短暂看到中间状态，产品只能通过 journal、before-hash、commit marker 和启动恢复保证最终一致且不谎报成功。
- 当前只验收 Windows Obsidian Desktop。Node/Electron 或 Windows 本地能力可以通过 adapter 使用，但任何依赖都必须兼容 Obsidian 实际捆绑的 Runtime；“只支持 Windows”不等于可以直接嵌入要求 Node 24 的 CLI。
- OKF v0.1 是 Draft 互操作契约；内部引用和时态模型要比 OKF 更严格，并支持降级导出。
- 对直接复制的 MIT、GPL 或 Apache 代码，首次落地前必须增加第三方声明和文件级来源注释。
- 当前 Search v3 已有 lexical、semantic 和 graph boost，第一阶段不引入 LanceDB、PageIndex 或另一套向量库。

## 10. Risks and Mitigations

| 风险                                          | 缓解方式                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 体验被大量审核打断                            | 默认只展示关键摘要；支持批量接受；未来仅对明确 generated directory 开启受控自动应用        |
| 模型生成不稳定                                | 两阶段编译、类型化输出、确定性校验、fail-closed review policy 和真实 fixture 回归          |
| 知识页逐渐污染                                | Raw/Wiki 分层、claim-level provenance、before hash、事务、lint 和可撤销记录                |
| 队列重启后重复扣费                            | pipeline fingerprint、持久 job 状态、恢复 backlog 默认等待用户确认                         |
| 图谱变成漂亮但无用的玩具                      | 先验证图增强检索和知识缺口任务，再建设完整 Graph UI                                        |
| 上游代码不适合中文或 Obsidian Windows Runtime | 文件级审计；保留算法，替换 ASCII tokenizer、独立 CLI 假设和错误的全局 window/document 使用 |
| 未来难以分享或发布                            | 从首次复制开始保存 commit、路径、版权、许可证和修改说明                                    |

## 11. Out of Scope

第一阶段明确不建设：

- 账号、订阅、支付、许可证服务、团队空间和多租户。
- macOS、Linux、iOS、iPadOS、Android 和浏览器版的适配与验收。
- 独立于 Obsidian 的第二套桌面编辑器或 Web SaaS。
- 无审核整理整个 Vault、自动搬家或自动重写用户笔记。
- 把 Graphiti、Neo4j、LanceDB、embedding 或模型总结作为唯一事实源。
- 为了“智能”而先做多 Agent、通用工作流编排或庞大 ontology。
- 替换当前成熟的 Chat、Search v3、Provider 或 Obsidian 编辑体验。
- 强制把整个现有 Vault 迁移成某个固定目录和 schema。

## 12. Decisions and Open Questions

### Decisions

- 产品仍然是 Obsidian 插件；Chat 是助手入口，Knowledge Studio 是知识工作入口。
- 当前唯一目标平台是 Windows Obsidian Desktop；其他系统不进入首期需求、测试矩阵或兼容性承诺。
- 先服务一个长期个人用户，不为商业化削弱体验，也不增加商业系统复杂度。
- 以端到端体验切片驱动架构，而不是先完成所有底层模块再做 UI。
- Markdown/Raw Sources 是 canonical data；图数据库和索引均为可选投影。
- 开源项目可以 copy、port 或 reference，但每项都进入复用台账。

### Open Questions to Resolve with Real Usage

- 默认 Knowledge Bundle 应怎样初始化，才能既零配置又不硬编码用户目录？
- 哪些 generated Wiki 目录在用户明确授权后可以跳过逐次 diff？
- PDF citation 在不同解析器间应以页码、文本 quote hash 还是两者共同定位？
- Knowledge Studio 首页最有价值的是最近活动、待审核、主题入口还是当前项目？
- 大批量 PDF、目录监听和未来 Graphiti 是否需要可选 Windows 本地 helper，还是始终保持单插件进程？

这些问题不阻塞首个 vertical slice；用真实 Vault 完成一轮使用后再决定。
