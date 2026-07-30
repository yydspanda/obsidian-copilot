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
- [x] 完成持久 Ingest Queue Core：严格快照、revision CAS、Bundle 隔离、claim ownership、同来源去重、durable source high-watermark 与 exactly-one latest rerun。
- [x] 完成 Queue 纯 core 的暂停/恢复/取消、安全启动状态转换、显式审核、指数退避、最大重试、provider 限流暂停、错误脱敏与同会话基础设施失败恢复；不等同于真实 startup coordinator 已接通。
- [x] 将 applying 设为事务安全边界；Commit E 日志完成前，中断或失败 apply 进入不可绕过的 recovery-required gate。
- [x] 完成 accepted ChangeSet preflight、Vault-global pre-state journal、Windows 确定性写入、单文件原子 CAS、commit marker 与纯 transaction core 的幂等 startup roll-forward；真实启动编排仍是 pending。
- [x] 完成 Queue v2 exact apply/commit marker、v1 严格迁移与提交协调器；Commit G 再严格迁移到 v3，并加入 pending Review Store anchor、accepted terminal identity 与 durable rejection tombstone。
- [x] 完成 provider-neutral 两阶段 Knowledge Compiler Core：strict unknown output、可信 evidence 映射、caller-owned target authorization、Windows exact observation、opaque target binding、runtime hash/id/status、确定性 candidate validation 与 fake-model 回归。
- [x] 从 legacy ApplyView 抽取无写入能力的精确 diff renderer，并修复普通 rerender、popout migration 与定时器的 document/window 归属。
- [x] 完成 strict durable Review Store：完整 proposal、canonical digest、queue job claim、record revision、accepted/rejected payload、CAS 竞争与幂等重放。
- [x] 完成 Review Store → Queue 的 0→1 hand-off：Queue 只有收到同 Bundle、同 exact job claim 的 durable pending record 才进入 `awaiting_review`；接受/拒绝必须匹配该 proposal digest 与 terminal revision 1。
- [x] 增加 `reconcilePendingReview`，可在 proposal 已落盘但 Queue 尚未完成 hand-off 的崩溃窗口后，把同一 attempt 恢复为 awaiting-review；v1/v2 `legacy_unverified` anchor 只能由真实 pending record 升级。
- [x] 完成 opaque multi-file review decision Core：逐文件/逐块选择只传 opaque id，Core 精确重组文本、重新 hash、重新验证；delete 在授权 read-set journal 化前 reject-only。
- [x] 完成 durable Queue review rejection：Queue v3 保存 exact job/changeSet rejection identity，拒绝不构造空 accepted ChangeSet，并原子提升 retained latest rerun。
- [x] 完成 Activity 只读投影、Review/Activity React 面板、reload-only Controller，以及 popout-safe Windows Knowledge Studio ItemView。
- [x] 加入 Windows Desktop 功能级 guard、命令/导航入口与用户文档；保留现有插件 `isDesktopOnly: false`，不扩大 Knowledge Studio 的平台承诺。
- [x] 完成 `knowledge-runtime-v1.json` 持久化基础代码：单一 strict envelope 承载 Queue、Review、Manifest、Vault-global Transaction slot 与 watcher-capture `inputRevision`，所有替换经过完整 envelope 语义校验和 revision CAS。
- [x] 完成 Windows 文件 adapter 的 create/update 代码层：首次 runtime 以完整临时文件 + flush + 排他 hard-link 发布，Wiki create 使用排他创建，update 使用 `Vault.process`，能力声明绑定 store 并在 preflight 前禁用 delete；真实 Windows Obsidian 验收与 Golden Flow 接线仍未完成。
- [x] 完成 Review Store 启动协调器 Core：pending 审核可恢复 exact Queue anchor，rejected 审核可恢复其 pending predecessor 后收敛为 durable rejection，重复启动零 Queue revision 增长；accepted 只输出 identity-only runtime classification 输入，不自动调用模型、开始 apply 或写 Wiki。协调器以有界 revision 重读取得稳定 Review snapshot，并把 observed revision 返回给更高层继续复证。
- [x] 完成 G.2b durable Manifest plan/intent：Compiler 冻结完整 primary-source page projection、ownership/authorization、Manifest revision/digest 与 source hash/pipeline/input revision；Review v2 只能从 immutable plan 投影 accepted filter/rewrite，transaction journal v3 通过 plan digest 持久回链最终 intent。
- [x] 完成 exact atomic Manifest/apply ledger adapter：首次 prepared journal 在 shared envelope 内预留 Manifest read-set 与单调 source revision，页面 committed 后 Manifest success 与 ledger 同 transform 发布；exact replay 不改字节，同 transaction id 不同 identity fail closed。
- [x] 收紧 Runtime v2 authority：普通 Manifest storage 不能创建/修改 `lastSuccessful` 或 reserved commit metadata，active transaction 锁住通用 Manifest CAS；shared page update 原子传播所有 co-owner hash，unsafe runtime-v1 状态保留原字节并 typed fail closed。
- [x] 完成 Runtime v2 启动交叉校验：Manifest success 与 reserved metadata 必须双向存在并指向该 source 最新 ledger；source/hash/pipeline/input/intent/ChangeSet/time、Manifest revision/digest、连续 ledger 链与 Windows shared-page co-owner projection 任一撕裂均在启动时 fail closed。
- [x] 在 prepared journal 发布前拒绝复用已入 ledger 的 transaction id，并把 durable transaction replacement 限定为 immutable payload 下的合法 prepared → applying → committed/recovery 状态迁移。
- [x] 完成 Queue v4 与全写入周期原子授权复证：accepted apply claim 持久化最终 Manifest intent digest；直接 apply 在任何 target observation 前先复证完整 Queue/Review/allocator/Manifest read-set/source-order authority，prepared 发布、prepared → applying、启动读取 unfinished journal、每次共享 envelope mutation 与最终 Manifest+ledger callback 都重复或保留该证明；旧 v3 或 stale Manifest 在任何新 Wiki 文件访问前 fail closed。
- [x] 完成 no-journal 显式恢复 Core：Queue v5 保存 exact abandonment tombstone，Runtime 从同一 atomic envelope 分类 accepted-not-started/active/blocked/finalizing/committed/abandoned，并以 opaque recovery id 在 continue 前重证完整 Manifest authority，或在无任何 journal/commit/ledger 写入证据时原子 abandon；崩溃重放与 prepared-publication 竞争均收敛且不产生 split-brain。
- [x] 完成 layout-ready startup gate Core：严格按 Queue startup recovery → active transaction/commit marker 收敛 → Review hand-off 收敛 → Runtime 单-envelope accepted 批量分类执行；首次 sticky file conflict 只接受同 transaction 的 blocked 重读，Review revision 变化有界重跑。Gate 保留 Runtime/Queue revision 高水位、精确校验 accepted action↔classification 集合，并从最终 atomic snapshot 观察 Vault-global transaction；返回的 `observed_clear` 仍只是乐观展示结果，不会自动 resume、begin accepted apply、continue、abandon 或调用模型。
- [x] 完成 shared-envelope conditional startup release Core：`observed_clear` 只生成 Runtime/Review/Queue revision 乐观令牌，Runtime 在同一次原子 transform 中重证 Vault-global transaction、跨 Bundle 写恢复证据、当前 marker/claim/applying 状态与全部 accepted terminal classification，成功时只把 exact `startup_recovery` Queue 改为 running 并提升 Queue/Runtime revision。普通 `resume()`、`pause → resume` 与两步 generic Queue CAS 都不能清除或洗白 `startup_recovery`/`recovery_required`/`commit_pending_ack` 单调恢复门；同门写入必须保留当前 claim/job/marker，accepted-not-started anchor 在 running/startup 状态均受保护，跨门写入必须等于 accepted begin、startup recovery、current committed journal resolution 或 marker finalization 的精确投影，不能拿历史 ledger 替换当前恢复证据。`applyAbandonments` 对通用 Queue writer 永远只读，只能由显式 Runtime abandon 原子追加；source high-watermark 不可删除、回退或在同 revision 改写，任何推进（含首写）都不得超过共享 allocator，同时保留合法 A→B→A watcher 收敛。commit-then-throw 不猜测成功，旧令牌失效后必须重跑 Gate。`accepted_not_started` 可由显式 exact acceptance 在 running 或保持 startup pause 的情况下建立 apply claim，崩溃则升级为 no-journal recovery。

## Pending Tasks 📋

### Slice 1A：契约与来源归属 ✅

- [x] 建立 `THIRD_PARTY_NOTICES.md` 和第三方许可证目录规则；实际 Copy 时再同步加入许可证原文与文件映射。
- [x] 建立 Golden Flow 的 Markdown、PDF locator、OKF round-trip、CRLF、盘符/反斜杠、大小写碰撞、保留设备名、文件占用和中文路径 fixture。
- [x] 实现纯 TypeScript `KnowledgeBundleConfig`、`SourceManifestEntry`、`SourceLocator`、`ClaimCitation`、`KnowledgeIngestJob` 和 discriminated `KnowledgeFileChange`。
- [x] 实现 source byte hash、pipeline fingerprint、稳定 source identity、Windows path contract 和输出存在性校验。

### Slice 1B：持久队列与可恢复写入

- [x] 实现可注入的 `QueueStorage`、`IngestExecutor`、`EventSink`、`RetryPolicy` 和队列状态机。
- [x] 支持任务去重、处理中 latest rerun、暂停、取消、指数退避、重试、stale claim 防护和 Queue 纯 core 的安全启动状态恢复。
- [x] 实现 Windows/Vault `QueueStorage` adapter 的 revision compare-and-replace 代码层，以及跨 runtime 重建、并发安全的 per-source watcher-capture `inputRevision` 分配器；真实 Windows `DataAdapter.process` 行为仍由独立实机验收项负责。
- [ ] 生产 source watcher 接线时增加专用 observation hand-off，把 allocator revision 与随后读取到的 source hash/pipeline 绑定并限制低层 Queue facade 的调用边界；当前 scalar allocator 能证明顺序和上界，但不会自行证明调用方提交的 payload 确实来自该次文件读取，因此 Studio 继续 unavailable。
- [ ] 在接入真实 durable adapter 并长期使用前定义 terminal job 归档/压缩策略，避免运行队列无限增长。
- [ ] 终态归档必须原子协调 Queue jobs、pending review anchors、accepted/rejected identity、Review Store terminal records 与 source high-watermark；若删除历史，必须保留等价 tombstone，不能留下悬空记录或让旧输入复活。
- [x] 实现 before-hash CAS、完整 pre-state journal、确定性写入顺序、commit marker 和 transaction 纯 core 启动 roll-forward。
- [x] 在纯 core 协调器层验证任一断点后都不会出现“任务/manifest 已成功但 Wiki 页面未完成”的状态。
- [x] 实现 Windows/Vault `TransactionStorage` 的 Vault-global revision/token CAS slot 代码层，并以永久 envelope slot 的 `null` 清除避免删除状态文件。
- [x] 实现 `KnowledgeFileStore` 的排他 create 与 `Vault.process` update compare-and-swap 代码层；after-state replay 可识别 `already_after`，第三状态 fail closed。
- [ ] 实现可证明安全的 compare-and-delete；当前生产 capability 固定 `delete: false`，精确 before 确实需要删除时必须拒绝，不能用 read-then-delete 冒充。
- [ ] 在真实 Windows Obsidian test Vault 验证 `DataAdapter.process`/`Vault.process` 的 callback 串行化、双实例竞争、返回值、插件重载、外部编辑与崩溃行为；完成前不宣称 power-loss durability 或 production-ready CAS。
- [x] 实现 exact `transactionId/revision/changeSetDigest/intent/journal/receipt` 幂等的 `ApplyCommitManifestPort` adapter/ledger；同 identity 重放是 byte-preserving 单一逻辑成功，同 key 不同 digest fail closed。
- [x] 将完整 post-compile `generatedPages`、ownership/authorization、Manifest revision/digest 与 per-source hash/pipeline/`inputRevision` 作为 durable plan/intent 写入 Review/transaction journal，并在 Runtime prepared reservation 与最终 commit 重复复证。
- [ ] 将 schema、非 target link 与 source artifact 的 read-set 写入 journal，并在首次写入与恢复前复证；Manifest target authorization（revision、ownership、co-owner、sole-source、last-generated hash）子集已完成。完成其余 dependency 与 safe compare-delete 前真实 UI/apply 继续不启用 compiler delete。
- [x] 在 Manifest+ledger atomic callback 内重证 exact Queue apply claim、review identity 与 allocator/source high-watermark；coordinator 的早期 Queue verify 只作快速诊断，最终授权与 Manifest/ledger 同一原子 transform，exact ledger replay 继续最先返回。
- [ ] 为 outer runtime revision 预留 transaction progress、Manifest/ledger、Queue marker、journal ack/release 所需容量，避免接近 `Number.MAX_SAFE_INTEGER` 时文件 CAS 后才耗尽 envelope revision。
- [ ] 定义并实现 `no_changes` 的 durable source-success/Manifest revision 语义；当前无文件 ChangeSet 不产生 Manifest commit plan，不能静默当作已成功摄入。
- [ ] 在真实写盘前决定 CAS 后、progress 前崩溃的 content ABA 策略：接受 content-addressed at-least-once，或增加 mutation-intent marker 并在精确 before 状态 fail closed。
- [ ] 为 transaction `recovery_required` 增加显式重新校验、继续、回滚或放弃动作及 Knowledge Studio 恢复 UI。
- [x] 为“accepted apply claim 已落盘、transaction journal 尚未创建即崩溃”增加 no-journal 显式恢复 Core：先从同一 runtime snapshot 证明 exact Review/Queue/allocator 身份以及 journal、commit marker、source-input ledger 均不存在，再允许 continue 或 abandon；不得自动推断未写盘。Manifest 漂移会阻止 continue，但不阻止经原子证明的 abandon。
- [ ] 严格解析并脱敏 file/projection adapter 的运行时成功返回值，非法 adapter payload 统一映射为受控 infrastructure error。

### Slice 1C：Golden Flow 产品闭环

- [x] 为 Knowledge Studio 加入 Windows Desktop 功能级 platform guard、非支持平台提示，并记录 `manifest.json` 保持非 desktop-only 的兼容决定与用户文档。
- [ ] 首个真实 Windows adapter 接入时完成独立测试 Vault 验收；功能 guard 不能替代原子 Windows/Vault adapter。
- [ ] 在 Chat 文件拖入中增加 `Use in this chat` / `Add to Knowledge` 分流。
- [x] 完成纯 Core 单来源两阶段 compile；生成阶段只能返回已批准的 opaque target id，不能提交 path、operation、hash、source refs、validation 或 status。
- [ ] 接入真实 parser artifact、provider structured-output adapter、target authorization/resolver 与 projected OKF/link validator；adapter 不得解析 fenced JSON 或静默修复模型输出。
- [x] 抽取 ApplyView 的纯 diff 展示，并以独立 Review Core/UI 支持多文件 create/update、来源、校验和逐文件/逐块审核；delete 可见但 reject-only。
- [x] 建立最小 Knowledge Studio / Activity 表面，显示解析、分析、关联、生成、校验、审核、apply、finalizing 和 recovery 阶段；真实 adapter 未接通前明确 fail closed。
- [x] 将 Review startup reconciliation、active transaction recovery 与 no-journal atomic classification 组装进纯 TypeScript layout-ready startup gate；Gate 只收敛已有 journal/commit 证据，不执行 no-journal 决策或 Queue resume。
- [x] 为 clear startup observation 实现独立 conditional release Core；observation 变化保持原字节并要求重跑 Gate；非 startup pause 与 recovery evidence 作为显式 blocker 原样保留，须先由对应用户/限流/恢复流程改变状态，再取得 fresh Gate observation，不能降级为普通 Queue resume。
- [ ] 为 startup gate/release 接入生产 Bundle 配置源、完整 recovery validator/file adapter、插件级 singleton/delegating Studio port 与恢复 UI；singleton 必须在每个配置 Bundle 完成 startup 编排前隔离 worker 与普通 Resume，尤其不能把保留的 user/rate-limit pause、empty/running Queue 当作“已完成 Gate”的持久证明。接线前继续保持 `adapter_unavailable`，不得硬编码 Bundle 路径、自动 continue 或把 `observed_clear` 当作 claim authority。
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
- source adapter 必须在 watcher handler 开始、任何异步读取/解析之前先分配 `inputRevision`，再通过生产 observation hand-off 把 revision 绑定到随后读到的 bytes/hash；这样较早读取若较晚完成，会被 Queue 的更高 source high-watermark 拒绝。allocator 只按捕获顺序编号，不能在异步读取结束后倒置调用。当前 Core 已拒绝未分配、删除、回退和同 revision 改写的 high-watermark，但 scalar allocator 本身不是 payload authenticity proof，生产 watcher 接线前必须补上该边界。
- Compiler source identity 与 ChangeSet/review identity 同时包含 `inputRevision`；因此来源 A→B→A 不会复用第一次 A 的审核实例。该来源观察 ABA 已关闭，不等同于仍待决定的文件写入 content ABA。
- Queue 在 claim 外持久每个 source 的 `sourceHighWatermarks`（revision + source hash + pipeline fingerprint）；等价的更新观察不能改写已认领输入，但必须推进 high-watermark 以拒绝后到的旧内容。
- `QueueStorage.write` 的 expected revision 比较与完整 snapshot 替换必须是 adapter 内的同一原子操作。
- Queue snapshot 使用 strict、显式版本化 schema；新增持久字段必须配套版本升级和迁移，不得依靠静默宽容读取。
- Queue 执行语义是 at-least-once：持久 claim 保证同一时刻至多一个 active job，attempt ownership 拒绝迟到结果，但终态写入前崩溃仍可能重放模型调用。
- EventSink 只提供非阻塞 post-commit 通知，持久 Queue snapshot 才是状态真相。
- ChangeSet journal v3 使用 Vault-global 单活动槽；完整 Bundle、accepted ChangeSet、精确 before/after、最终 Manifest intent/plan digest，以及 owning source id/hash/pipeline/input revision/job attempt/start 一并持久化；claim source 必须存在于 ChangeSet source refs。
- 单文件写入只能通过 adapter 原子 compare-and-swap；全局 journal 提供可恢复语义，但 Obsidian Vault 不具备真正跨文件原子性。
- 自动恢复只做幂等 roll-forward；divergent state 进入 sticky `recovery_required`，不自动 rollback 或覆盖用户编辑；committed marker 对后续用户修改保持权威。
- Queue v5 保留 exact `applyClaim`、pending review anchor、review rejection tombstone、no-journal apply abandonment tombstone 与 `commit_pending_ack` marker；审核 hand-off 固定为 durable pending record revision 0 → exact accepted/rejected record revision 1。accepted apply claim 同时绑定 proposal digest、accepted digest、最终 Manifest intent digest、review revision/time 与完整 job claim；启动恢复改为 failed 后仍原样保留。v1/v2 无法证明的 review/apply state，以及 v3 已开始但未保存 intent digest 的审核 apply，都以 `legacy_unverified` 明确 fail closed；v4 严格迁移时只初始化空 abandonment 历史，不猜测 cancelled job 的旧决策。
- no-journal recovery id 只由跨完整生命周期仍会保留的 accepted Review identity 派生，不把最终成功后已不再保存的 `startedAt` 放入 id；action 时仍必须从当前 exact Queue claim 重新取得并核验 `startedAt`。continue 先由 Runtime 重证 Queue/Review/high-watermark/allocator/Manifest/source-order，再由 prepared-journal atomic publication 重证；abandon 则在同一 envelope transform 中要求任何 phase 的 active journal、Queue commit marker 与同 source/input ledger 均不存在，保留 immutable accepted Review，并写 cancelled job + exact tombstone。
- startup gate 必须持有严格的当前 Bundle 配置，因为 prepared/applying journal 的已有证据恢复可能真实观察并 CAS Wiki；Gate 先恢复 Queue，再收敛 active transaction/commit marker、Review pending/rejected hand-off，最后由 Runtime 在同一 envelope 中按 exact Review revision 批量返回 Queue、Vault-global transaction 与 accepted classifications。Gate 用统一 opaque recovery id 精确证明 accepted actions/classifications 一一对应，并拒绝 Runtime revision 回退、Queue revision 回退或同 revision 不同内容；`observed_clear` 不直接释放 startup pause。独立 release coordinator 只传递 Runtime/Review/Queue revision，Runtime 在同一 envelope mutation 中重证全部写恢复和 accepted terminal evidence后才释放；generic Queue facade 将 `startup_recovery`、`recovery_required` 与 `commit_pending_ack` 作为单调门，同门 mutation 必须保留 current claim/job/marker，running/startup 的 accepted-not-started pending anchor 也不能被 generic CAS 擦除；跨门 mutation 必须等于 exact accepted-begin、startup-recovery、current-active-committed resolution 或固定 metadata 的 marker-finalization 投影，任何一步都不能借历史 ledger 或伪造 abandonment 替换证据或降级为 running/user/rate-limit。Runtime 专用 abandon 是 append-only tombstone 的唯一写 authority；watcher high-watermark 不可删除、回退、同 revision 改写或超过 allocator，合法较新观察仍可更新 processing/awaiting job 的 rerun 状态与单调 `updatedAt`。没有 durable release receipt 时，commit-then-throw 后旧令牌只会失效，调用者必须重跑 Gate，不能用 `revision + 1` 猜测成功。
- Review 启动协调器只拥有 Review/Queue port：按 `recordedAt + changeSetId` 稳定扫描，pending/rejected 做 exact、可重放的 Queue 收敛；accepted 只返回供更高层 journal/ledger/no-journal 分类的 identity，绝不在启动时调用 `beginReviewApply`。每轮 mutation 后重读 Review revision，持续变化超过有界次数即 fail closed；返回 revision 仍须在最终 startup gate 复证。它尚未接入 plugin startup，不能据此开放 Studio。
- applying executor 必须返回 `completed + exact commitReceipt`；`IngestQueue.runNext` 只对外转换为 `commit_ready`，Queue 在 Manifest 之前仍保持 processing/applying。审核接受转换为新的 durable applying claim，不能直接完成 job。
- 页面提交后的协议固定为只读 `queue claim verify`，再持久执行 `atomic authority reproof+manifest+ledger → queue marker → journal ack → queue release`；最终 callback 从同一 runtime envelope 复证 Queue claim、accepted Review payload/intent 及 `allocator ≥ source high-watermark ≥ apply claim`，再按 exact transaction/revision/ChangeSet/intent/journal/receipt digest 幂等发布成功。较新的同内容观察可并存；较新的不同内容必须由 retained rerun 或启动恢复后 promoted successor 精确证明。
- 每个 retained rerun 必须精确等于该 source 当前 high-watermark；终结旧 apply 时若已有同 source active successor，rerun 继续归 successor 所有，不能被重复提升为第二个 active job。
- `commit_pending_ack` Queue marker 必须在每次 runtime parse 时与同一 transaction 的 apply ledger 精确匹配 source/hash/pipeline/input/ChangeSet/digest/revision/time；active journal 已清除但 ledger 缺失或 marker 撕裂时启动直接 fail closed。
- 直接 `ChangeSetTransaction.apply` 在 target observation 前必须通过 runtime authority port 复证 Queue/Review/high-watermark/allocator 与 Manifest read-set/source commit ordering；prepared 发布在同一 shared-envelope transform 内重复证明以关闭预检竞争。prepared → applying、启动读取 prepared/applying journal 以及活动事务期间的每次 envelope mutation 都保留同一完整 reservation；Queue v3 缺少最终 intent digest或 Manifest 已漂移时，不会先观察或修改 Wiki 文件再到最终 ledger 才失败。
- 清除 Queue marker 后仍保留 `startup_recovery` 暂停；必须重跑 Gate 并通过 conditional release，普通 Resume 不能清除该 gate。
- Compiler stage 1 只能从 caller-owned target catalog 读取/修改已知页；catalog 外路径只拥有 create-only 权限，resolver 必须使用 Windows 大小写不敏感 existence probe，既有内容不得送入生成模型。
- Compiler delete 只允许 Manifest 标记为 generated、由当前 primary source 独占且当前 bytes 仍匹配 last-generated hash 的目标；该授权已进入 Review plan/journal intent，并在 Runtime reservation/commit 复证，但安全 compare-delete 与其余 semantic dependency 未完成，产品仍保持 reject-only。
- Stage 2 只接收 runtime 绑定后的 create/update targets，并按 exact target-set digest 返回 `targetId + write/unchanged`；delete 原文、自由路径、operation、hash、validation 和 status 永不进入模型输出契约。
- 模型 citation 只能选择本次实际提供的 evidence id；source/artifact identity、locator 与 quote hash 来自 parser-owned registry，普通 claim 必须至少有一条 material-valid `supports`，`context/contradicts` 不构成 grounding。
- Candidate validator 是构造 proposed ChangeSet 的必需端口；三项 validation flag 均须由确定性 runtime 返回 true，Compiler 永不构造 accepted/applied 状态，apply-time 仍独立复验。
- legacy ApplyView 的 `Vault.create/modify` 路径继续只服务既有单文件工具；Knowledge Review 只复用纯 diff renderer，绝不把该路径当作 ChangeSet transaction writer。
- Review UI 只能提交 proposal/snapshot identity 与 opaque change/block ids；选择后的 content/hash/validation/accepted status 与完整 ChangeSet digest 由 Core 重建，同时保留 proposal-owned change identity/order，UI 无 Vault/App/storage 依赖。
- Durable Review Store v2 独立于 Queue 保存完整 proposal、Manifest commit plan 和终态 payload/intent；Queue 不能只靠 `awaiting_review.changeSetId` 支撑重启恢复。executor 必须先保存 pending record，再把精确 receipt 交给 Queue；启动编排器在重新 claim 前必须扫描并调用 `reconcilePendingReview`。
- `awaiting_review` 不能走通用 `cancel()`；拒绝必须先写入 durable Review Store，再由 `rejectReview()` 原子移除 pending anchor、写 rejection tombstone 并提升 retained rerun。
- 同一 accepted receipt 在 active applying claim 内重放不增加 revision/event；冲突 receipt fail closed。apply 已完成并清除 claim 后的晚到接受不重新 apply，而由未来 Review/Manifest 协调器判断 already-applied。
- Compiler delete 的 Manifest ownership、source provenance 与 last-generated hash read-set 已持久复证；在原子 compare-delete、schema/link/source-artifact dependency 与 Windows 实机验收完成前仍始终以 `reject_only` 呈现。
- Activity 的唯一事实源是 strict durable Queue snapshot；EventSink 只是 reload hint，`applyCommit`/`commit_pending_ack` 清除前 completed job 必须显示为 finalizing。
- Queue v3 引入、v4 保留的 `reviewRejections` 为拒绝动作提供跨崩溃幂等和 identity conflict 防护；拒绝先持久化 Review Store，再转换 Queue job，不制造空 accepted ChangeSet。
- Knowledge Studio 只在 Windows Obsidian Desktop 注册。整个 Copilot 插件仍保留原有平台范围，因此 `manifest.json` 不改为 desktop-only；这不构成对其他平台 Knowledge Studio 的支持承诺。
- 当前 Windows 启动只初始化插件私有 `knowledge-runtime-v1.json`（文件名稳定、outer schema v2）与 unavailable notice；Queue/Review/Manifest/Transaction facades、文件 writer、compiler、startup recovery 和 query coordinator 尚未连到 Studio，因此不会展示伪造任务、调用模型或写 Wiki。
- `knowledge-runtime-v1.json` 是首期个人规模的共享 envelope：跨子系统 CAS 简单，但每次 mutation 都全量 parse/validate/stringify/rewrite，存在 O(envelope size) 写放大和共享腐坏故障域。真实长期使用前必须设 size/latency threshold、协调 terminal archive/compaction，并在超过门槛时分片；它不是产品必须永久保留的核心格式。
- Runtime outer schema v2 只自动迁移可证明 idle 且没有历史 Manifest success 的 v1 envelope；active transaction、apply/review recovery、ledger、旧 success 或 reserved metadata 都不能靠猜测升级，必须保留原字节并 typed fail closed。
- Runtime v2 每次 parse 都交叉验证 Manifest、reserved commit extension 与 apply ledger；历史 ledger 可保留，但 extension 必须指向该 Bundle/source 的最新 proof，当前 revision 与连续 digest 链不能倒退或断裂，多来源同 Windows path 必须保持 exact shared ownership/hash。
- `SourceManifestStorage` 的通用路径只允许注册/重命名/失败观察和非保留 metadata；`lastSuccessful` 与 runtime reserved commit extension 只能由 atomic Manifest+ledger adapter 修改。shared page 的实际 owner 集由 exact Manifest digest 冻结，commit 时要求 owner authority 一致并同步推进所有 owner hash。
- 首次 runtime 文件以同目录完整临时文件、handle flush 和排他 hard-link 发布，避免并发启动暴露空/半 JSON；目录级掉电持久性与 NTFS/OneDrive/junction 行为仍属于 Windows 实机验收，不作超出证据的承诺。

## Testing Checklist

- [x] 核对所有“当前能力”均能在代码或现有设计文档中找到依据。
- [x] 核对所有规划能力均明确标记为目标或阶段项。
- [x] 运行 Markdown 格式检查。
- [x] 检查 Git diff，确保未修改无关文件。
- [x] 检查新增 PRD、主方案与复用台账之间的链接和决策一致性。
- [x] 检查 Markdown heading/fence/link 结构并运行 `git diff --check`；仓库没有安装 `node_modules`，未调用 Prettier。
- [x] 确认没有修改 DeerFlow/SOC 文件或把 `.env.test` 纳入版本控制。
- [x] Knowledge foundation 通过 TypeScript `noEmit`、目标 ESLint、本次变更文件 Prettier check 与 16 个 Jest suite / 444 个测试。
- [x] Commit E 集成后全仓单元回归通过：131 个 Jest suite / 2551 个测试；现有测试中的预期 console 警告不影响结果。
- [x] Commit F 通过 5 个定向 Jest suite / 79 个测试、TypeScript `noEmit`、全仓 ESLint 与本次变更文件 Prettier check；集成后全仓 135 个 Jest suite / 2623 个测试全部通过。
- [x] Commit G 通过 TypeScript `noEmit`、全仓 ESLint、15 个定向 Jest suite / 190 个测试，以及全仓 148 个 Jest suite / 2750 个测试；预期的既有 keychain/解密 console 输出不影响结果。
- [x] Commit G 新增/修改文件均经 Prettier 格式化；全仓 `npm run format:check` 只被本次未修改的既有 `src/LLMProviders/chatModelManager.ts` 格式基线阻塞，继续不夹带修改。
- [x] G.1 runtime adapter foundation 通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier check，以及全仓 151 个 Jest suite / 2794 个测试；既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2 Review startup coordinator 的 12 个定向测试通过：pending/rejected 收敛、重启幂等、accepted 零写入分类、Review revision 前进/持续 churn、并发 terminal decision 导致旧 Queue 操作失败后的 revision retry、稳定多记录排序、双 runtime pending/rejected 竞争、commit-then-throw 后置状态证明及 source identity 冲突；TypeScript `noEmit` 与变更文件 ESLint 通过。
- [x] G.2a 集成后全仓回归通过：152 个 Jest suite / 2806 个测试、TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier check 与 `git diff --check`；既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2b durable Manifest plan/intent 与 atomic ledger 通过 13 个定向 Jest suite / 273 个测试；最终全仓回归 154 个 Jest suite / 2871 个测试全部通过，并通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier 与 `git diff --check`。既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2c Queue v4 与 atomic apply-authority reproof 本轮通过 9 个定向 Jest suite / 234 个测试，以及全仓 154 个 Jest suite / 2894 个测试；覆盖 target observation 前 authority preflight、prepared/applying/startup 全 Manifest reservation、unfinished-journal 写前授权、Queue marker↔ledger、latest-rerun/source-ABA 与 existing-successor 回归，并通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier 与 `git diff --check`。既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2d no-journal recovery 与 Queue v5 本轮通过 Runtime 71 个测试、Queue/Core 聚焦 101 个测试及真实 compile→review→startup recovery→explicit continue→Wiki/Manifest/ledger/Queue ack 集成闭环；最终全仓 155 个 Jest suite / 2921 个测试全部通过，并通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier 与 `git diff --check`。覆盖 accepted-not-started/active/blocked/finalizing/committed/abandoned 分类、stale Manifest、commit-then-throw、prepared publication 竞争、三代 rerun 保留与 exact abandonment replay；既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2e layout-ready startup gate 通过 Gate/Runtime/no-journal/真实 pipeline 聚焦 4 个 suite / 108 个测试，以及全仓 156 个 Jest suite / 2947 个测试；覆盖固定恢复顺序、同 transaction sticky conflict 归一、Runtime/Queue revision 单调性、同 revision Queue 内容一致性、accepted action↔classification 精确集合、atomic Vault-global transaction、no-journal/accepted-not-started attention、active/finalizing/Queue-only blocker、Review revision churn、真实 accepted-before-apply 字节零写入与无自动 action，并通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier 与 `git diff --check`。既有 keychain/解密预期 console 输出不影响结果。
- [x] G.2f atomic conditional startup release 通过 Release/Runtime 聚焦 2 个 suite / 106 个测试、Queue/真实 pipeline 聚焦 2 个 suite / 55 个测试，以及全仓 157 个 Jest suite / 2980 个测试；覆盖 exact release、absent/running byte-preserving no-op、Runtime/Review/Queue stale token、user/rate-limit pause保真、generic resume/pause/CAS bypass、running/startup 下显式 exact accepted start 与 anchor 防擦除、三类恢复门单调强化、同门 claim/job/marker 保留、历史 ledger/伪造 abandonment 替换、fixed finalization metadata 与两步 CAS 降级防护、startup apply 期间真实 allocator-backed watcher divergent rerun、high-watermark 回退拒绝、较新同内容收敛与未分配首写拒绝、active transaction、claim/failed apply/commit marker、accepted-not-started blocker、abandoned/committed terminal、跨 Bundle recovery quarantine、双实例竞争、commit-then-throw 后强制重跑 Gate 与真实 stale→re-gate→release 闭环，并通过 TypeScript `noEmit`、全仓 ESLint、变更文件 Prettier 与 `git diff --check`。既有 keychain/解密预期 console 输出不影响结果。
- [x] G.1 自动化回归覆盖完整文件排他发布、并发初始化、realpath/symlink containment、共享 envelope 无丢失并发更新、跨 runtime revision 续号、watcher-capture 乱序拒绝、全 slot corruption fail-closed、create/update CAS 竞争与 delete replay 分类。
- [ ] 首批功能实现后，在 Windows Obsidian 测试 Vault 中完成 Golden Flow 实机验收。

## Source Documents

- [`designdocs/PERSONAL_KNOWLEDGE_OS_PRD.md`](./designdocs/PERSONAL_KNOWLEDGE_OS_PRD.md)：产品目标、Golden Flow、需求和验收标准。
- [`designdocs/PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./designdocs/PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md)：技术架构、数据契约、可靠性与路线图。
- [`designdocs/OPEN_SOURCE_REUSE_PLAN.md`](./designdocs/OPEN_SOURCE_REUSE_PLAN.md)：外部代码 Copy / Port / Reference 台账。
- [`designdocs/GITHUB_PERSONAL_KNOWLEDGE_LANDSCAPE.md`](./designdocs/GITHUB_PERSONAL_KNOWLEDGE_LANDSCAPE.md)：开源项目调研快照。
- [`designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md`](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md)：Windows-only commit 顺序、依赖与退出门槛。
- [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)：人工复制/派生外部材料的归属台账与发布门禁。
