# Development Session TODO

## Session Goal

以 Windows 上的 Obsidian Copilot 为唯一首期平台，设计并分阶段实现一套长期个人使用、体验优先的知识操作系统；把助手、笔记和知识引擎连接为可摄入、可审核、可引用、可持续维护的完整闭环。

## Completed Tasks ✅

- [x] 阅读并拆解 SOC Agent 原始方案及其产品决策框架。
- [x] 核对当前仓库的消息、上下文、工具、搜索、记忆、项目隔离和持久化架构。
- [x] 根据用户澄清，将目标从“Copilot 项目总架构”修正为“基于 Copilot 的个人知识库方案”。
- [x] 区分当前已实现能力与 ACP、Planner、MCP 等设计中能力。
- [x] 编写个人知识库产品与技术方案文档。
- [x] 补充原方案方法的保留、改写和舍弃清单。
- [x] 检查文档与代码、现有设计文档之间的一致性。
- [x] 阅读 Karpathy LLM Wiki 原文并提炼 Raw / Wiki / Schema、Ingest / Query / Lint、index / log 模式。
- [x] 核对 Google Cloud OKF v0.1 官方公告、规范、合规规则和非目标。
- [x] 将 LLM Wiki 与 OKF 的采用方式合并进个人知识库主方案。
- [x] 调研 GitHub 上活跃的 LLM Wiki、OKF、个人知识库、Agent Memory 和时序知识图谱项目。
- [x] 对比其技术栈、知识工作流、许可证和与 Obsidian Copilot 的适配程度。
- [x] 形成可采用、延后采用和明确不采用的工程结论。
- [x] 盘点当前项目可直接复用的 Chat 文件拖入、处理进度、ApplyView、Search v3、graph boost、工具和 popout-window 能力。
- [x] 对 `llm-wiki-compiler`、OKF、`llm_wiki`、`claude-obsidian` 和 Graphiti 完成 commit 锁定、许可证与文件级代码审计。
- [x] 建立外部实现的 Copy / Port / Reference 复用分类，并记录上游需要修复的缺陷。
- [x] 编写体验优先的个人知识操作系统 PRD，定义 Knowledge Studio、Golden Flow、验收标准与本地成功指标。
- [x] 将主技术方案路线图改为端到端体验切片，并补充 manifest、pipeline fingerprint、持久队列、事务和可选时态投影。
- [x] 将首期平台范围收敛为 Windows Obsidian Desktop，移除 macOS、Linux、iOS、Android 和浏览器适配承诺。
- [x] 编写 Windows-only commit-by-commit 执行计划，并建立 Now / Next / Later 退出门槛。
- [x] 建立第三方来源声明与许可证落盘规则；五个候选当前明确标记为 audited/reference、未复制源码。
- [x] 完成 Slice 1A 纯 TypeScript 契约、strict runtime schema、语义 validator 与公共导出边界。
- [x] 完成原始字节 SHA-256、pipeline fingerprint、稳定 source identity、Windows Vault path 和输出存在性 freshness 判定。
- [x] 建立 Markdown 文本、PDF locator、OKF round-trip、Windows 路径/碰撞、文件占用和中文/emoji fixture。
- [x] 完成 Source Manifest Repository 与可注入 Storage Port；支持 stable identity、rename、freshness、扩展字段保真与 revision CAS。
- [x] 修复并发 success/failure 覆盖竞态，以单调观察时间和有界 CAS retry 保留较新状态。
- [x] 完成持久 Ingest Queue Core：严格快照、revision CAS、Bundle 隔离、claim ownership、同来源去重与 exactly-one latest rerun。
- [x] 完成暂停/恢复/取消、显式审核、指数退避、最大重试、provider 限流暂停、错误脱敏与同会话基础设施失败恢复。
- [x] 将 applying 设为事务安全边界；Commit E 日志完成前，中断或失败 apply 进入不可绕过的 recovery-required gate。

## Pending Tasks 📋

### Slice 1A：契约与来源归属 ✅

- [x] 建立 `THIRD_PARTY_NOTICES.md` 和第三方许可证目录规则；实际 Copy 时再同步加入许可证原文与文件映射。
- [x] 建立 Golden Flow 的 Markdown、PDF locator、OKF round-trip、CRLF、盘符/反斜杠、大小写碰撞、保留设备名、文件占用和中文路径 fixture。
- [x] 实现纯 TypeScript `KnowledgeBundleConfig`、`SourceManifestEntry`、`SourceLocator`、`ClaimCitation`、`KnowledgeIngestJob` 和 discriminated `KnowledgeFileChange`。
- [x] 实现 source byte hash、pipeline fingerprint、稳定 source identity、Windows path contract 和输出存在性校验。

### Slice 1B：持久队列与可恢复写入

- [x] 实现可注入的 `QueueStorage`、`IngestExecutor`、`EventSink`、`RetryPolicy` 和队列状态机。
- [x] 支持任务去重、处理中 latest rerun、暂停、取消、指数退避、重试、stale claim 防护和安全启动恢复。
- [ ] 实现 Windows/Vault `QueueStorage` adapter 的原子 revision compare-and-replace，以及跨重启、并发安全的 per-source `inputRevision` 分配器。
- [ ] 在接入长期 Activity UI 前定义 terminal job 归档/压缩策略，避免运行队列无限增长。
- [ ] 实现 before-hash CAS、pre-state journal、确定性写入顺序、commit marker 和启动恢复。
- [ ] 验证失败或崩溃后不会出现“任务/manifest 已成功但 Wiki 页面未完成”的状态。

### Slice 1C：Golden Flow 产品闭环

- [ ] 在 Chat 文件拖入中增加 `Use in this chat` / `Add to Knowledge` 分流。
- [ ] 完成单来源两阶段 compile，并限制生成阶段只能修改分析阶段确定的目标集合。
- [ ] 扩展 ApplyView，支持多文件 create/update/delete、来源、校验和逐文件/逐块审核。
- [ ] 建立最小 Knowledge Studio / Activity 表面，显示解析、分析、生成、校验和审核阶段。
- [ ] 将新 Wiki 接入 Search v3，支持 grounded answer、citation jump 和从回答保存回 Wiki。
- [ ] 完成 `Markdown/PDF → queue → compile → review → write → grounded query → unchanged skip` 的首个 vertical slice。

### Parallel Reliability Track

- [ ] 在最终消息装配点执行 L1-L5 总 token 预算。
- [ ] 使用确定性 fallback artifact ID。
- [ ] 修复聊天重载后的 context envelope 恢复一致性。

## Architecture Decisions

- 新方案以个人知识资产可拥有、可追溯、可迁移为产品边界。
- 以 `MessageRepository`、`ChatManager`、L1-L5 `PromptContextEnvelope` 和 `ToolRegistry` 为当前架构基线。
- LangChain 路径按当前已实现能力描述；ACP、显式 Planner 和动态 MCP 接入按演进目标描述。
- 迁移 SOC 方案的控制流、证据边界、权限、候选式学习和薄入口原则，不迁移告警、租户、Kafka、PostgreSQL、复核队列等领域结构。
- 将 Karpathy 的 LLM-maintained Wiki 作为知识复利层，将 OKF 作为该层的可选标准化文件契约；二者都不替代 Copilot Runtime。
- 不引入第二套桌面应用、Python sidecar 或图数据库作为 MVP 前提；优先在现有 TypeScript Runtime 内实现编译式 Wiki 契约。
- 优先借鉴 `llm-wiki-compiler` 的两阶段编译、manifest、ChangeSet、lint/eval 和 OKF 互操作，但在依赖和代码审计前不直接接入其 Node 24 CLI Runtime。
- Chat 继续作为即时助手入口，新增全页 Knowledge Studio 承载 Sources、Wiki、Review、Activity、Graph 和 Health。
- 体验优先不等于直接写盘：信任机制通过阶段进度、citation、multi-file diff、事务和撤销融入主流程。
- 当前 Search v3 是基础检索底座；只增加 Wiki 渐进发现和一跳图扩展，不引入 LanceDB 或第二套基础搜索。
- Source hash 必须与 pipeline fingerprint 共同决定幂等，避免 schema、parser 或模型变化后错误跳过。
- `llm_wiki` 主要提供 Knowledge Studio、队列、来源卡片、Review Inbox 和图谱 UX；不引入 Tauri/Rust Runtime。
- `claude-obsidian` 主要提供 hot/index/domain/page、Manifest 与 Ingest/Query/Lint 工作流；不复制 Bash 锁和自动 Git hook。
- Graphiti 当前只贡献 provenance 和双时态契约；只有真实历史/多跳需求达到门槛后才作为可重建外部投影接入。
- 外部源码按 Copy / Port / Reference 管理；首次复制时同步提交 attribution、许可证、原 commit/path 和修改说明。
- 当前唯一产品与验收平台是 Windows Obsidian Desktop；不为 macOS、Linux、iOS、Android 或浏览器增加兼容工作。
- 允许在 adapter 边缘使用有明确体验收益的 Windows/Node/Electron 能力，但纯知识契约保持 TypeScript 与 I/O 无关。
- 不因平台收敛直接嵌入 Node 24 CLI；所有依赖仍须兼容 Obsidian 实际捆绑的 Windows Runtime。
- Manifest 不保存 processing 状态；持久来源状态与当前 Queue Job 在 UI 层按 `sourceId` 联结。
- `sourceContentHash` 使用原始文件字节；citation quote 只统一换行符；ChangeSet before/after hash 保留精确文本字节语义。
- Windows Vault path 在领域边界选择“验证并拒绝”，不静默修复盘符、UNC、反斜杠、保留设备名或碰撞目标。
- Pipeline fingerprint 只接受 allowlisted JSON 配置，并防御性拒绝 credential-like 字段。
- Queue 的 `inputRevision` 必须由 source adapter 按 source 严格单调分配、跨重启保存，并在相同内容观察时同样推进；不得使用内存计数器或文件 mtime 代替。
- `QueueStorage.write` 的 expected revision 比较与完整 snapshot 替换必须是 adapter 内的同一原子操作。
- Queue snapshot 使用 strict、显式版本化 schema；新增持久字段必须配套版本升级和迁移，不得依靠静默宽容读取。
- Queue 执行语义是 at-least-once：持久 claim 保证同一时刻至多一个 active job，attempt ownership 拒绝迟到结果，但终态写入前崩溃仍可能重放模型调用。
- EventSink 只提供非阻塞 post-commit 通知，持久 Queue snapshot 才是状态真相。
- applying 在 ChangeSet journal 接入前不可取消、自动重试或普通恢复；失败后只能由 Commit E 的事务恢复流程解除 gate。

## Testing Checklist

- [x] 核对所有“当前能力”均能在代码或现有设计文档中找到依据。
- [x] 核对所有规划能力均明确标记为目标或阶段项。
- [x] 运行 Markdown 格式检查。
- [x] 检查 Git diff，确保未修改无关文件。
- [x] 检查新增 PRD、主方案与复用台账之间的链接和决策一致性。
- [x] 检查 Markdown heading/fence/link 结构并运行 `git diff --check`；仓库没有安装 `node_modules`，未调用 Prettier。
- [x] 确认没有修改 DeerFlow/SOC 文件或把 `.env.test` 纳入版本控制。
- [x] Knowledge foundation 通过 TypeScript `noEmit`、目标 ESLint、Prettier check 与 11 个 Jest suite / 305 个测试。
- [ ] 首批功能实现后，在 Windows Obsidian 测试 Vault 中完成 Golden Flow 实机验收。

## Source Documents

- [`designdocs/PERSONAL_KNOWLEDGE_OS_PRD.md`](./designdocs/PERSONAL_KNOWLEDGE_OS_PRD.md)：产品目标、Golden Flow、需求和验收标准。
- [`designdocs/PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./designdocs/PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md)：技术架构、数据契约、可靠性与路线图。
- [`designdocs/OPEN_SOURCE_REUSE_PLAN.md`](./designdocs/OPEN_SOURCE_REUSE_PLAN.md)：外部代码 Copy / Port / Reference 台账。
- [`designdocs/GITHUB_PERSONAL_KNOWLEDGE_LANDSCAPE.md`](./designdocs/GITHUB_PERSONAL_KNOWLEDGE_LANDSCAPE.md)：开源项目调研快照。
- [`designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md`](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md)：Windows-only commit 顺序、依赖与退出门槛。
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)：人工复制/派生外部材料的归属台账与发布门禁。
