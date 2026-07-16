# GitHub Personal Knowledge Systems Landscape / 个人知识系统技术调研

Status: Research snapshot

Snapshot date: 2026-07-16

本文回答三个问题：GitHub 上近期受关注的个人知识库与 LLM Wiki 项目有哪些，它们具体如何实现，以及哪些方法适合用于 Obsidian Copilot 的二次开发。

配套产品与技术方案见 [`PERSONAL_KNOWLEDGE_OS_PRD.md`](./PERSONAL_KNOWLEDGE_OS_PRD.md) 和 [`PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md`](./PERSONAL_KNOWLEDGE_AGENT_SOLUTION.md)。五个核心项目已进一步完成 commit 与文件级代码审计，具体 Copy / Port / Reference 清单见 [`OPEN_SOURCE_REUSE_PLAN.md`](./OPEN_SOURCE_REUSE_PLAN.md)。

---

## 1. 结论

当前最值得采用的路线不是传统的“文档切块 + 向量检索 + 每次临时回答”，而是把来源持续编译为一个可读、可链接、可校验的 Markdown Wiki：

1. Raw Sources 保持不可变和可追溯。
2. 先分析来源，再生成受控的多文件 ChangeSet。
3. 用 manifest、hash 和队列完成增量更新与失败恢复。
4. 用 `index.md`、主题页和链接图进行渐进式发现。
5. 查询时组合关键词、语义和 Wiki 链接，而不是只依赖向量相似度。
6. 用引用覆盖、断链、陈旧内容和孤立页面检查代替“模型看起来回答得不错”。
7. 用 OKF 作为导入导出契约，而不是把它误当成数据库或 Agent Runtime。

对本项目的直接建议是：继续使用 Obsidian Copilot 的 TypeScript、React、Vault API、现有搜索和模型 Provider，不把另一个完整产品嵌入进来。优先原生实现编译式 Wiki 的小型、纯 TypeScript 契约；外部项目作为设计与兼容性参考。

---

## 2. 调研口径

GitHub Trending 页面没有稳定的历史排名接口，因此这里的“近期趋势”不是声称某个项目在官方 Trending 榜单上的精确名次，而是以下信号的组合：

- 以 GitHub 仓库搜索中 2026 年 4 月以来创建的 `LLM Wiki` 相关仓库按 star 排序。
- 核对仓库最近 push、release、README、依赖和许可证。
- 追加长期活跃的个人知识库、Agent Memory 与时序知识图谱项目作为邻近路线对照。
- star 是关注度信号，不代表架构质量、维护承诺或与本项目的适配程度。

所有数字都是 2026-07-16 的快照，会继续变化。

---

## 3. 新一代 LLM Wiki / OKF 项目

| 项目 | 快照关注度 | 主要技术 | 核心做法 | 对本项目的判断 |
| --- | ---: | --- | --- | --- |
| [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) | 约 14.7k stars | Tauri、React/TypeScript、Rust、LanceDB、Graphology/Sigma.js | Raw → Wiki → Schema；两阶段摄入；hash 增量缓存；持久队列；混合检索；图扩展；人工审核；MCP/HTTP | 最完整的产品参考；借鉴机制，不引入 Tauri/Rust Runtime |
| [AgriciDaniel/claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) | 约 9.5k stars | Python、Agent Skills、Obsidian REST/文件系统、BM25、可选 Ollama | 支持 LYT/PARA/Zettelkasten；`hot.md`/`index.md` 渐进检索；manifest 增量更新；文件锁；Git 自动提交 | 适合借鉴 Vault 工作流、渐进披露和多写者保护 |
| [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) | 约 2.9k stars | TypeScript、Bun/Turbo、桌面与 Web 编辑器、MCP/CLI、Git | 面向 Markdown/MDX 的 AI 编辑环境，多 Agent 并排编辑，图谱、同步和搜索 | UI/Agent 接入参考；与 Obsidian 编辑器职责重叠，不应移植产品外壳 |
| [Ar9av/obsidian-wiki](https://github.com/Ar9av/obsidian-wiki) | 约 2.9k stars | Python、Agent Skills、Obsidian Vault | 摄入 → 抽取概念/实体/主张/关系 → 合并矛盾 → 演化 schema；doctor/query/lint/trust-check | 工作流清晰，适合作为 Skills 与命令体验参考 |
| [atomicstrata/llm-wiki-compiler](https://github.com/atomicstrata/llm-wiki-compiler) | 约 1.8k stars | TypeScript、Node.js、Zod/Ajv、MCP、OpenAI/Anthropic SDK | 两阶段编译；类型化生命周期 profile；source/line citation；混合检索；lint/eval；OKF 导入导出 | 与本项目技术栈和目标最贴合，优先做代码与依赖审计 |
| [VectifyAI/OpenKB](https://github.com/VectifyAI/OpenKB) | 约 3.0k stars | Python、LiteLLM、OpenAI Agents SDK、PageIndex、MarkItDown | 多格式摄入；长文档使用无向量的树状推理检索；多模态；OKF-ready；Skill Factory | 长 PDF/报告摄入的重要参考；不在 MVP 中引入 Python sidecar |
| [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog) | 约 7.2k stars | Markdown、YAML、OKF 规范与工具 | 用极小文件契约表达可移植知识 Bundle | 作为兼容格式采用，不作为运行时依赖 |

### 3.1 `nashsu/llm_wiki`：完整产品形态

这是当前最完整的 LLM Wiki 产品化样本：

- 前端使用 React/TypeScript，桌面壳与本地能力使用 Tauri/Rust。
- 摄入分为 LLM 分析和页面生成两步，减少“一次调用直接改很多文件”的不可控性。
- 来源以 SHA-256 建立增量缓存；串行持久化队列支持崩溃恢复和重试。
- 关系图使用 Graphology、Sigma.js、ForceAtlas2 和 Louvain 社区发现。
- 检索组合分词检索、可选 LanceDB 语义检索、一跳 seed-neighbor 链接图扩展和 token 预算分配。
- 外部来源通过 frontmatter 中的 source refs 保持追溯。
- 提供人工 review、浏览器采集、MCP、本地 HTTP API 和 Agent Skills。

可采用的是两阶段摄入、增量 manifest、持久队列、图扩展和审核界面。Tauri、Rust、LanceDB 都不是 Obsidian Copilot MVP 的必要条件。

### 3.2 `llm-wiki-compiler`：最接近本项目的工程参考

这个仓库与本方案的契合度最高：

- 以 TypeScript CLI/SDK 表达 `sources/`、`wiki/`、状态目录和生成 artifacts。
- 先抽取概念，再根据类型化 profile 生成页面和关系。
- profile 约束实体类型、字段、关系、生命周期、trust gate、workflow 和检索策略，并以 fail-closed 方式执行。
- citation 可定位到源文件和行范围，lint 可以检查其完整性。
- 查询使用 semantic chunks、BM25 rerank 和 wikilink graph expansion。
- 内置断链、孤立、陈旧页面修复与 citation/eval 回归指标。
- 提供 MCP、SDK，以及 review-first 的 OKF 导入导出。

它使用 MIT 许可证，代码语言也匹配本项目，但当前 CLI 面向 Node.js 24，并带有自己的 Provider、状态目录和执行假设。合理路径是先审计可复用的纯逻辑模块和数据契约，再决定采用依赖、移植叶子模块或只实现兼容接口；不应直接把整个 CLI Runtime 接入 Obsidian 插件。

### 3.3 `claude-obsidian`：渐进披露和多写者安全

这个项目更像可被不同编码 Agent 使用的 Vault 方法论：

- `hot.md` 提供高频入口，`index.md` 再导航到领域索引和概念页。
- `.manifest.json` 记录来源到生成页面的映射，支持 delta ingest、archive 和 rebuild。
- BM25 始终可用；可选本地 Ollama cosine rerank，外发上下文前需要 consent。
- 文件 advisory lock 和 Git 自动提交降低多个 Agent 同时写 Vault 的风险。
- 可以通过 Obsidian Local REST API 或文件系统 MCP 工作。

其中 `hot → index → domain → page` 很适合控制上下文预算；文件锁、before-hash 和可恢复 ChangeSet 则应统一成 Copilot 的写入契约。

### 3.4 `OpenKB`：长文档的另一种检索路线

OpenKB 没有把所有文档都强制放进同一种向量检索：短文档走轻量流程，较长文档通过 PageIndex 建立树状目录，让模型先定位章节再读取正文。这对论文、书籍和大型报告比固定 chunk top-k 更有解释性。

本项目可以保留“按文档结构检索长文档”的接口，但第一阶段先复用已有 PDF 解析和 Search Runtime。只有在长文档评测证明固定切块是主要瓶颈后，再实现原生 TypeScript 目录树索引或通过受控外部工具接入。

---

## 4. 邻近成熟路线

| 项目 | 主要定位 | 关键技术思想 | 应如何使用 |
| --- | --- | --- | --- |
| [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | 自托管个人 AI、RAG、Agent 与自动化 | Python/TypeScript，多格式语义搜索，多端入口，自定义知识和定时任务 | 用于对比成熟产品体验，不复制其后端架构 |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | Agent 长期记忆层 | 事实抽取、实体链接、semantic + BM25 + entity 融合检索 | 仅用于偏好、人物和会话记忆；不能替代 Vault Wiki |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 时序知识图谱 | episode provenance、事实有效时间、旧事实失效而非删除、混合图检索 | 借鉴时间与来源语义；MVP 不引入 Neo4j/FalkorDB/Neptune |
| [topoteretes/cognee](https://github.com/topoteretes/cognee) | 面向 Agent 的知识图谱记忆 | 数据摄入、图结构、检索与记忆 pipeline | 作为图记忆对照，不作为基础依赖 |
| [letta-ai/letta](https://github.com/letta-ai/letta) | 有状态 Agent Runtime | Agent 状态、memory blocks、长时运行和工具 | 只参考状态与记忆边界，不替换 Copilot Runtime |

这三种概念必须分开：

- Knowledge：用户能够直接查看、编辑、引用和迁移的 Vault/OKF 内容。
- Memory：从会话中形成的偏好、人物或历史线索，可能过期或被纠正。
- Runtime State：当前任务计划、工具结果、队列和重试状态，任务结束后通常可以丢弃。

把三者塞进一个向量库，会同时损害来源追溯、删除语义和上下文质量。

---

## 5. 共同工程模式

### 5.1 两阶段摄入优于直接生成

高质量项目普遍把摄入拆成：

1. 分析来源，提取概念、实体、主张、关系和受影响页面。
2. 生成一个确定目标集合的 ChangeSet，并在应用前验证。

这样能在模型写入前检查越权路径、引用缺失、并发覆盖和预算，而不是事后尝试修复被污染的 Vault。

### 5.2 Manifest 是增量编译的核心

manifest 至少应记录：

- source ID、路径、内容 hash 和 modified time；
- 该来源生成或影响的 Wiki 页面；
- 使用的 schema/profile 版本和生成时间；
- 最近运行结果、失败原因和可重试状态；
- 页面由系统生成、用户拥有还是混合维护。

它比“扫描所有 Markdown 猜哪些页面需要更新”更可靠，也是删除来源、回滚和重建的基础。

### 5.3 混合检索不是简单相加

值得采用的查询顺序是：

1. 从 `hot.md` 或 `index.md` 发现候选领域。
2. 使用关键词/BM25 与现有语义检索召回页面。
3. 使用 wikilink 邻居扩展显式相关页面。
4. 按 scope、freshness、source coverage 和 token budget 重排。
5. 需要核实时再回到 Raw Sources，而不是把 Wiki 摘要当原始证据。

无需在第一版新增 LanceDB；现有 Search v3、向量能力和 Vault 链接已经足以验证这一策略。

### 5.4 Lint 与 Eval 是产品能力

基础 lint 应覆盖：

- YAML/frontmatter 和 OKF 必填字段；
- 断链、孤立页、重复身份和非法路径；
- 缺少 source refs 或引用定位失败；
- source hash 已变化但页面尚未更新；
- index 未包含的新页面；
- ChangeSet 的 before-hash 冲突。

基础 eval 应覆盖真实用户问题的引用覆盖率、来源命中率、无依据断言、检索延迟、写入接受率和回滚成功率。它们比单独统计 embedding 相似度更能反映知识系统是否可信。

---

## 6. 对 Obsidian Copilot 的采用方案

### 6.1 现在采用

在现有 TypeScript 架构中新增小型、可直接以纯数据测试的叶子模块：

- `KnowledgeBundleConfig`：source roots、wiki root、schema/profile、权限与预算。
- `SourceManifest`：source hash、页面映射、ownership 和运行状态。
- `OkfDocument`：frontmatter、正文、wikilinks、citations 和扩展字段。
- `KnowledgeChangeSet`：create/update/delete、before-hash、source refs 和预览结果。
- `KnowledgeValidator`：路径、OKF、引用、链接和冲突校验。
- `KnowledgeIngestQueue`：串行、可取消、可重试、可恢复的摄入任务。

这些模块接收普通参数和接口，不直接依赖设置单例、UI、Provider Manager 或 Vault 全局对象。顶层 orchestration 再注入文件读取、模型调用和搜索能力。

### 6.2 验证后采用

- BM25/semantic/wikilink 的融合重排与一跳图扩展；两跳只作为后续效果实验。
- 长文档树状索引。
- 自动 lint 建议和有限的 generated-only 自动维护。
- OKF import/export 与外部 MCP/Agent Skills。
- temporal claim 的 `valid_from`、`valid_to`、supersedes 和 provenance 表达。

### 6.3 明确不作为 MVP 前提

- 第二套 Tauri 或独立桌面编辑器。
- Python sidecar、常驻后端或额外数据库。
- Neo4j、FalkorDB、Neptune 等图数据库。
- 为 Wiki 单独部署 LanceDB 或另一套向量基础设施。
- 多 Agent 自主协作和全 Vault 无审核改写。
- 把偏好记忆、任务状态和知识页面合并进同一存储层。

---

## 7. 许可证与复用边界

| 项目 | 许可证 | 建议 |
| --- | --- | --- |
| `llm-wiki-compiler`、`claude-obsidian`、`obsidian-wiki` | MIT | 可在保留版权与许可声明后复用；仍需先做代码适配审计 |
| `OpenKB`、OKF、Mem0、Graphiti、Cognee、Letta | Apache-2.0 | 可参考或复用，但保留 NOTICE/归属并检查专利与再分发要求 |
| `llm_wiki` | GPL-3.0 | 适合研究机制；复制代码前需单独确认与本项目 AGPL 分发的合规方式 |
| `open-knowledge` | GPL-3.0 | 主要借鉴交互，不引入其编辑器代码 |
| Khoj | AGPL-3.0 | 架构参考；复用代码会带来对应的网络分发义务 |

许可证兼容不等于可以忽略署名、NOTICE、依赖许可证或素材来源。正式复制代码前应以目标 commit 的 `LICENSE`、依赖清单和文件头完成一次独立审计；本文不是法律意见。

---

## 8. 推荐实施顺序

### Spike：兼容性验证

- 审计 `llm-wiki-compiler` 的数据契约、纯逻辑模块、Node 24 假设和依赖边界。
- 使用少量真实 Vault 文件验证 OKF parser、source refs 和 ChangeSet 表达。
- 建立 10 至 20 个真实问题作为检索与引用基线。

### Phase 1：原生知识编译闭环

- 实现 config、manifest、OKF document、ChangeSet 和 validator。
- 完成单来源两阶段 ingest、持久队列、暂停/取消/重试/重启恢复、预览、journal 写入、log 和 recovery。
- 查询优先读取 `index.md`/Wiki，必要时回到 Raw Source。

### Phase 2：可靠性和检索

- 加入增量 watch、来源生命周期和 stale 检测。
- 融合现有关键词、语义检索与 wikilink 扩展。
- 提供 lint 报告、引用覆盖和回归任务集。

### Phase 3：互操作与增强

- 增加 OKF import/export、MCP/Agent Skill 和长文档树索引。
- 在有真实时序问题后增加 temporal claim，而不是先部署图数据库。

最终选择不是“用哪一个开源项目替换 Copilot”，而是以 Copilot 为产品壳和 Runtime，吸收这些项目已经证明有效的增量编译、渐进检索、引用校验和可恢复写入机制。
