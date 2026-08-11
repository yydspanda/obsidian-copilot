# Query、引用与 Save to Wiki

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`。最近核对：2026-08-12。

## 本页目标

本页帮助你查询已经审核并应用的知识、回到原始证据核对结论，并把有价值的回答重新送入 Activity；随后可能以 `no_changes` 收敛，也可能进入 Review → Apply。

`Query` 不是普通 Chat，也不是“搜索整个 Vault”。它只从当前 Bundle 中已接受、已 Apply、且内容哈希仍通过验证的 Wiki 页面检索候选；生成回答或打开引用时，还会按这些页面记录的来源关系重新读取并验证对应的已注册 Source。它不会搜索整个 Vault。

## 前置条件

- Knowledge Studio 已就绪，并显示 `Query` 页签。
- 至少有一个来源已经通过 Review/Apply 形成可验证的 Wiki 页面。
- DeepSeek Knowledge 查询路由可用。
- 想使用 `Save to Wiki` 时，当前回答必须是带有至少一个 claim 的 `Supported` 或 `Partial`。

如果刚完成导入但尚未 Apply，请先阅读 [Review 与 Apply](review-and-apply.md)。

## Query、Chat 与 Copilot Plus 的区别

| 功能                 | 主要读取范围                                                                  | 回答是否自动沉淀到 Wiki               | Knowledge Review/Apply                                |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| 普通 Chat Context    | 当前笔记与明确加入本次对话的上下文                                            | 否；保存聊天记录仍只是普通笔记        | 不参与                                                |
| Chat Knowledge Draft | 用户核对、编辑后提交的一条完整 AI 回答                                        | 否；先成为二级笔记 Source             | 后台编译后可能进入 Review                             |
| Vault QA             | 原项目的 Vault 检索范围                                                       | 否；保存回答仍不会自动进入 Knowledge  | 不参与                                                |
| Copilot Plus         | 原项目的付费 Agent、工具和文档上下文能力                                      | 否；其写文件能力不等于 Knowledge 发布 | 不参与                                                |
| Knowledge `Query`    | 当前 Bundle 中已接受、已应用且重新验证的 Wiki，以及该查询可重新验证的来源证据 | 否；必须显式 `Save to Wiki`           | Query 本身只读；保存后为 `no_changes` 或 Review→Apply |

Knowledge Query 不使用普通 Vault QA 的向量索引来扩大搜索范围，也不依赖 Copilot Plus 许可证。不要因为普通 Chat 能读到某个文件，就假定 Knowledge Query 已经接受了它。

### Chat Knowledge Draft 与 Query Save 的证据差别

两者都会先创建一个 Source，再走 Activity；后台结果可能是 `no_changes`，也可能进入 Review→Apply，但它们不是同一种证据：

| 对比项       | Chat → `Create Knowledge Draft`                               | Query → `Save to Wiki`                                    |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| 输入资格     | 一条完成的非错误 AI 回答，经用户编辑和显式确认                | 当前 `Supported` / `Partial` 回答，至少有一个已验证 claim |
| 原始证据关系 | 不自动继承 Chat citations、文件上下文、对话历史或原始来源关系 | 保存当前 Query 已验证的 claims、引用关系和持久版本信息    |
| 资料性质     | 用户核对过的二级笔记；应人工补书名、章节、页码                | 有当前 Knowledge 证据链的受管理查询成果                   |
| 后续编辑     | 可有意编辑 Vault 副本，形成同一 Source 的新 revision          | 内容寻址的系统 capture；不应编辑或改名                    |
| 创建动作本身 | 本地创建并登记 Source；零模型调用、零 Wiki 写入               | 本地创建并登记 Source；零模型调用、零 Wiki 写入           |
| 后续编译     | 普通 `ingest`，可能产生费用、`no_changes` 或 Review           | `query_writeback`，可能产生费用、`no_changes` 或 Review   |

如果你的目标是“把刚才解释清楚的内容变成待整理笔记”，使用 Chat Draft；如果你的目标是“把已应用 Wiki 和可重新验证原始 Source 支持的结论沉淀回来”，使用 Query Save。Chat Draft 中手工写入书名页码有助于人工核对，但不会自动获得 Query 的结构化证据授权。

## 操作步骤：提出问题

1. 打开 Knowledge Studio 的 `Query`。
2. 在 `Search your applied knowledge…` 输入问题或搜索短语。
3. 点击 `Search`。
4. 等待系统验证当前 Wiki 与来源证据，并返回回答和检索证据。

问题最多 1,000 个字符。新查询开始时，上一条查询及其引用权限会立即失效；需要保留的结论应先核对并按本页后半部分保存。

Query 会先在已应用 Wiki 中做本地词法检索。只有找到可以重新验证、且符合综合回答证据要求的来源摘录后，才会调用 DeepSeek 生成回答。

## 看懂回答状态

| 界面状态                | 含义                                         | 建议                                        |
| ----------------------- | -------------------------------------------- | ------------------------------------------- |
| `Supported`             | 返回的 claims 都有当前查询验证过的来源证据   | 仍要打开重要引用人工核对                    |
| `Partial`               | 有一部分可支持的结论，同时列出仍缺少的证据   | 只采用有引用的部分，并补充来源              |
| `Insufficient evidence` | 当前查询没有足够的合格来源证据来生成可靠结论 | 不要把它当答案；补来源或先完成 Review/Apply |

如果没有合格来源证据，系统会确定性返回 `Insufficient evidence`，不会为了“给一个答案”而调用模型。

### `Source fact` 与 `Inference`

每条 claim 会标记：

- `Source fact`：来源直接表达的事实；
- `Inference`：模型基于列出证据做出的推断或综合。

Inference 仍必须带引用，但它不是来源原话。做重要决定时，必须打开引用并判断推理是否成立。

`Evidence still needed` 会列出当前仍缺少的证据。它适合变成下一轮资料收集清单，而不是被忽略。

## 操作步骤：查看检索证据

回答下方的 `Evidence used for retrieval` 会显示匹配到的 Wiki 摘录。每项包含：

- Wiki 页面或标题；
- 页面内标题路径；
- 匹配文本；
- 可用的原始 Source 引用。

命中内容来自 Wiki，但引用按钮指向原始 Source，而不是把生成的 Wiki 当成最终证据。当前可导航的非 PDF 来源必须使用 `.md` 扩展名；`.markdown` 和 `.txt` 可以摄入并生成 Wiki，但当前不能成为 grounded-answer 的可验证 Source 摘录，也没有可靠的精确引用导航。当前可能出现以下位置：

| 引用位置    | 点击后的行为                      |
| ----------- | --------------------------------- |
| `.md` quote | 打开来源并选择精确原句            |
| `PDF page`  | 重新验证原始 PDF 字节后打开对应页 |

导航适配器内部保留 line/heading 类型，但当前 production 文本 parser 只产出 quote 定位器；手册不把尚不可达的类型写成可用能力。

点击前，系统会重新验证引用仍属于当前 Query，并检查来源内容。来源改变、查询替换、插件重载或当前适配器更换后，旧引用会被撤销；此时重新运行 Query 获取新引用。

### PDF 查询边界

PDF 页引用可以出现在检索证据中，并支持安全的精确页跳转。不过当前综合回答只使用来自 `.md`、带有合格来源摘录且已重新验证的证据；`.markdown`、`.txt` 和 `pdf_page` 都不会进入当前回答模型的 Source evidence。

因此，某个查询可能同时出现：

- 已命中的 Wiki 摘录；
- 可打开的 PDF 页引用；
- `Insufficient evidence` 综合回答。

这不是矛盾：检索找到了已应用 Wiki，但当前回答模型没有获得合格的 `.md` Source 证据。此时应打开 PDF 页人工阅读，或补充 `.md` 来源；不要把检索片段误当成模型已经支持的回答。

## 操作步骤：Save to Wiki

`Save to Wiki` 只会在当前回答满足以下条件时出现：

- 回答状态是 `Supported` 或 `Partial`；
- 至少有一个带已验证引用的 claim；
- 当前 Knowledge generation 提供写回能力。

保存步骤：

1. 先打开并核对重要引用。
2. 在 `Title for this knowledge result…` 中输入清晰标题。
3. 点击 `Save to Wiki`。
4. 等待 managed source 已注册的提示；随后结果可能进入 Review，也可能正常得到 `no_changes`。
5. 首次注册新来源时，转到 `Activity` 等待对应任务；完全相同的精确重放可能直接复用已有状态。
6. 如果任务为 `Awaiting review`，打开 `Review`，检查新提案并提交。
7. 只有 Review 中接受的内容成功 Apply 后，Wiki 才真正改变。

标题最多 256 个字符。标题用于被保存结果的展示内容；你不能在此指定任意 Wiki 目标路径，页面组织仍由 Schema 和编译流程决定。

### 保存实际产生什么

```text
当前有证据的 Query 回答
          ↓ Save to Wiki
在 sourceRoot 创建内容寻址的 managed Markdown source
          ↓
注册来源并进入 Activity
          ↓
两阶段编译
      ↙         ↘
no_changes     Review
                  ↓
             显式 Submit review / Apply
                  ↓
                 Wiki
```

`Save to Wiki` 的名字表示“送去形成 Wiki 知识”，不是“立即写入 Wiki”。点击后首先创建一个内容寻址、按系统约定不可修改的 managed Markdown source；同一路径的不同字节不会被覆盖。它会保留问题、标题、回答 claims、证据关系和生成时的持久版本信息。**应该**把它视为系统管理的 Source，不要随意改名或编辑。

保存成功后仍可能得到 `no_changes`。这表示编译器认为现有 Wiki 已经包含等价知识，不需要新增或更新页面。

## 你应该看到什么

一次完整的查询复利流程应满足：

- Query 只展示已应用 Wiki 的命中；
- `Supported` / `Partial` claim 明确区分 Source fact 与 Inference；
- 每个回答 claim 都带当前查询可用的来源引用；
- 点击引用会打开经过重新验证的 Markdown 位置或 PDF 页；
- 点击 `Save to Wiki` 后，Wiki 立即保持不变；
- Activity 随后出现 managed source 的编译任务；
- 只有 Review 接受并成功 Apply 后，Wiki 才改变。

## 如果结果不同

- 看不到 `Query` 页签：当前 Studio generation 未连接查询适配器；先处理 Studio 不可用或启动配置问题。
- `No applied Wiki excerpt matched`：未应用提案、已改变但未重新接受的页面、以及其他 Vault 笔记都会被排除。先完成来源的 Review/Apply，或换更贴近现有 Wiki 的关键词。
- `Insufficient evidence`：当前没有足够的合格来源证据；补充来源，不要要求系统脱离证据猜测。
- 只有 `.markdown` 或 `.txt` 来源：它们可以参与摄入和 Wiki 生成，但不能作为当前 grounded-answer 的可导航 Source evidence；需要 Query 综合时，将可核对材料保存为新的 `.md` 来源并重新走 Review/Apply。
- 有 PDF 命中却仍 `Insufficient evidence`：查看上面的 PDF 查询边界；PDF 页当前可检索和跳转，但不直接进入综合回答模型证据。
- 引用提示 source changed / unsupported / cannot be opened：来源字节或 Query generation 已变化。重新运行 Query；如果来源确实更新，等待它完成新的 Review/Apply。
- `Save to Wiki` 不显示：回答不是 `Supported`/`Partial`，没有 claim，或当前写回适配器不可用。
- 保存提示 only a current source-grounded answer：旧 Query 已失效，或保存期间 Wiki/来源发生变化。运行一条新 Query 后重新核对和保存。
- 保存失败：系统没有修改 Wiki。按提示从新 Query 重试，不要手工伪造 managed source 或 Runtime 记录。
- 保存后 Review 为空：查看 Activity；任务可能仍在运行，也可能已正常 `Completed (no_changes)`。

更多处理路径见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- Query 的本地快照验证和词法检索不调用模型。
- 有合格证据时，综合回答会向 DeepSeek 发送你的问题、有限的已应用 Wiki 上下文和为本次查询重新验证的来源摘录，通常产生一个请求和相应费用。
- 没有合格证据时，`Insufficient evidence` 不触发模型请求。
- 点击引用是本地验证与导航，不会因此调用回答模型。
- `Save to Wiki` 的捕获和注册发生在本机；它随后启动的后台编译通常还会产生分析、生成两个 DeepSeek 请求。
- Query 不会搜索或上传整个 Vault，但进入本次有界上下文的内容会发送给 DeepSeek。详见 [隐私与安全](privacy-and-security.md)。

## 相关页面

- [Review 与 Apply](review-and-apply.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [知识来源与导入](sources-and-import.md)
- [长期使用规范](operating-guidelines.md)
- [隐私与安全](privacy-and-security.md)
- [故障排查](troubleshooting.md)
