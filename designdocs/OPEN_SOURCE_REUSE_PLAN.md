# Open Source Reuse Plan / 开源实现复用台账

Status: Code-audited baseline

Snapshot date: 2026-07-16

本文把外部项目的优秀实现拆成 `Copy`、`Port` 和 `Reference` 三类，指导面向 Windows Obsidian Desktop 的个人知识操作系统二次开发。产品目标见 [`PERSONAL_KNOWLEDGE_OS_PRD.md`](./PERSONAL_KNOWLEDGE_OS_PRD.md)，总体架构见 [`PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md)。

当前尚未把下列外部源码复制进本仓库。首次复制前必须同时提交第三方声明、来源注释和对应测试。

---

## 1. Reuse Policy

### 1.1 Three Levels

| 等级      | 含义                                                 | 实施要求                                                                        |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Copy      | 纯逻辑叶子模块可近乎原样复用                         | 锁定 commit 和原路径；保留版权/许可证；适配 import 和本项目类型；携带或重写测试 |
| Port      | 产品机制或算法优秀，但运行环境、状态或 UI 架构不兼容 | 保留行为契约，自行用 TypeScript、Vault API 和当前状态架构重写                   |
| Reference | 只借鉴流程、交互或边界                               | 不复制实现；在设计或代码注释中记录灵感来源即可                                  |

### 1.2 Non-negotiable Rules

1. 不整体 vendoring 另一个产品，也不引入它的桌面壳、Provider、搜索和状态系统来重复当前能力。
2. 当前只支持 Windows Obsidian Desktop。Node/Electron、Python、Rust、Docker 和 stdio MCP 可以作为候选能力，但必须证明改善体验，并通过 adapter 与核心知识契约隔离。
3. 外部模块先以当前项目接口包裹，纯逻辑不能直接读取全局 Settings、Vault、Provider 或 UI store。
4. 不复制已知缺陷。每个 Port 都先写当前项目的行为测试，再实现适配版本。
5. 直接复用代码时记录：仓库、commit、原文件、许可证、版权、修改内容和本地目标文件。
6. 当前仓库是 AGPL-3.0；这些已审计 commit 的相关代码许可证原则上与 AGPLv3 组合兼容，但每次复制仍须核对目标文件、依赖、素材、NOTICE 与 GPL/AGPL 条款，并保留版权、许可证和修改说明。本文不是法律意见。

## 2. Audited Source Snapshots

| 项目                                                                                                                                              | 审计 commit                                | 版本/状态                          | 许可证     | 总体采用方式                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- | ---------- | ----------------------------------------------------------------- |
| [`atomicstrata/llm-wiki-compiler`](https://github.com/atomicstrata/llm-wiki-compiler/tree/6963a7f8374282de5d4084a324be69b50f62a32d)               | `6963a7f8374282de5d4084a324be69b50f62a32d` | v1.1.0                             | MIT        | Copy 纯逻辑和测试；Port I/O/事务；不嵌入 SDK/CLI                  |
| [`nashsu/llm_wiki`](https://github.com/nashsu/llm_wiki/tree/38f4cb1dc8757059be618af215d14a5bebbf820d)                                             | `38f4cb1dc8757059be618af215d14a5bebbf820d` | v0.6.4                             | GPL-3.0    | Copy 少量叶子模块；Port UX、队列、图谱；不引入 Tauri/Rust/LanceDB |
| [`AgriciDaniel/claude-obsidian`](https://github.com/AgriciDaniel/claude-obsidian/tree/cb93ff6d82f9c35a08bf6010e7fac36dfddc827b)                   | `cb93ff6d82f9c35a08bf6010e7fac36dfddc827b` | main，v1.9.2 后 1 commit           | MIT        | Port 工作流和数据契约；不复制 Bash/Python Runtime                 |
| [`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/d44368c15e38e7c92481c5992e4f9b5b421a801d) | `d44368c15e38e7c92481c5992e4f9b5b421a801d` | OKF v0.1 Draft                     | Apache-2.0 | 实现规范；不引入 GCP reference tools                              |
| [`getzep/graphiti`](https://github.com/getzep/graphiti/tree/5e2be0faf7038a5b40e700d757b2c337e96b3a05)                                             | `5e2be0faf7038a5b40e700d757b2c337e96b3a05` | graphiti-core 0.29.2 后 28 commits | Apache-2.0 | Port 时态/provenance 契约；后期可选外部投影                       |

## 3. Reuse Current Project Before External Code

本项目已经有大量成熟能力。新增知识系统必须先复用这些模块，避免外部实现覆盖现有架构。

| 当前模块                                                               | 直接用途                                        | 新增边界                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/components/CopilotView.tsx`                                       | Obsidian ItemView、React root、popout migration | 新建 Knowledge Studio 时复用窗口迁移模式                                        |
| `src/components/Chat.tsx`、`src/hooks/useChatFileDrop.ts`              | Chat 与文件拖入                                 | 增加 `Use in this chat` / `Add to Knowledge` 分流                               |
| `src/components/project/processing-status.tsx`                         | 文件转换状态、重试和打开来源                    | 复用状态视觉，接入 Ingest Job stages                                            |
| `src/components/IndexingProgressCard.tsx`                              | 暂停、恢复、停止和错误进度                      | 复用交互，不另造 Activity 反馈模式                                              |
| `src/components/composer/ApplyView.tsx`                                | split diff、逐块接受/拒绝                       | 扩展为多文件 Knowledge ChangeSet review                                         |
| `src/tools/ComposerTools.ts`                                           | 写入预览与用户确认                              | 作为事务应用的用户权限入口，而非直接写盘核心                                    |
| `src/search/v3/SearchCore.ts`、`TieredLexicalRetriever.ts`             | 词法召回、过滤和 top-K                          | 复用 lexical core；不把 semantic/fusion 误归到该模块                            |
| `src/search/v3/MergedSemanticRetriever.ts`                             | 词法与语义结果融合                              | 在融合后增加 Wiki/index/图扩展；新代码不引用 deprecated `vectorStoreManager.ts` |
| `src/search/v3/scoring/GraphBoostCalculator.ts`                        | backlinks、co-citations、shared tags            | 作为图检索第一版基础                                                            |
| `src/core/MessageRepository.ts`、`ChatManager.ts`、`ContextManager.ts` | 消息、业务协调和上下文                          | 引用 Knowledge Artifact，不复制外部聊天状态                                     |
| `src/tools/ToolRegistry.ts`、`NoteTools.ts`、`SearchTools.ts`          | Agent 工具                                      | 暴露同一套 knowledge query/change-set 能力                                      |

## 4. `llm-wiki-compiler`: Best Pure Logic Source

### 4.1 Copy with Attribution

以下模块接近纯 TypeScript 叶子逻辑，可在保留 MIT 版权和测试后适配：

| 上游路径                                          | 价值                                        | 本地目标方向                            |
| ------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `src/trust/decision.ts`                           | 合成 allow/warn/stage/quarantine/deny       | `src/knowledge/review/trustDecision.ts` |
| `src/review/policy.ts`                            | 低置信、矛盾、schema/provenance review gate | `src/knowledge/review/reviewPolicy.ts`  |
| `src/schema/types.ts`                             | PageKind 与 SchemaConfig 契约               | `src/knowledge/schema/types.ts`         |
| `src/linter/types.ts`                             | 结构化 lint diagnostics                     | `src/knowledge/lint/types.ts`           |
| `src/import/types.ts`、`src/import/okf-limits.ts` | OKF import 数据形状与资源上限               | `src/knowledge/okf/importTypes.ts`      |
| `src/eval/types.ts`、`src/eval/delta.ts`          | 质量指标和回归差值                          | `src/knowledge/eval/`                   |
| `src/export/okf/citations.ts`                     | `# Citations` 渲染                          | 适配内部 claim-level Citation 类型      |

对应的 `trust-decision`、`review-policy`、`eval-delta` 测试应一并移植，避免只复制实现。

### 4.2 Port the Algorithm, Rewrite the Environment

| 上游路径                                                       | 保留                                           | 必须重写                                                |
| -------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `src/compiler/citation-normalize.ts`、`src/utils/markdown.ts`  | 行范围修复、删除不存在的引用行                 | 使用 Markdown AST/tokenizer，保护 fenced 与 inline code |
| `src/export/okf/*`、`src/import/okf-*`                         | 未知字段 round-trip、链接转换、导入默认 review | 当前项目 `yaml`、Vault adapter、WebCrypto、Unicode 路径 |
| `src/compiler/hasher.ts`、`source-state.ts`、freshness 模块    | hash、状态和 stale 判断                        | `crypto.subtle` 与平台无关路径接口                      |
| `src/utils/atomic-write.ts`、`lock.ts`、trust journal/recovery | pre-state journal → 写入 → commit → recovery   | 插件内 mutex、before-hash CAS、Vault transaction store  |
| `src/context/budget.ts`                                        | 确定性预算裁剪                                 | 映射 `PromptContextEnvelope` 与现有 token 预算          |
| `src/review/config.ts`                                         | normalize 与 fail-closed 配置                  | Settings/Vault 读取 adapter                             |

Obsidian Vault API 没有跨文件原子事务，所以 `Vault transaction store` 只能提供可恢复语义：pre-state journal、staging plan、before-hash CAS、确定性写入顺序、commit marker 和启动恢复。观察者可能短暂看到中间文件状态，任务与 manifest 不能在 commit marker 前报告成功。

### 4.3 Reference Only

- `src/compiler/index.ts`：只采用两阶段编译、稳定并发结果顺序和单次状态提交。
- `src/sdk/wiki.ts`：不直接依赖；它没有 filesystem/provider 注入、progress callback 或 streaming。
- CLI、stdio MCP、provider、viewer 和完整 lifecycle profile Runtime：与当前产品重复或依赖 Node。
- `utils/retrieval.ts` 的 BM25：不要复制，其 tokenizer 只接受 `[a-z0-9]+`，中文体验差；当前 Search v3 更合适。

### 4.4 Upstream Behavior to Fix

1. 嵌套目录的 `index.md` / `log.md` 应按 basename 识别为保留文件，上游只正确跳过根目录文件。
2. OKF 内部链接必须相对当前文档解析 `./` 和 `../`，不能只识别绝对 `/x.md`。
3. Markdown 链接和 wikilink 转换必须保护 inline code，不能只保护 fenced code。
4. Canonicalization 不能因看到 H1 `# Citations` 就删除作者后续全部内容；generated section 要有明确 marker。
5. `safeRefName` 要保留安全的 Unicode 字符并附稳定 hash，不能把中文路径全部破坏。
6. OKF root `index.md` 可有 `okf_version` frontmatter，其他 index/log 仍按保留文件处理。
7. OKF 文末引用列表只是导出下限，不能降低内部 claim/locator 级 grounding。

### 4.5 Why the Package Is Not Embedded

- 要求 Node `>=24`、ESM 和 Node 24 build target；当前插件为 CJS/ES2020，Obsidian Windows Runtime 也不能被假定为 Node 24。
- 核心依赖 `node:fs/path/crypto/async_hooks`、`process.env`、绝对路径、Chokidar 和 stdio。
- 上游使用 Zod 4、Ajv、js-yaml、较新 OpenAI SDK；当前项目已有 Zod 3、`yaml` 和自己的 Provider 层。
- PDF、JSDOM、Readability、Claude Agent SDK 等依赖会显著增加 bundle、启动时间和攻击面，并与当前 Provider/解析能力重复。

## 5. `nashsu/llm_wiki`: Best Product and UX Source

### 5.1 Copy Small Leaf Modules

| 上游路径                                                             | 采用方式       | 注意事项                                                 |
| -------------------------------------------------------------------- | -------------- | -------------------------------------------------------- |
| `src/components/graph/graph-layout-worker.ts`                        | Copy           | 适配类型/import；220+ 节点的 ForceAtlas2 worker 很有价值 |
| `src/lib/graph-search.ts`                                            | Copy           | 纯函数；适配本地 Node 类型                               |
| `src/lib/graph-visibility.ts`                                        | Copy           | 纯可见性逻辑                                             |
| `src/lib/ingest.ts:388-547` 的 `isSafeIngestPath`、`parseFileBlocks` | Copy function  | 只作为非结构化模型输出的 fallback                        |
| `src/lib/ingest-cache.ts:20-112`                                     | Copy algorithm | hash 后还验证所有输出存在；存储改为 Vault adapter        |

这些文件属于 GPL-3.0。复制时必须保留 `Copyright (C) 2024-2026 Yong Su`、GPL 许可证和原路径/commit。

### 5.2 Port High-value Mechanisms

#### Persistent Ingest Queue

来自 `src/lib/ingest-queue.ts`、tests 和 `activity-panel.tsx`：

- 同一来源 pending/failed 去重；processing 时再次变化只安排一次 rerun。
- 串行执行、重试、暂停、取消和 `AbortController`。
- 崩溃后 processing 恢复为 pending；旧 backlog 默认等待用户手动恢复。
- 项目切换前 flush；使用稳定 project UUID。
- 限流时自动暂停；Activity 显示进度、错误和恢复操作。

本地应拆成：

```text
IngestQueue
├── QueueStorage
├── IngestExecutor
├── EventSink
├── RetryPolicy
└── ChangeSetTransaction
```

必须修复：指数退避和 jitter、schema version、事件订阅、持久成功历史、不可吞写入错误；取消任务只能撤销当前 transaction，不能删除所有 touched files。

#### Source Identity and Ownership

来自 `source-identity.ts`、`sources-merge.ts`、`source-lifecycle.ts` 和 `frontmatter-panel.tsx`：

- 来源身份使用 source root 相对路径，不只使用 basename。
- 生成页记录 `sources`，更新共享页时合并 sources/tags/related。
- 来源重命名时迁移 ownership；删除时只删除完全由该来源拥有的页面。
- 来源卡片区分 local/external/missing，可点击并显示 related chips。

本地增加 claim/段落/页码级 locator，不能停在文件级 provenance。

#### Review Inbox

来自 `src/stores/review-store.ts`、`src/components/review/review-view.tsx` 和 sweep 模块：

- contradiction、duplicate、missing-page、confirm、suggestion。
- 稳定 ID，重复摄入不会丢 resolved 状态。
- 合并受影响页面、查询和选项；支持 pending/resolved 与批量操作。

上游 Review 是写入后问题队列，不是写入前审批。当前产品必须组合为：

```text
ChangeSet diff before write
→ recoverable transaction apply
→ long-lived Review Inbox after write
```

不得复制通过中英文关键词猜动作的实现；使用类型化 action enum。

#### Graph and Graph-enhanced Search

来自 `graph-relevance.ts`、`wiki-graph.ts`、Graph components 和 Rust search：

- 直接链接、共享来源、Adamic-Adar 和类型亲和四信号相关性。
- Louvain community、cohesion、搜索、过滤、邻居突出、预览和位置缓存。
- 知识缺口、桥接节点和 surprising connections。
- keyword/vector 用 RRF 后，从前 20 个 seed 做一跳 wikilink 扩展，为图结果动态保留 15%–30% 配额。
- 返回 `graph_related_to`，解释为什么某个页面被关联召回。

本地使用 Obsidian `metadataCache` 和 `resolvedLinks` 增量构图；不要复制接近 O(N²) 的逐文件全量扫描。

#### Knowledge Studio Layout

上游 `src/components/layout/app-layout.tsx` 等文件证明，全页三栏工作台比把知识管理塞进窄 Chat sidebar 更合理。当前项目应新增 Obsidian `KnowledgeStudioView`：左侧导航/活动、中央 Sources/Wiki/Graph/Lint/Review、可选右侧研究/预览。

实现时使用当前已有 `react-resizable-panels`，并遵守 `element.doc/.win` 和 `onWindowMigrated`；不复制全局 `document/window` 与手写 mousemove resize。

### 5.3 Reference Only

- `src/lib/ingest.ts` 整体：采用两阶段摄入，不采用 prompt、状态、I/O 和直接写盘耦合。
- Tauri Rust watcher：当前已有 Obsidian Vault events。
- Rust/LanceDB search：只采用 RRF 与图扩展算法。
- `auto-save.ts`：作为项目切换竞态测试案例，确保 flush/suspend 后旧空状态不会覆盖新项目。

## 6. `claude-obsidian`: Progressive Disclosure and Maintenance

### 6.1 Port Now

| 机制                          | 精确上游位置                                         | 当前项目实现                                                                                                         |
| ----------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `hot → index → domain → page` | `skills/wiki/SKILL.md`、`skills/wiki-query/SKILL.md` | 可重建导航缓存；ChangeSet 成功后统一刷新                                                                             |
| Quick / Standard / Deep 查询  | `skills/wiki-query/SKILL.md`                         | 映射到检索深度、图扩展和 source 回读预算                                                                             |
| Manifest                      | `skills/wiki-ingest/SKILL.md`、`.raw/.manifest.json` | 原始字节 SHA-256 + pipeline fingerprint + stable source identity + last successful/failed；运行状态由 Queue 单独持有 |
| Ingest / Query / Lint         | 三个对应 Skill                                       | 固化为 TS Runtime 和 UI；Skill 仅薄编排                                                                              |
| 矛盾不覆盖                    | ingest workflow                                      | 保留两种说法、来源与 supersedes/contradicts                                                                          |
| Git checkpoint                | `skills/wiki/references/git-setup.md`                | 可选完整 ChangeSet checkpoint，不默认操作用户 Git                                                                    |

确定性 lint 与模型建议必须分开：frontmatter、断链、hash、路径和 before-hash 属于代码；stale claim、缺页和潜在矛盾属于候选建议。

### 6.2 Do Not Copy

- `scripts/wiki-lock.sh`：依赖 Bash/flock/sha1sum/python，60 秒 lease 和无 owner-token release 都不安全。改用 per-path async mutex、lease token、CAS、固定排序和 transaction journal。
- `hooks/hooks.json`：每次写入自动 `git add`/commit 会污染用户 dirty worktree。Git checkpoint 只能 opt-in，并在完整 ChangeSet 成功后提交明确文件。
- Python/Ollama BM25 Runtime：当前已有 Search v3。
- 把 Skills 当可靠 Runtime：上游文档存在 multi-writer 与 single-writer 语义漂移；规则必须进入类型和测试。

## 7. Google OKF: Implement the Contract

直接实现 `okf/SPEC.md`，不引入 Google reference agent、BigQuery、Dataplex 或 `toolbox/mdcode`。

实现要求：

- concept ID 是相对路径去掉 `.md`；普通 concept 只强制非空 `type`。
- 未知 `type`、frontmatter 字段和 `x-*` 扩展必须宽容读取并 round-trip 保留。
- `index.md` 和 `log.md` 是保留文件；root index 可唯一声明 `okf_version: "0.1"`。
- broken links 不自动使 Bundle 不合规；但本产品 Health 可把它们报告为质量问题。
- 内部可读取 Obsidian wikilink；OKF 导出优先标准 Markdown link。
- OKF citation 是兼容输出，不替代内部 locator 和 claim-level provenance。

Google 仓库根目录和 OKF 目录为 Apache-2.0，但 `toolbox/mdcode/package.json` 自报 ISC，与根说明不一致，因此不复制该工具箱。

## 8. Graphiti: Temporal Semantics, Optional Projection

### 8.1 Port the Data Semantics Now

Graphiti 的核心价值是 episode provenance 和双时态：

| 语义          | 字段                       | 含义                               |
| ------------- | -------------------------- | ---------------------------------- |
| 来源/事件时间 | `valid_at`、`invalid_at`   | 事实何时在现实世界中开始/停止成立  |
| 系统认知时间  | `created_at`、`expired_at` | 系统何时知道该事实、何时判定它失效 |
| 证据来源      | `episodes[]`               | 每条事实回到哪些 raw episode       |

新矛盾不删除旧事实，而是结束旧事实的有效区间并保留来源。第一阶段在 Markdown/OKF 契约中预留：

```text
sourceId
observedAt / createdAt
validFrom / validTo
supersedes
contradicts
confidence
```

初始 ontology 保持很小：Person、Organization、Project、Document、Concept、Event、Preference、Decision，以及 relates/supports/contradicts/supersedes/works_on。

### 8.2 External Projection Gate

只有满足任一真实需求时才接 Graphiti：

- 经常询问“当时是什么、何时改变、系统何时知道”；
- 大量偏好、项目状态、人物关系互相覆盖；
- Wiki 链接无法回答重要多跳关系；
- 已积累至少数千条持续事件。

正式架构只能是：

```text
Markdown / Raw canonical
→ durable outbox + projection ledger
→ optional Graphiti service
```

Graphiti 必须可删、可重建，不参与核心写入事务。用户需显式授权同步哪些内容，因为 raw episode 会进入图数据库并发送给其 LLM/embedding provider。

### 8.3 Why It Is Not Phase 1

- 需要额外 Python 服务和 Neo4j/FalkorDB/Neptune，会显著增加 Windows 安装、升级、备份和故障恢复成本。
- DeepSeek structured output 和 embedding 质量需要独立评测。
- 官方 MCP queue 只有内存队列，没有持久任务、重试、job ID 或可靠状态。
- `episode_metadata` 在已审计版本中未完整持久化，不能承担行级引用。
- 默认 search 不保证过滤 expired facts；产品必须自行定义 current、as-of-valid-time 和 as-known-at 查询。
- 删除与重摄入需要自己的 projection ledger，不能把 Graphiti 级联视为可逆事务。

## 9. Implementation Order

### Slice 1 — Knowledge Foundation and Golden Flow

1. 先独立实现纯 TS contract、strict schema、Windows path、hash/fingerprint、freshness 和 tests。
2. 实现 Source Manifest repository、OKF parser/round-trip 和 ChangeSet transaction；后续需要 trust/review/OKF limits 时再按台账 Copy/Port。
3. Port 可恢复队列契约；复用当前进度 UI。
4. 从 ApplyView 抽取纯 diff renderer，并以独立 Knowledge Review Core/UI 实现多文件写入前审核；legacy ApplyView 写入路径不复用。
5. 完成单来源两阶段编译、事务、citation jump 和 unchanged skip。

### Slice 2 — Knowledge Studio and Daily Reliability

1. 新建全页 Knowledge Studio。
2. Port Sources cards、Activity、Review Inbox 和 Health。
3. 加入 hot/index/domain/page 与 Quick/Standard/Deep。
4. 完善 rename/delete ownership、lint 和 Git checkpoint 可选项。

### Slice 3 — Graph Experience

1. Copy graph worker/search/visibility。
2. Port metadataCache 增量构图、Louvain 和四信号相关性。
3. 将一跳图扩展叠加到 Search v3。
4. 完成 Graph、insights、knowledge gaps 和 research 入口。

### Slice 4 — Temporal Projection, Only if Earned

1. 先验证 Markdown 时态字段和历史问答任务集。
2. 达到接入门槛后建立 outbox/projection ledger。
3. 以可选 Windows 外部服务接入 Graphiti，并保持核心 Obsidian 知识路径不依赖它。

## 10. Attribution Workflow Before First Copy

首次复制外部代码时，同一个 commit 必须完成：

1. 更新根目录 `THIRD_PARTY_NOTICES.md`，按项目记录仓库、commit、版权、许可证和本地目标文件。
2. 只为实际纳入的材料在 `third_party/licenses/` 保存对应 MIT、GPL-3.0、Apache-2.0 原文和 NOTICE；不能提前暗示组件已包含。
3. 在明显复制或派生的源码文件头注明原仓库、commit、路径和修改说明。
4. 保留上游测试意图，并增加 Windows CRLF、盘符/反斜杠、大小写碰撞、保留设备名、文件占用、中文路径、popout window 和 Vault adapter 回归测试。
5. 在 PR/commit 描述中区分 copied、ported 和 inspired，避免以后无法追溯。

仅复制 `llm_wiki` Viewer/D3 资产时才需要携带其 Viewer 第三方 D3 notice；当前计划不复制该资产。

这套流程不会阻碍个人使用，反而确保代码可以放心持续维护，未来即使决定同步、发布或合并上游，也不用重新考古来源。
