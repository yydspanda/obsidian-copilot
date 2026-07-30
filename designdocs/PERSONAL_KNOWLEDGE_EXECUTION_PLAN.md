# Personal Knowledge OS Execution Plan / Windows 执行计划

Status: Active

Last updated: 2026-07-30

Target platform: Obsidian Desktop on Windows

本计划把 [`PERSONAL_KNOWLEDGE_OS_PRD.md`](./PERSONAL_KNOWLEDGE_OS_PRD.md) 的 Golden Flow 转换为可连续提交、逐步验收的工程路线。任务状态以 [`../TODO.md`](../TODO.md) 为准，架构契约以 [`PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md) 为准。

Current checkpoint: Commit A/B/C/D/E/F/G foundations and the G.1 runtime adapter foundation are implemented; G.2a adds the review-only startup coordinator, G.2b adds durable Manifest plan/intent plus the exact atomic Manifest/apply-ledger adapter, G.2c adds end-to-end durable apply-authority proofs, G.2d upgrades Queue to v5 with explicit no-journal recovery, G.2e adds the pure layout-ready startup gate, and G.2f adds shared-envelope conditional startup release. Review v2 derives final intent from the immutable compiler plan, transaction journal v3 retains that intent and full source identity, and runtime envelope v2 re-proves Queue/Review/high-watermark/allocator plus Manifest read-set/source-order authority before the first target observation, again inside prepared publication, before entering applying, on unfinished startup recovery, across every shared-envelope mutation while the transaction is active, and when publishing Manifest success with its ledger. An accepted claim without a journal is classified from one atomic snapshot and requires explicit continue or abandon; continue repeats full authority proof, while abandon atomically proves that no journal, Queue commit marker, or source-input ledger exists before writing a Queue v5 tombstone. The startup gate now orders Queue recovery, journal/commit convergence, Review hand-off convergence, and a single-envelope batch classification guarded by the exact Review revision. It never resumes the Queue or performs no-journal decisions, and its `observed_clear` result is not claim authority. Conditional release consumes only that exact Runtime/Review/Queue observation and repeats all write-recovery plus accepted-terminal proofs in the same mutation that changes the Queue to running; generic Resume cannot clear or launder `startup_recovery`. Pending Queue commit markers remain bound to their ledger. Generic Manifest storage cannot bypass the success path, unsafe legacy or stale-Manifest authority fails closed before new Wiki file access, and shared-page hashes advance for every co-owner. The gate/release pair is still not connected to plugin startup or Knowledge Studio because a production Bundle configuration source, complete recovery validators/file adapter composition, a stable Studio port, startup barrier, and recovery UI are pending. Remaining semantic dependencies and the Windows acceptance gate also remain pending. Commit H follows only after G.2 safely enables the runtime workflow. Verification details are recorded in [`../TODO.md`](../TODO.md). Repository-wide Prettier still has only the pre-existing, untouched `src/LLMProviders/chatModelManager.ts` baseline. No source code from the audited external candidates has been copied; attribution status is recorded in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

---

## 1. Outcome and Strategy

首个可用结果必须让一个真实来源完成完整复利闭环：

```text
Windows Explorer / Vault source
→ Add to Knowledge
→ durable queue
→ two-stage compile
→ multi-file ChangeSet review
→ recoverable write
→ grounded query + citation jump
→ unchanged source skip
```

执行策略：

1. 以 vertical slice 验收，不把 parser、queue、UI 分别做成永远无法使用的半成品。
2. 纯知识契约先行，Obsidian、Windows、模型和 UI 通过 adapter 接入。
3. 先保证来源、幂等、删除、引用和恢复语义，再增加自动化程度。
4. 复用当前 Search v3、ApplyView、Chat 文件拖入和进度 UI，不建立重复基础设施。
5. 外部代码先进入归属台账，再按 Copy / Port / Reference 实施。

## 2. Roadmap: Now / Next / Later

| Stage | Initiative                     | Desired outcome                          | Exit metric                             | Effort |
| ----- | ------------------------------ | ---------------------------------------- | --------------------------------------- | ------ |
| Now   | Slice 1A — Knowledge contracts | 所有后续模块共享稳定、可验证的数据语义   | 契约和 Windows fixtures 全部通过        | S      |
| Now   | Slice 1B — Queue and recovery  | 任务可见、可暂停、可恢复，不重复调用模型 | 重启/失败/重复来源状态测试通过          | M      |
| Now   | Slice 1C — Golden Flow         | 一个真实来源成为可引用、可复用的 Wiki    | 端到端 Windows fixture 和实机流程通过   | L      |
| Next  | Daily Knowledge Studio         | 用户每天可管理来源、审核、活动和健康状态 | 完成一周真实 Vault 使用且无人工修库     | L      |
| Next  | Retrieval and maintenance      | 新知识能稳定找回，陈旧和冲突可处理       | citation、reuse、lint 基准达到 PRD 门槛 | M      |
| Later | Graph exploration              | 图谱改善检索和知识缺口发现，而非只做展示 | 图增强任务集优于无图基线                | L      |
| Later | Temporal/Graphiti projection   | 历史状态和多跳关系确实需要外部投影       | 达到 PRD 中 Graphiti 接入门槛           | L      |

`Now` 是当前提交序列；`Next` 只有在 Golden Flow 被真实使用后才锁定细节；`Later` 是带门槛的探索，不是承诺。

## 3. NOW — Commit-by-commit Execution

### Commit A — Execution Baseline ✅

Scope:

- 固定本执行计划与 Windows-only 验收矩阵。
- 建立 `THIRD_PARTY_NOTICES.md` 与许可证存放规则。
- 建立 `src/knowledge/` 的依赖方向和公共导出边界。

Exit criteria:

- 外部来源、commit、许可证和本地目标可追踪。
- 尚未复制的项目明确标记为 audited/reference，不错误声明已包含其代码。
- 新模块不依赖 Settings singleton、Vault global、Provider Manager 或 React。

### Commit B — Contracts and Validation ✅

Target files:

```text
src/knowledge/
├── manifest/
│   ├── freshness.ts
│   └── freshness.test.ts
├── model/
│   ├── types.ts
│   ├── schemas.ts
│   ├── validation.ts
│   ├── fingerprint.ts
│   ├── schemas.test.ts
│   ├── validation.test.ts
│   └── fingerprint.test.ts
├── paths/
│   ├── vaultPath.ts
│   └── vaultPath.test.ts
└── index.ts
```

Scope:

- `KnowledgeBundleConfig`
- `SourceManifestEntry`
- `SourceLocator` / `ClaimCitation`
- `KnowledgeIngestJob`
- discriminated `KnowledgeFileChange`
- `KnowledgeChangeSet`
- Vault-relative path、locator、ChangeSet 和 Bundle deterministic validation
- exact source byte hash、binary/PDF hash 与 pipeline fingerprint

Exit criteria:

- create/update/delete 无歧义；update/delete 强制 before hash。
- Markdown line、heading、PDF page 和 quote locator 的必填字段由类型与 validator 共同保证。
- Pipeline fingerprint 对字段顺序稳定，对 schema/parser/compiler/model/output 变化敏感。
- 无 Obsidian、Node filesystem、模型或 UI import。

### Commit C — Source Manifest and Repository Port ✅

Target files:

```text
src/knowledge/manifest/
├── SourceManifestRepository.ts
├── SourceManifestStorage.ts
└── *.test.ts
```

Scope:

- 版本化 manifest schema 与宽容读取。
- output existence、source hash、pipeline fingerprint 和 stale 判断。
- 通过 storage port 注入读写；Vault adapter 后置。
- 保留未知扩展字段，拒绝不兼容 major schema version。

Exit criteria:

- 相同 source + fingerprint + 完整输出返回 `up_to_date`。
- 输出缺失、fingerprint 变化或 source hash 变化返回明确 stale reason。
- 失败运行不覆盖 last successful state。

### Commit D — Persistent Queue Core ✅

Target files:

```text
src/knowledge/ingest/queue/
├── IngestQueue.ts
├── QueueStorage.ts
├── RetryPolicy.ts
└── *.test.ts
```

Scope:

- pending/processing/paused/review/failed/completed/cancelled 状态机。
- 同一 source 去重；processing 时变化只安排一次 rerun；claim 外的 durable source high-watermark 拒绝乱序到达的旧观察。
- `AbortController`、指数退避、jitter、最大重试和 provider 限流暂停。
- 非 applying 的 processing 在启动恢复时回到 pending，backlog 默认等待用户操作。
- 每次执行使用 attempt/startedAt claim ownership；旧 attempt 的迟到结果只返回 stale。
- 来源新旧由 adapter 分配、跨重启持久化的 per-source `inputRevision` 判定，Queue 另行持久 revision/hash/pipeline high-watermark，不依赖 Windows 墙上时钟。
- Queue snapshot 采用 strict、显式版本化 schema；持久结构扩展必须通过版本升级和迁移完成。
- applying 在 Commit E 的事务日志可用前 fail closed，并保持不可绕过的 recovery-required gate。

Exit criteria:

- 任一状态迁移均有测试；非法迁移 fail closed。
- 项目切换和重启不丢 job、不产生重复 active job；中断 attempt 采用 at-least-once，可能重放模型调用。
- 取消不会删除已经存在或被多个来源共享的页面。

### Commit E — Recoverable ChangeSet Application ✅

Target files:

```text
src/knowledge/changeset/
├── ApplyCommitCoordinator.ts
├── ChangeSetValidator.ts
├── ChangeSetTransaction.ts
├── TransactionStorage.ts
└── *.test.ts
```

Scope:

- 路径越界、重复/重叠目标、before-hash 冲突和 citation/link/OKF validation。
- 完整 pre-state、accepted ChangeSet 和 Bundle boundary 进入 Vault-global 单活动 journal。
- Windows deterministic write order、单文件原子 compare-and-swap、写后复验、commit marker 和幂等 startup roll-forward。
- divergent file state 进入 sticky `recovery_required`，不自动 rollback、不覆盖并发用户编辑。
- Transaction journal v3 将 source id、source hash、pipeline fingerprint、input revision 与 job attempt/start 绑定为完整 claim，并持久化回链 Review plan 的最终 Manifest intent；ChangeSet 必须引用该 source。
- applying executor 必须返回 `completed + exact commitReceipt`；`IngestQueue.runNext` 只对外转换为 `commit_ready`，不能直接把 durable Queue job 标为 completed。审核接受先进入新的 durable applying claim，同样走 transaction/coordinator。
- Queue snapshot v4 以 exact `applyClaim`、pending review anchor、review rejection tombstone 和 `commit_pending_ack` marker 连接 Review Store、active/recovered apply 与 committed journal；审核路径绑定 proposal/accepted/Manifest-intent digest、terminal revision/time 和完整 job claim。v1/v2 无法证明的 review/apply identity，以及 v3 缺失 intent digest 的在途审核，以 `legacy_unverified` 明确 fail closed。
- 固定 `queue claim verify → atomic authority reproof+manifest+ledger → queue marker → journal ack → queue release` 的协议；最终 callback 已从同一 envelope 交叉验证 exact Queue claim、accepted Review payload/intent 及 allocator/source high-watermark，关闭独立只读核验后的竞争窗口。
- 直接 apply 在任何 target observation 前先通过 authority port 复证 Queue/Review/high-watermark/allocator 与 Manifest read-set/source ordering；prepared journal 发布在同一 atomic transform 内重复证明。prepared → applying、启动读取 prepared/applying journal 和活动事务期间每次 shared-envelope mutation 都保留该完整 reservation；旧 v3 审核或 stale Manifest 事务在任何新文件 observation/mutation 前停止。Queue commit marker 还必须在 runtime parse 时精确匹配 success ledger，retained rerun 必须等于 source high-watermark。
- 明确 Obsidian Vault API 不提供真正跨文件原子性。

Exit criteria:

- 崩溃注入覆盖每个写入阶段。
- 纯事务与协调器层已证明：页面 commit marker 之前不会推进任务或 Manifest 成功；已有 journal、ledger 或 Queue marker 持久证据的断点可按 exact identity 重试。
- Raw Source target 永远被拒绝，除非未来出现独立显式动作契约。

Runtime integration boundary before real Vault writes:

- Windows Desktop platform guard、非支持平台提示和 `manifest.json` 保持非 desktop-only 的代码/文档决定已完成；真实 Windows test Vault 验收仍是启用门槛。
- Windows/Vault `TransactionStorage`、`QueueStorage` 与 create/update `KnowledgeFileStore.compareAndSwap` adapter 代码层已完成；仍须实机验证，compare-and-delete 也必须原子，不能用普通 read + delete 冒充。
- [x] 实现 `ApplyCommitManifestPort` 的 exact-idempotency adapter/ledger；按 transaction id/revision、ChangeSet/intent/journal/receipt digest 防重，同 key 不同 payload fail closed，Manifest success 与 ledger 在一个 transform 中发布。
- 已 journal 化并复证 Manifest target authorization（revision/digest、ownership/sourceRefs、last-generated hash）；仍需补 schema、非 target link 与 source artifact 的 semantic read-set，并在 safe compare-delete 完成前保持 compiler delete unavailable。
- 在接入真实写盘前决定 mutation intent：当前 content-addressed at-least-once 恢复存在“CAS 后、progress 前崩溃，再被用户恢复为精确 before”这一 ABA 取舍。
- 为 `recovery_required` 增加明确的重新校验、继续、回滚或放弃操作；在此之前冲突只保持 fail closed。
- 在重新 claim startup backlog 前扫描 durable Review Store，并用 `reconcilePendingReview` 收敛“proposal 已落盘、Queue hand-off 未落盘”的旧 attempt。
- [x] 为 accepted apply claim 已落盘但 journal 尚未创建的 crash window 增加 no-journal classify/continue/abandon Core；没有写入 intent 证明时不得自动重试，生产 startup/Studio 接线仍待完成。
- terminal archive 必须同时协调 Queue jobs、pending/terminal review identity、Review Store 与 source high-watermark，或保留等价 tombstone。

### Commit F — Provider-neutral Compile Port ✅

Target files:

```text
src/knowledge/compiler/
├── KnowledgeCompiler.ts
├── CompilerModelPort.ts
├── analysisSchema.ts
├── generationSchema.ts
└── *.test.ts
```

Scope:

- 阶段一输出概念、实体、主张、关系、引用和目标页面集合。
- 阶段一只可读取 caller-owned target catalog 中的既有页面；catalog 外路径保持 create-only，Windows existence probe 发现占用即 fail closed。
- delete 只允许 manifest 标记为 generated、当前 source 独占且 bytes 匹配 last-generated hash 的显式授权目标。
- 阶段二只接收 runtime 绑定后的 create/update 最小 DTO，并只能用 opaque target id 返回 write/unchanged；delete 内容和授权元数据不进入生成模型。
- 模型输出经过结构校验、路径校验和 citation normalization。
- claim 必须至少有一条 trusted evidence 的 material-valid `supports`；引用 identity、locator 和 hash 不由模型填写。
- OKF、link 与 citation candidate validator 是构造 proposed ChangeSet 的必需端口；apply-time 仍独立复验。
- Provider 和模型配置通过 port 注入；不复制外部 Provider Runtime。
- Compiler source identity 包含单调 `inputRevision`，因此来源内容 A→B→A 仍生成不同 ChangeSet/review instance，不复用旧审核。

Constraint:

- 本提交先实现接口、结构化 schema 和 deterministic orchestration。任何新增或修改 AI prompt 内容遵守仓库规则，只有在用户明确授权后单独提交。

Exit criteria:

- 模型不能绕过 runtime target binding 修改既有未授权路径；新路径只有在 Windows resolver 证明缺失后才能进入 create proposal。
- 无效或不完整输出进入 review/failure，不直接写盘。
- 固定 fake model fixture 可以产生稳定 ChangeSet。

### Commit G — Multi-file Review and Activity UI ← Core/UI implemented; Windows interaction validation pending Commit I

Scope:

- 从 ApplyView 抽取无写入能力的 diff renderer；legacy 单文件执行路径保持隔离。
- 增加 strict durable Review Store、opaque review command 与选择后重新 hash/validation。
- Queue 只有在收到同 Bundle、同 exact job claim 的 durable pending Review Store receipt 后才能进入 `awaiting_review`；accepted/rejected receipt 必须把 record revision 从 0 精确推进到 1。
- 同一 accepted receipt 在 active applying claim 内重放不增加 Queue revision/event；proposal、digest、revision、time、Bundle 或 job claim 冲突均 fail closed。
- `awaiting_review` 不允许通用 Cancel；Reject 必须先 durable persist，再原子移除 pending anchor、保留 rejection tombstone 并提升 latest rerun。
- 提供 `reconcilePendingReview` 关闭 Review Store 已写而 Queue hand-off 未写的崩溃窗口；旧版 `legacy_unverified` anchor 只能由精确 pending record 升级。
- 复用 ProcessingStatus/IndexingProgressCard 视觉语言显示任务阶段、finalizing 与 recovery gate。
- 增加 Windows-only Knowledge Studio 最小 ItemView：Activity、ChangeSet Review、完成摘要；真实 Vault adapter 接入前 fail closed。
- 遵守 popout-window 的 `.doc/.win` 和 `onWindowMigrated` 规则。

Exit criteria:

- 用户能逐文件、逐块或批量接受/拒绝；delete 有单独危险语义且当前不可接受。
- UI 不展示任务成功，直到 commit marker 完成。
- Windows 触控板、键盘和不同窗口均可完成审核。

### Commit G.1 — Windows Runtime Adapter Foundation ← Code implemented; product gate remains closed

Scope:

- 用插件私有 `knowledge-runtime-v1.json` strict envelope 承载 Queue、Review、Manifest、Vault-global active transaction 与 per-source watcher-capture `inputRevision`。
- 每个 facade 的 revision/token compare 和完整 snapshot 替换在同一 `DataAdapter.process` transform 内完成；任何 slot 损坏会阻止整个 envelope 改写。
- source watcher 的契约固定为“先分配 revision，再做异步 read/parse”，Queue high-watermark 拒绝较晚完成的旧读取。
- 首次 runtime 文件经完整临时文件、handle flush 和排他 hard-link 发布；parent realpath 必须留在真实 Vault 根内。
- `KnowledgeFileStore` capability 绑定具体 store；Windows store 只启用排他 create 与 `Vault.process` update，delete fail closed，但能分类 already-missing replay 和第三状态 conflict。
- Windows plugin load 初始化 singleton state foundation，但继续注入 `UnavailableKnowledgeStudioPort`；不实例化真实 ingest/compiler/apply/query coordinator。

Verified in automated code-level tests:

- runtime reconstruction 后 revision 继续递增，Bundle/source namespace 隔离，并发分配不重复。
- 较新事件先完成、较旧读取后完成时，Queue 保留较高 revision/hash。
- 不同 subsystem 并发更新不丢失；queue/review/manifest/transaction/duplicate/unknown-version corruption 均阻止 unrelated write 且不改 bytes。
- 首次发布并发不覆盖、missing parent 与 symlink escape fail closed；Wiki create/update race、malformed payload、external error 与 delete replay 分类被覆盖。

Remaining exit gates:

- 在真实 Windows Obsidian test Vault 验证 `DataAdapter.process`/`Vault.process` 的双实例序列化、callback/返回值、插件重载、外部编辑、NTFS/OneDrive/junction 和 crash/power-loss 行为；自动化测试不能替代该结论。
- startup Review reconciliation、Manifest target read-set、exact `ApplyCommitManifestPort` ledger、commit-boundary Queue/Review/high-watermark 原子复证与 no-journal classify/continue/abandon 已完成 Core；仍需 schema/link/source-artifact read-set、生产 startup/Studio recovery wiring、history compaction/size threshold 和 safe compare-and-delete，或继续保持 delete unavailable。
- 当前单 envelope 有 O(size) 写放大和共享故障域；长期使用前必须通过 size/latency benchmark 决定 archive 与分片。
- 完成这些门槛前，不把基础代码称为可用 Golden Flow 或 production-ready durable adapter。

### Commit G.2 — Runtime Coordination and Recovery ← In progress

Scope:

- [x] 实现 exact `ApplyCommitManifestPort` ledger；仍需把 queue/review/manifest/transaction facades、file store、compiler 与 startup coordinator 组装成 plugin singleton workflow。
- 已完成独立的 Review startup coordinator Core：pending record 恢复 Queue anchor；rejected record 在需要时恢复 predecessor 后提交 exact rejection；accepted record 只作为后续 runtime classification identity，启动过程不会自动 apply。协调器用有界 Review revision 重读避免漏掉并发 terminal decision，并将稳定 observed revision 交给最终 startup gate 再复证。
- [x] 补齐 durable Manifest plan/intent：包含完整 post-compile pages、显式 ownership/authorization、Manifest revision/digest read-set 与 source hash/pipeline/`inputRevision`；Review filter/rewrite 只从 immutable plan 投影，journal 不再从 changed targets 猜完整 `lastSuccessful.generatedPages`。
- 启动时先验证 runtime envelope，扫描 active journal、apply claim、commit marker 与 Review Store，再执行 pending-review reconciliation；完成前不能 claim 新任务。
- [x] 关闭 accepted apply claim 已落盘但 journal 尚未创建的 Core 窗口：从同一 envelope 分类 accepted-not-started/active/blocked/finalizing/committed/abandoned，显式 continue 前重证 Manifest authority，显式 abandon 前原子证明不存在 journal/commit marker/source-input ledger 并写 Queue v5 tombstone；生产 startup/Studio 接线另行完成。
- [x] 组装纯 TypeScript startup gate：Queue startup recovery → active journal/commit marker 收敛 → Review pending/rejected 收敛 → exact Review revision 下的 Runtime 单-envelope Queue + Vault-global transaction + accepted batch classification；首次 sticky file conflict 只接受同 transaction blocked 归一，Runtime/Queue revision 回退和同 Queue revision 内容分叉均 fail closed，accepted actions/classifications 以共享 recovery id 做无重复一一对应校验，持续 Review churn 有界 fail closed。Gate 不调用 no-journal action、模型或 Queue resume。
- [x] 实现 shared-envelope conditional release：Coordinator 只把 clear Gate 的 Runtime/Review/Queue revision 送回 Runtime；Runtime 在一次原子 transform 中重证 Vault-global transaction、所有 Bundle 的写恢复证据、当前 marker/claim/applying 状态与 accepted terminal classifications，成功只改变 exact startup control 和 Queue/Runtime revision。普通 `resume()`/`pause()` 与跨 `recovery_required`/`commit_pending_ack` 的两步 generic CAS 都不能清除或洗白单调恢复门；同门必须保留 current claim/job/marker，running/startup 中 accepted pending anchor 只有 exact accepted begin 才能消费，跨门必须匹配 current Review/claim/job/active committed journal 的 exact projection，历史 ledger 与 generic fabricated abandonment 都不构成替换当前恢复证据的 authority；watcher high-watermark 不得删除、回退、同 revision 改写或超过 allocator，并覆盖 divergent rerun、较新同内容收敛和未分配首写，marker finalization metadata 也必须精确；无 durable receipt 的 commit-then-throw 必须重跑 Gate。
- [ ] 生产 source watcher 接线前增加 revision→source hash/pipeline 的专用 durable observation hand-off；当前 scalar allocator 负责顺序/上界，不作为任意低层调用方提交 payload 的真实性证明。
- 已 journal 化并复证 manifest ownership/last-generated hash target read-set；继续补 schema、non-target links 与 source artifact read-set。delete 保持 unavailable，不能为了过门槛降级为 read-then-delete。
- [x] 在 Manifest+ledger atomic callback 内再次复证 exact Queue apply claim、Review identity 与 allocator/source high-watermark；exact ledger replay 仍最先返回，更新观察由 retained rerun 或 promoted successor 证明。
- [x] 在直接 apply 的 target observation 前、prepared 发布、prepared → applying、unfinished startup recovery 与活动事务每次 shared-envelope mutation 中复证或保留完整 durable authority + Manifest reservation；Queue v3 缺失 intent digest 或 Manifest read-set 漂移时零 Wiki 文件访问，并在启动时交叉验证 Queue commit marker 与 exact ledger。
- 为接近 safe-integer 上限的整条 transaction/manifest/queue/ack 序列预留 outer-envelope revision 容量。
- 定义 `no_changes` 的 durable source-success 与 Manifest revision 语义；在有明确账本前不能把空 ChangeSet 当作成功摄入。
- 为 `recovery_required` 提供显式 revalidate/continue/rollback/abandon core 与 UI，所有 divergent file state 继续 fail closed。
- 定义 envelope size/latency guard、协调 terminal archive/compaction；超过门槛时暂停新 ingest，而不是让 Obsidian UI 无界阻塞。
- 把 file/projection adapter 的 malformed success、filesystem/runtime failure 映射为受控 infrastructure error，用户提示不包含内容、路径外数据或 credential。
- 在独立 Windows Obsidian Vault 验证 process serialization、plugin reload、external edit、NTFS/OneDrive/junction 和 crash recovery；保留可重复验收脚本与结果。

Exit criteria:

- Windows Studio 从 `adapter_unavailable` 切到 ready 前，所有 startup/recovery gate 均有持久证据和测试；任一缺失仍 unavailable。
- 生产 watcher 的一次观察必须把预先分配的 revision 与随后读取的 source hash/pipeline 通过专用 hand-off 绑定后才能 enqueue；不能只信任 generic Queue snapshot 中自报的 payload。
- `observed_clear` 只用于恢复 UI 的乐观展示；conditional release Core 已在 shared envelope 内按 Runtime/Review/Queue revision、无 active journal/marker/apply claim/failed applying 与 accepted terminal evidence原子复证。生产接线仍必须让每个配置 Bundle 的 worker 等待该结果，不能使用 read-check 后普通 Queue resume，也不能把 empty/running 或保留的 user/rate-limit pause 当作已执行启动编排。
- `Markdown/PDF → queue → compile → review → create/update → manifest/queue/journal finalize` 可在测试 Vault 重启后收敛，且 delete 仍可安全保持禁用。
- 没有 journal/ledger/read-set 证据的状态只能进入人工恢复，不会自动调用模型或写 Wiki。

### Commit H — Chat Entry, Query, and Citation Jump

Scope:

- Chat 文件拖入增加 `Use in this chat` / `Add to Knowledge`。
- Wiki/index 渐进发现接入当前 Search v3。
- 回答使用 `ClaimCitation`，citation chip 能打开并定位 Markdown heading/line 或 PDF page。
- 增加 `Save to Wiki`，再次通过 ChangeSet review 写回。

Exit criteria:

- 一次使用的附件不会意外进入长期知识。
- 加入知识库的来源立即出现 job card。
- 模型没有实际读取的 artifact 不能成为 citation。

### Commit I — Windows End-to-end Validation

Scope:

- Markdown、中文文件名、CRLF、PDF、相同来源和已变化来源 fixture。
- 盘符/反斜杠、大小写碰撞、保留设备名、尾随点/空格、长路径和文件占用。
- 插件重启、模型失败、before-hash 冲突和事务恢复。
- 在独立 Windows Obsidian test Vault 完成实机验收。

Exit criteria:

- PRD First Vertical Slice 的 acceptance criteria 全部通过。
- `.env.test` 和 API key 不进入提交、日志、fixture 或错误消息。
- 记录首个 baseline：完成时间、模型调用数、citation navigation、accept/edit/reject。

## 4. Dependency Order

```mermaid
flowchart LR
    A[Contracts] --> B[Manifest]
    A --> C[Queue]
    A --> D[ChangeSet Transaction]
    B --> F[Compiler]
    D --> F
    C --> G[Activity UI]
    F --> G
    G --> G1[Runtime Foundation]
    G1 --> G2[Runtime Coordination + Recovery]
    G2 --> H[Chat + Query]
    H --> I[Windows E2E]
```

可以并行的只有：

- Manifest 与 Queue core；
- UI shell 与 fake compiler fixture；
- Windows fixture 准备与纯模型契约测试。

不能提前的工作：

- 没有 ChangeSet transaction 前，不接真实模型写盘。
- 没有 citation locator 前，不做“带来源回答”演示。
- 没有真实检索收益基线前，不建设完整 Sigma 图谱。
- 没有历史查询压力前，不部署 Graphiti。

## 5. Quality Gates

每个提交至少通过：

- 相关 Jest tests。
- TypeScript type check。
- Prettier format check。
- ESLint。
- `git diff --check`。
- 不包含密钥和无关用户文件。

Golden Flow 额外门槛：

- Raw Source 非授权写入为 0。
- Project/Bundle scope leakage 为 0。
- 无效 citation 为 0。
- 相同 source + fingerprint 的模型调用为 0。
- 恢复后错误 success marker 为 0。

## 6. Decision and Escalation Rules

- 小型纯逻辑模块可以直接 Copy，但 attribution、license 和 tests 必须同提交进入。
- 外部模块需要自己的 Runtime、数据库或状态系统时，默认 Port 契约，不整体嵌入。
- 新依赖必须回答：当前模块为何不能实现、bundle/启动/升级成本、Windows Runtime 兼容性和卸载恢复方式。
- 任何会修改 AI prompt、启用真实外部副作用、改变整个插件平台声明或引入常驻服务的步骤，单独提交并明确说明。
- 真实实现与本文冲突时，先更新决策和 TODO，再继续编码，不让文档长期失真。
