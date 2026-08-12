# Personal Knowledge Studio 产品复评与 Copilot Plus 对比

> 二次复评快照：2026-08-12。对象是当前工作树中的 Copilot 3.3.3 + Windows 个人版 Personal Knowledge Studio，以及 Brevilabs LLC 当日公开的英文官网、定价、文档、隐私政策和服务条款。英文首页的 V4 宣传与现有定价、功能文档尚未完全对齐，价格、权益和交付状态可能变化，购买前应重新核对官方页面。

## 一句话结论

**现在可以把它用于你自己的真实知识工作，但应把它称为 owner-operated personal production（所有者亲自维护的个人生产工具），对其他用户仍只是受约束的 private beta。综合建议评分从上次的 6.2/10 上调到 6.8/10。**

它最有价值的地方不是“聊天更聪明”，而是把 AI 产物变成一条可检查的发布链：

> Chat 帮你理解 → 你编辑并核对 Knowledge Draft → 登记 Source → Activity →（`no_changes`，或 Review → Apply → 可追溯 Wiki）→ 有证据 Query

Copilot Plus 更像开箱即用、入口广泛的 AI 助手；Personal Knowledge Studio 更像谨慎的个人知识出版系统。两者可以互补，不能只凭功能数量判断谁替代谁。

这里的“可以正式使用”指 Knowledge Studio 在下述限定范围内可用。若要使用 Chat → Knowledge Draft，仍须另外配置并验证一个可用的 Chat provider；本轮 Windows 验收从已保存的完整 AI 回复进入，并未证明当时缺少 API Key 的 provider 能现场生成新回答。

## 与第一次评估相比，发生了什么

本次复评不是把旧分数重新包装。以下变化已经实装；每项的证据状态在正文中分别标注，不把聚焦自动化写成 Windows 人工验收：

- **Chat → Knowledge Draft 已接通。** 一条完整、非错误的 AI 回复可以进入可编辑确认窗口；用户核对并明确确认后，才在唯一 sourceRoot 中创建 Source。它不会直接写 Wiki；若后续编译提出变更，仍不能绕过 Review/Apply，也可能正常收敛为 `no_changes`。
- **Source 生命周期补齐。** 已登记来源被误删时，不再让整个 Studio 一起失效；用户可以按原路径恢复、`Check again`，或经二次确认 `Remove from Knowledge`。退役不会自动删除既有 Wiki。
- **正常换代改成中性刷新。** 操作间隙显示 `Refreshing Knowledge Studio…`，不再短暂用红色 `Knowledge Studio unavailable` 制造失败错觉；程序化验证通过，用户也已在实际操作中确认观感正常。
- **本地 readiness 基础切片已实装。** `Setup & status` 把 Workspace、Project 专用 Knowledge 模型和可选 Chat 模型拆成三张独立卡片；Chat 未配置不会拖垮 Knowledge。它只做本地、只读判断，不请求模型，不自动建 Project、目录或 Schema，不改 Bundle YAML，也不写 Key。当前工作树全仓门禁已通过；Windows 主窗口的已配置路径也已证明三卡、可选 Chat、刷新展示和返回 Studio 正常。三卡交互没有修改 Sources、Wiki、Knowledge、Projects 或 `data.json`；插件启动只按既有设计推进私有 Runtime observation bookkeeping，启动收敛后 Runtime 也保持精确不变。为避免破坏真实配置，配置失败、Recovery、自然 Refreshing 与 popout Setup 未做本轮现场制造。
- **14 篇中文手册形成完整导航。** Manuals、Sources、Chat、Activity、Review、Wiki、Query、删除后果和恢复都已有大白话说明；同步到 Windows Vault 后，127 个本地链接全部可解析。
- **发布门禁提高。** 当前工作树通过 271 个 Jest suite、4,503 个测试，以及 TypeScript、格式、ESLint、production build、文档链接、差异和敏感信息检查；没有用自动化冒充仍待完成的 Windows 人工交互。

这些变化把核心闭环从“工程上能连起来”推进到“已配置用户可以按流程使用”。三卡 readiness 已经解决“应该去哪里查”的基础问题，但还没有代替用户完成 Project、Bundle、Schema 和凭据配置；Review 修正、Wiki 回滚和长期复用验证的缺口也仍然存在。

## 当前产品阶段与使用边界

### 可以放心怎么用

- 单人在 Windows Obsidian Desktop 中管理一个明确配置的 Bundle 和一个 sourceRoot；
- 从少量高价值 Markdown 阅读笔记、带文本层 PDF 或受控文件夹快照开始；
- 用 Chat 理解材料，再把自己核对过的内容创建为 Knowledge Draft；
- 把 Activity、`no_changes`、Review、Apply、Missing 和 Recovery 当作正常流程的一部分；
- 重要结论始终在 Review 中检查，不把模型回答自动当事实。

### 现在不能承诺什么

- 不能承诺普通新用户不读说明即可完成首次配置；
- 不能承诺多 Bundle、多人、跨平台、持续外部目录同步、OCR、URL/浏览器导入或 Explorer 单文件入口；
- 不能承诺 Review 中可直接改稿、按反馈重生成，或 Apply 后一键撤销 Wiki；
- 不能把局部 Windows 验收描述成完整 Golden Flow 已全部完成；
- 不能把一次成功使用等同于 30 天后知识一定会被复用。

因此，阶段判断是：

- **对当前所有者：个人生产可用。** 配置已完成、手册已读、愿意人工审核，可以正式放入真实但可恢复的日常任务。
- **对邀请测试者：受约束 private beta。** 需要明确边界、指导配置和收集问题。
- **对公开上架或商业推广：尚未就绪。** 缺少首次成功率、长期留存、成本、支持负担和跨环境证据。

## 二次评分

评分是产品判断，不是实验室基准。Knowledge Studio 的判断来自代码、测试、手册、Windows 有界验收和真实用户反馈；Plus 的判断只来自官方公开材料，未独立审计其专有服务端。三卡 readiness 已通过当前工作树自动化门禁和已配置主窗口的 Windows 有界验收；下表仍保留本轮开始时的冻结分数，因为它没有证明普通新用户能独立完成首配。

### Personal Knowledge Studio

| 维度             |       评分 | 二次判断                                                                                                               |
| ---------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------- |
| 问题与产品方向   |     8.8/10 | “临时理解怎样变成以后仍可信的知识”是真问题，且已形成清楚的治理定位。                                                   |
| 差异化价值       |     8.7/10 | Source 授权、Activity、Review、事务 Apply、provenance、引用失效、Recovery 与退役共同构成了难以被普通 Chat 替代的闭环。 |
| 工程安全与可靠性 | **8.8/10** | 当前 271 suites / 4,503 tests 与多轮 Windows 有界验收，证明安全边界受到认真保护；readiness 已配置主窗口路径已实测。    |
| 核心闭环完整度   | **7.6/10** | Chat Draft 和来源生命周期补上了两处关键断点；Review 修订、Wiki 回滚和完整 Golden Flow 仍未闭合。                       |
| 首次配置体验     |     3.5/10 | 三卡已让必需/可选状态可见，但仍要手工完成 Project、Bundle、路径、Schema、模型与 Key；未配置路径尚未现场实测。          |
| 日常 UX          | **6.6/10** | 中性刷新、删除后果、草稿入口和手册带来明显提升；已配置目标用户约 **7.5/10**，首次普通用户约 **4.7/10**。               |
| 商业化成熟度     | **4.2/10** | 仍是 Windows、单人、单 Bundle 的窄产品，没有外部留存、付费意愿、支持成本或 30 天复用数据。                             |

**综合建议分：6.8/10。** 它不是七个维度的机械平均，而是“当前是否值得继续用和继续投”的决策分：核心价值与工程可信度已经成立，产品自解释、可纠错和市场验证仍明显落后。

### Copilot Plus

| 用途                         |  当前判断 | 说明                                                                                                         |
| ---------------------------- | --------: | ------------------------------------------------------------------------------------------------------------ |
| 通用 Obsidian AI 助手        | 约 8.3/10 | 按当前英文定价与现有 Plus 功能文档，Chat、Vault/Web 搜索、Agent、Projects、Composer 和宽格式入口覆盖面更广。 |
| 首次获得对话价值             |      较强 | 内置模型和商业服务减少 BYOK 配置负担，但实际额度未公开，且 V4 首页与定价、功能文档尚未完全对齐。             |
| 可信长期知识治理             |      较弱 | 官方公开材料没有描述与 Source → durable Review → transaction Apply → provenance Wiki 等价的治理链。          |
| 作为 Knowledge Studio 替代品 | 约 5.0/10 | 能理解、搜索、写作和行动，但不能据此假定它会产出同样可审计、可复证的长期 Wiki。                              |

## 产品经理视角：readiness 已落地，下一刀转向“可修正”

### 用户真正购买的不是 AI，而是信任

目标用户希望同时获得两件经常冲突的东西：AI 的速度，以及长期知识不被静默污染的确定性。Knowledge Studio 的产品核心因此不是更长的功能菜单，而是以下承诺：

1. 没有明确登记的材料，不自动成为长期知识。
2. 模型提出的更改，用户看过并接受后才 Apply。
3. 来源变化、缺失、冲突和中断都有可见状态，不靠猜。
4. Query 明确区分 Source fact、Inference 和 Insufficient evidence。
5. 以后能回到证据，而不是只保存一段看起来可信的话。

这个定位值得坚持。若转去追逐“也有 Web、也有 Agent、也支持 50+ 格式”，会直接进入 Plus 和大量通用助手的主战场，并稀释当前真正独特的价值。

### 当前最强的产品进步

以前从阅读到 Source 之间需要用户自己复制整理，价值链有断点。现在 Chat Draft 把“模型帮我读懂”接到了“我核对后愿意长期保存”，同时没有把 Chat 回答自动升级为事实。这是一次正确的产品取舍：缩短操作，但不降低证据门槛。

Source Missing、受控 Remove 和中性 Refreshing 也同样重要。它们不是炫目的功能，却直接回答用户最担心的三个问题：“我能不能删？”“删了会怎样？”“短暂刷新是不是坏了？”

三卡 readiness 又补上了“现在到底差哪一步？”。它的产品价值是分开本地 Workspace、Knowledge 模型与可选 Chat，而不是用一个绿色标签假装已经联网成功。已配置主窗口路径已经过 Windows 有界验收，但这仍不证明普通新用户能顺利完成首配；no Project / invalid Bundle 等路径本轮没有现场制造。

### 最大产品缺口

1. **Review 不满意时缺少中间道路。** 现在可以整项或逐块接受/拒绝，但缺少就地编辑文字、并排打开证据、写反馈再生成。
2. **Wiki 不满意时纠错成本高。** 缺少普通用户能理解的版本、差异、撤销和受控修订。
3. **来源入口仍不统一。** 文件夹在 Studio、单个 Vault 文件在 Chat、Chat 回答又从消息动作进入；安全逻辑合理，信息架构却不自然。
4. **Knowledge Draft 不自动继承可信出处。** 用户仍需自行补书名、章节、页码或原文定位；普通 Chat 的引用不能假装成 Knowledge provenance。
5. **价值尚未被长期数据证明。** 测试证明“不乱写”的能力很强，但尚未证明四周后确实减少重复阅读、重复提问和模型费用。

## 项目经理视角：交付纪律强，产品化和维护风险已超过核心实现风险

### 当前交付成熟度

项目已经有较强的工程治理：清楚的作用域、持久队列、事务边界、恢复语义、回归测试、真实 Windows 有界验收和诚实的支持声明。核心风险已不再是“能不能写出安全 Runtime”，而是“能否把复杂底座变成普通用户可持续使用的产品”。

### 仍需显式管理的风险

| 风险                       | 影响                                                                                                                                                                 | 管理动作                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 长期维护自定义 fork        | 上游 Copilot 演进时，Knowledge 大改动面可能产生合并和回归成本                                                                                                        | 固定上游同步节奏；每次同步先跑核心门禁和 Windows 冒烟，不边开发边追上游。 |
| 与官方插件共享安装身份     | 官方更新或重新安装可能覆盖自定义构建                                                                                                                                 | 明确备份、版本标识、部署和恢复步骤；发布前验证升级/回退。                 |
| 关键知识集中在当前维护者   | Runtime、Bundle、三条路径和验收流程学习成本高                                                                                                                        | 用 TODO、手册、架构边界和可重复验收脚本降低单点依赖。                     |
| 支持范围窄                 | Windows、单人、单 Bundle、单 sourceRoot 之外容易被误认为也受支持                                                                                                     | 在 UI、文档和发布说明保持同一边界，不用自动化测试冒充平台承诺。           |
| 真实交互门禁未全部关闭     | 物理 folder picker、不同字节冲突、非空 folder Review/Apply、物理右键提示和完整 Golden Flow 仍可能暴露集成问题                                                        | 保持 pending，按真实 UI 顺序逐项收口并保存最小证据。                      |
| 模型配置与网络是独立故障域 | 三卡 readiness 已分开 Chat 与 Knowledge 的本地配置状态；Windows 已证明 Chat 缺 Key 不阻断 Knowledge，但 **Configured locally** 仍不能证明 Key 有效、服务可达或有额度 | 若真实用户仍需要，再把主动 Test connection 作为单独、明示联网切片评估。   |
| 没有纵向使用数据           | 无法判断复杂度、成本和维护投入是否真正换来复用                                                                                                                       | 先跑 20 个真实来源、4 周日志，再决定扩面。                                |

### 项目 Gate

在以下事实成立前，不建议宣布公开 GA：

- 完整 Golden Flow 由用户从导入到再次查询走通；
- 所有剩余物理 Windows 交互门禁关闭，或被明确降级为非发布项；
- 至少一轮上游合并、插件升级和回退被验证；
- 20 个真实来源跑满 4 周，得到成本、Review 质量和复用率基线；
- 未授权写入、静默覆盖和不可恢复数据损坏保持为 0。

## 用户体验官视角：可信，但仍需要用户先理解系统

### 分段体验评分

| 用户旅程                |   评分 | 主要感受                                                                         |
| ----------------------- | -----: | -------------------------------------------------------------------------------- |
| 第一次配置              | 3.5/10 | 三卡已让必需/可选状态可见，但仍要手工完成多个概念；本轮只实测已配置主窗口路径。  |
| Sources / Folder Import | 6.3/10 | 安全边界清楚，但来源入口分散，folder snapshot 与登记 Source 的区别要靠手册解释。 |
| Chat → Knowledge Draft  | 7.8/10 | 编辑、确认、锁定目的地和不直写 Wiki 都符合预期；来源关系仍需手填。               |
| Activity / `no_changes` | 7.5/10 | 中性刷新和“无变化也是成功”已可理解，但阶段和费用仍可更直观。                     |
| Review / Apply          | 5.8/10 | 能整项/逐块审核再写是优势；不满意时仍缺少文字编辑、证据并排和反馈重生成。        |
| Query / Citation / Save | 7.2/10 | 有证据状态和可打开引用很有价值；直接参与综合回答的证据格式仍偏窄。               |
| 删除、恢复与退役        | 7.8/10 | 后果提示、Missing、Check again 和二次确认显著增强安全感。                        |
| 14 篇中文手册           | 8.3/10 | 内容完整且已实际打开验证，但高文档分也反映界面尚未承担足够解释责任。             |

最核心的 UX 矛盾是：**工程信任约 8.8/10，界面自解释约 5/10。** 三卡页已经让 Workspace、Knowledge 模型和可选 Chat 的关系可见，但第一次使用的人仍需要手工理解和完成 Project、Bundle、Sources、Wiki 与 Schema 配置。

因此，下一阶段每新增一个概念，都应先回答：能不能由安全默认值代替？能不能在用户做决定的当下用一句话说明后果？能不能让用户直接修正，而不是退回文件系统或 Schema？

## Copilot Plus：截至 2026-08-12 能确认的官方事实

Copilot Plus 是 Brevilabs LLC 的付费产品，不是 Obsidian 官方产品。按[官方英文定价页](https://www.obsidiancopilot.com/en/pricing)、[Plus 文档](https://www.obsidiancopilot.com/en/docs/copilot-plus)和[服务条款](https://www.obsidiancopilot.com/en/terms)：

- 月付标价为 **USD $14.99/月**；
- 年付为 **USD $139.99/年**，定价页折合 **$11.67/月**；
- 首次购买可在 14 天内申请全额退款；之后取消不退还已付费用；
- 当前英文定价与 Plus 功能文档描述内置模型、Plus embedding、增强/多语言 Vault 搜索、Web/文档 Agent、长期记忆、Projects、YouTube/X、PDF、EPUB 和 50+ 文件类型；
- [Projects 文档](https://www.obsidiancopilot.com/en/docs/projects)描述项目上下文与文档、图片、表格等输入；[Composer 文档](https://www.obsidiancopilot.com/en/docs/composer)描述 Chat 中的笔记/Canvas 修改与 Accept、Reject、Revert；
- 官方说明服务受 monthly token limit 约束，但本次可核验的公开页面**没有给出具体月额度**；不能把“订阅”理解成可无限使用；
- 使用订阅外的第三方模型时，仍可能需要自己的 API Key 并支付模型费用。

### 必须标注的 V4 首页与现有定价/文档信息冲突

截至本次复评，[官方英文首页](https://www.obsidiancopilot.com/en)已经以 Copilot V4 为主要宣传，并出现多 Agent、Symposium、Miyo 等新叙事；但英文定价页和现有 Plus 功能文档仍沿用较早的能力组织与术语，未与首页新叙事完全对齐，[中文定价页](https://www.obsidiancopilot.com/zh/pricing)检查时还呈现与 Copilot 无关的错误模板。由此产生三个结论：

1. **$14.99/月与 $139.99/年**是本次从英文定价页可核验的价格，不自动证明所有 V4 宣传能力已经包含、稳定或对所有账号开放。
2. 多 Agent、Symposium 和 Miyo 的 V4 权益，在本报告中只视为**官方宣传方向**，不计入稳定交付评分。
3. 购买前应在英文定价页、Dashboard 和实际客户端再次核对版本、额度、地区、Beta 状态及退款条件；不要依据中文错误页或首页文案单独决策。

这不是断言 V4 不存在，而是在官方信息尚未完全同步时避免把路线图、营销页面和稳定服务混为一谈。

## 当前 3.3.3 仓库到底包含什么

当前仓库并不包含一套可以自行运营的“官方 Plus 服务”。更准确的边界是：

### 仓库中可见

- 当前 3.3.3 开源客户端中的 Plus UI、许可证调用、Agent、Projects、Composer、Miyo 连接与模型/工具适配代码；
- Agent/ReAct、Projects、Composer、Vault 工具、上下文与 Provider 适配；
- 向 Brevilabs、Miyo 或第三方模型服务发请求的客户端连接和调用适配；
- 本地搜索、Markdown memory 和当前新增的 Personal Knowledge Studio。

### 仓库中不包含

- Brevilabs 托管模型、embedding、Web/文档/视频处理端点的服务端实现；
- Miyo 的完整后端、部署、运营数据和服务能力；
- 账号、付款、许可证签发、官方配额、限流、成本控制和商业运营系统；
- 可证明等同于官网 V4 的多 Agent 编排或 Symposium 服务端；
- 一套可由本仓库独立复刻并合法运营的官方 Plus 后端。

所以，源码能看到“如何调用”不等于拥有“被调用的服务”。本报告不建议复制、规避或逆向实现 Brevilabs 的专有后端。

## 能力对比

| 用户问题   | Personal Knowledge Studio                                     | Copilot Plus（以当前定价和功能文档可核验能力为主）                |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 最主要产物 | 经人工审核、受控 Apply 的长期 Markdown Wiki                   | Chat 回答、Agent 结果、搜索结果和 Composer 笔记修改               |
| 普通对话   | 复用现有 Copilot Chat；Knowledge 不是通用 Chat 替代品         | 核心能力，内置模型降低配置门槛                                    |
| 来源入口   | Vault 内已登记文件、外部文件夹一次性快照、经确认的 Chat Draft | Vault、Web、URL、YouTube/X、PDF、EPUB、Projects 与多类文件        |
| 当前格式   | `.md`、`.markdown`、`.txt`、带文本层 PDF；无 OCR              | 官方宣称 PDF、EPUB 和 50+ 类型，具体依账号、模式与后端            |
| 写入前控制 | durable Review 后才允许 transaction Apply；delete 默认禁用    | Composer 支持 Accept、Reject、Revert，也可由用户选择自动接受编辑  |
| 长期边界   | Sources、Wiki、Schema 分层，普通 Chat 不自动成为事实          | Projects、Vault search 和 memory 支持持续对话，但不是同一发布模型 |
| 查询与证据 | 只查询已接受并复证的知识，区分事实、推断和证据不足            | 搜索范围更广；公开材料未承诺同一套持久证据校验                    |
| 失败与恢复 | 持久 Queue、冲突阻断、Recovery、Missing 隔离和受控退役        | 商业客户端/服务自行处理，不等同于 Knowledge 的事务证明            |
| 平台与维护 | 当前只承诺 Windows、单人、单 Bundle；维护者承担 fork 成本     | 商业产品提供较完整服务面，具体支持和 SLA 以官方为准               |

## 价格、预算与时间价值

| 项目               |   当前金额或假设 | 性质                                                 |
| ------------------ | ---------------: | ---------------------------------------------------- |
| Copilot Plus 月付  |    USD $14.99/月 | 官方英文定价；税费和汇率另计                         |
| Copilot Plus 年付  |   USD $139.99/年 | 官方英文定价；折合 $11.67/月                         |
| Knowledge 常规预算 |  **假设 ¥30/月** | 当前用户愿意接受的 BYOK 预算，不是实测成本或价格承诺 |
| Knowledge 重度预算 | **假设 ¥100/月** | 高频编译/Query 的预算上限假设，不是已证明的平均值    |

判断值不值得，不能只看账单，要把时间也算进去。举例：如果把个人可支配时间暂按 **¥60/小时**估值，那么：

- ¥30/月的模型费每月至少应净节省约 **30 分钟**；
- ¥100/月的模型费每月至少应净节省约 **100 分钟**。

这只是帮助决策的示例，不是给用户时间定价。真正的净节省应扣除配置、等待、Review、纠错和维护 fork 的时间。更有意义的单位是：**每个最终接受的 Wiki 页面成本**、**首次有证据答案所需时间**，以及 **7/30 天后被再次使用的知识比例**。

Plus 订阅费和 Knowledge 的 BYOK 费用彼此独立。组合使用时，总成本是 Plus 订阅 + 第三方模型实际账单，不能把 Plus 内置额度当作当前 Knowledge Compiler 的额度。

## 隐私与数据边界

按[官方隐私政策](https://www.obsidiancopilot.com/en/privacy)，Plus/BYOK/本地模型具有不同数据路线：BYOK 请求按官方说法直接发送给所选第三方；Brevilabs 托管功能会经过其后端和相关提供商；本地模型留在设备。账号、许可证和支付信息则属于商业服务必要数据。具体条款会变化，敏感材料仍应按所选模型、组织规则和最新政策自行判断。

Knowledge 的文件复制、哈希、Runtime、Review、Apply 和 PDF 文本提取尽量在本机完成；Compiler 与有合格证据的 Query 会把必要上下文发送到当前配置的模型路线。普通 Chat、Plus 和 Knowledge 可能选择不同模型，不能因为 Vault 文件在本地，就假定每次推理也在本地。详见[隐私与安全](privacy-and-security.md)。

## Build / Reuse / Don't clone

### Build：继续建设差异化核心

- Review 中的证据侧栏、候选就地编辑、带反馈重生成；
- Wiki 版本、差异、撤销和受控修订；
- 在已完成的三卡 readiness 基础上，补充安全默认 Bundle/Schema 和分步首配，不把自动写配置混入当前只读页；
- 统一的 Source 入口，同时保留不同来源的明确后果提示；
- Knowledge Draft 的显式原始材料绑定，不伪造 provenance；
- 本地成本、耗时、`no_changes` 和长期复用视图；
- 在真实需求证明后，扩展 PDF/文本参与综合证据的能力。

### Reuse：用成熟能力完成探索

- 继续复用现有 Copilot Chat、Provider、Projects、上下文和 Composer 基础；
- 需要 Web、YouTube/X、宽格式和通用 Agent 时，优先评估 Plus 或其他成熟服务；
- 保持 BYOK/DeepSeek/本地模型可替换，并记录真实费用；
- 复用 Obsidian 的 Markdown、链接、文件历史和备份体验。

### Don't clone：现在不应复制

- Brevilabs/Miyo 的托管模型、embedding、许可证、计费、Web 和内容转换后端；
- V4 多 Agent、Symposium 或另一个通用自主 Agent；
- 50+ 格式云转换平台、URL/浏览器入口、OCR 和 Explorer 单文件入口；
- Graph、多用户、全平台适配和复杂商业系统；
- 任何绕过 Review、让普通 Chat 自动写入长期 Wiki 的捷径。

## 下一阶段优先级

### P1：先把“会用、能改、可撤销”做好

1. Review 就地编辑、打开证据、反馈重生成；
2. Wiki 版本/差异/撤销；
3. Studio 内统一 Source 入口，并解释文件夹快照、Vault 文件和 Chat Draft 的差别；
4. Knowledge Draft 显式关联原始材料；
5. 用真实首次配置观察三卡是否仍需安全默认 Bundle/Schema 和分步首配；
6. 以 20 个真实来源跑满 4 周并记录本地指标。

### P2：在基线之后改善效率

- 更友好的草稿文件名与中文 UI；
- 模型调用的费用/耗时预估和实际账单对照；
- 更多证据格式参与 grounded answer；
- 有历史保护的受控“重新启用已退役来源”。

### 暂缓

URL、OCR、Explorer 单文件、完整 Graph、多 Agent、多人和跨平台继续后置。只有真实四周数据表明它们阻塞核心任务，才重新排序。

## 20 个来源、4 周验证方案

所有记录可以保存在本地，不要求引入产品遥测。

| 指标                    | 要回答的问题                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Activation              | 从配置到第一个 Source、第一个 Apply、第一个 grounded Query，是否能独立完成？           |
| Time to grounded answer | 从登记来源到得到可打开证据的答案，需要多少时间和操作？                                 |
| Reading → Draft         | Chat 理解完成后，到确认 Knowledge Draft 花多久，在哪一步放弃？                         |
| Compile outcome         | `durable no_changes`、`awaiting_review`、failed/cancelled 各占多少？                   |
| Review disposition      | 非空提案有多少 exact accept、逐块选择、reject？有多少因缺少编辑/重生成而转到外部修改？ |
| Evidence coverage       | Supported、Partial、Insufficient evidence 各占多少？格式限制损失多少问题？             |
| Citation success        | 引用是否真正打开正确 Markdown 位置或 PDF 页？                                          |
| 7/30-day reuse          | 已 Apply 知识后来是否被 Query、创作、链接或新提案再次使用？                            |
| Cost per accepted page  | 每个最终接受页面消耗多少请求、token、人民币和人工时间？                                |
| Safety                  | 未授权写入、静默覆盖和不可恢复数据损坏必须保持为 0。                                   |

第一轮先建立基线，不人为编造漂亮阈值。四周后作一次明确决策：

- 若有稳定复用、成本在预算内、主要痛点集中于 Review/回滚，则继续投入 P1；
- 若大量来源长期停在 Activity/Review、几乎没有 7/30 天复用，则先简化流程，不扩功能；
- 若多数价值来自 Web、视频、宽格式和即时任务，而不是可信 Wiki，则把预算转给 Plus/成熟服务；
- 若出现任何未授权写入或不可恢复损坏，立即停止扩面，优先修安全门禁。

## 给当前用户的直接建议

- **你现在可以正式使用 Knowledge Studio。** 建议从少量、重要、可回到原文的资料开始，保持备份，并继续把它视为你亲自维护的个人生产系统。
- **要走 Chat → Knowledge Draft，仍须先配置并验证一个可用的 Chat 模型。** 本轮 Windows 验收从已保存的完整回复进入，没有证明当时缺少 API Key 的 Chat provider 能现场生成新回答。
- **如果主要目标是长期可信 Wiki，暂时不需要为了它购买 Plus。** 先用 ¥30/月预算假设跑四周，看真实成本与复用。
- **如果主要需要 Web、YouTube/X、宽格式、通用 Agent 或免配模型，Plus 值得试用评估。** 但购买前先核对 V4 实际权益和额度；14 天退款只给验证窗口，不代表之后可随时退款。
- **两者都需要时，最佳分工是 Plus/Chat 负责探索，Knowledge Studio 负责经核对后的发布。** 不要把流畅回答直接当作 Source fact。
- **当前最值得开发的不是复制 Plus，而是让 Review 可修、Wiki 可撤销、首配可理解。**

## 证据与延伸阅读

- [Personal Knowledge Studio 中文手册](index.md)
- [隐私与安全](privacy-and-security.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [Review 与 Apply](review-and-apply.md)
- [Copilot 官方英文首页（V4 宣传）](https://www.obsidiancopilot.com/en)
- [Copilot Plus 官方英文定价](https://www.obsidiancopilot.com/en/pricing)
- [Copilot Plus 官方说明](https://www.obsidiancopilot.com/en/docs/copilot-plus)
- [Projects 官方说明](https://www.obsidiancopilot.com/en/docs/projects)
- [Composer 官方说明](https://www.obsidiancopilot.com/en/docs/composer)
- [Brevilabs 隐私政策](https://www.obsidiancopilot.com/en/privacy)
- [Brevilabs 服务条款](https://www.obsidiancopilot.com/en/terms)
