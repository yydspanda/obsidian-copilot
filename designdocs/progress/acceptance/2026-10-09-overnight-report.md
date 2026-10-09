# 2026-10-09 夜间回归报告

Task ID: `PK-H3-OVERNIGHT-REGRESSION`

状态：本轮回归与证据核对完成。测试通过不等于全部产品效果通过。

## 当前结论

全量自动化测试通过；已有知识的真实 Query、引用回原文、Save 登记和暂停保护通过。
但“新材料或新心得稳定形成有用 Wiki”的端到端验收仍没有通过。本轮新材料只产生
`analysis_no_targets`，没有提案，因而没有伪造 Review/Apply 的通过记录。

现有第十三章 Wiki 能说明章节主要内容，但之前补充的个人方法没有进入整理结果。
本轮只读排查确认输入完整，没有把该问题改称传输丢失，也没有反复重跑刷结果。
可以继续把 Chat/Query 当作需要核对来源的阅读助手；不能把 Knowledge 的 Completed
或 No Wiki changes 当作“已经吸收全部重要内容”。

本轮只操作 `Obsidian-Copilot-Management-Test`，保留原笔记和历史，不操作其他库或远端
`master`。本轮把新增真实模型请求上限定为 8 次；受控原生流程记录到 2 次后关闭额度，
没有重试。最初提前中断的未隔离 Jest 命令没有请求级计量，不能证明它从未发起付费调用，
因此不把“已记录 2 次”声称为所有进程的精确总数。付费套件现需显式 opt-in，最终全量
命令没有路径排除。此前已关闭的复测额度没有复用。

## 版本与环境

- 开发分支：`knowledge-h3-personal-flow`，开始时 HEAD `8b0445f210c07f2e99494d9a613bc5696750c3b1`。
- 当前部署生产代码：`3d2666dc1577c80dfdda7669d352323ef6972b03`。
- 已合入 upstream：`996a088c59a2ae123852d8e542f354b1eba72cee`。
- Windows 加载标签：`4.0.9+dev.3d2666dc.clean.393233961281`。
- main.js SHA-256：`efe7fa38399cbd5157a2c99a248035b355b882d503b5d89e636c34fd3d089859`。
- WSL：Node `24.14.0`、npm `11.9.0`。
- Windows `10.0.26200`，AMD Ryzen 7 5800H，16 逻辑核，68,564,348,928 字节 RAM；Electron `43.1.1`、Node `24.18.0`、Chromium `150.0.7871.114`。模型运行在远端。

## 今夜自动化结果

| 检查                         | 当前证据                                                                                       | 结论                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 最终默认全量 Jest            | 744/744 suites；10,981 passed、4 skipped、0 failed；371.819 秒                                 | 通过，无路径排除                           |
| 格式与 lint                  | `npm run format && npm run lint` 退出 0；0 errors / 9 warnings                                 | 通过，警告保留                             |
| 生产构建                     | 修复后退出 0，无 Go deadlock；main.js、styles.css 与原部署字节相同                             | 通过                                       |
| 产物语法与 mobile-load smoke | 两项通过                                                                                       | 仅加载测试，不等于真机移动端验收           |
| Obsidian review              | 基线和最终复查全部阶段退出 0；依赖审计 0 critical / 1 high / 3 moderate                        | 保留警告和安全风险                         |
| 治理检查                     | 20 项治理测试及 progress:check 通过                                                            | 单指针、任务登记、实验字段有效             |
| 暂停时审核 Apply             | 3 个定向场景通过，完整 suite 也包含于最终全量                                                  | 仅自动化；本轮没有有效新提案可做原生 Apply |
| upstream 漂移                | GitHub 比较：120 ahead / 125 behind，最新 canonical `25635116a20891ded2d86988e2305542806ccc23` | 超出仓库漂移阈值；没有擅自合并             |

最终完整命令：

```bash
env -u COPILOT_RUN_LIVE_DEEPSEEK_TESTS npm test -- --maxWorkers=2 --json --outputFile=.git/acceptance/overnight-20261009/jest-final-default.json
COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build
npm run format && npm run lint
node --check main.js
node scripts/mobile-load-smoke.cjs
npm run test:project-governance
npm run progress:check
npm_config_registry=https://registry.npmjs.org npm run review:obsidian
```

4 项跳过分别是 2 项未显式启用的付费集成测试、1 项 Windows-only npm-layout
测试，以及 1 项需要本地提供归档文件的可选 smoke。它们没有伪装成通过。
最终 Jest 仍有 34 条 React `act()` 警告和一个 worker 强制退出/未关闭资源警告；没有
断言失败或重试。尚未定位该测试清理警告的具体资源，不能据此断言插件存在运行时泄漏。

第一轮离线基线为 742 suites / 10,972 passed / 2 skipped；它明确排除付费文件。
最终默认全量增加了修复的 9 项规格，并安全跳过 2 项付费案例。原始第一次未隔离付费
套件的命令提前中断，不计入任何通过数。首次基线出现的 Console Ninja 注入噪音在最终
全量未出现；日志保留，没有修改用户的调试工具或 node_modules。

## Windows 真实操作结果

| 场景                    | 操作与结果                                                                                       | 验收边界                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Setup/status            | 原生打开、刷新、返回；Project、Knowledge model、Chat model 本地配置均就绪                        | 本地就绪不证明全部服务都可调用                                            |
| Activity                | 原生显示暂停、旧历史与 no-changes 详细结果；单材料确认后 Not now；Reanalyze 后 Cancel reanalysis | 没有恢复全队列或误取消旧任务                                              |
| Sources/Review/空 Query | 来源 Ready；Review 明确无待审；空查询 Search 禁用                                                | 没有伪造提案来测试 Apply                                                  |
| Add materials           | 搜索并选择一份单独标注的合成材料；未勾快照同意时 Add 禁用，勾选后生成副本并登记                  | 原件与副本哈希一致，未自动恢复队列                                        |
| Run only this material  | 仅新材料 attempt 1；记录 7 个支持性 claim–evidence 关联，目标关联为 0                            | `analysis_no_targets`；没有 generation/Review/Apply，端到端内容生成不通过 |
| 真实 Query              | 查询第十章研究与表达的材料区别；得到 3 条 Source fact，与原文含义一致                            | 证明这个问题的回答，不推广到全部问题或模型                                |
| 引用导航                | 点击答案引用，打开准确的第十章受管理副本；source mode 选中 4,997 字符；回 Studio 保留答案        | 选区由本轮 UI 直接观察；不是阅读模式所有布局验收                          |
| Save to Wiki            | 填标题后点击一次；登记一份不可变材料和一个待处理任务，显示成功，表单清空                         | Save 本身未新增模型请求或 Wiki 写入；待处理任务继续暂停                   |
| Chat                    | 从 Setup 打开 Quick Chat，看到单独的 Flash 选择器及禁用的空发送按钮                              | 没有新 Chat/Agent 回复、重新生成或完整历史操作实测                        |
| 空闲 reload             | 前后各一次实例重载；最后恢复 native fetch 并去掉临时计量器，Studio ready                         | 队列暂停及原数据保留；不是断电、崩溃或完整系统重启                        |

Add 的取消检查中，测试驱动因多个按钮都叫 Cancel 而拒绝点击；这是安全的驱动歧义，
不是插件点击失败。没有误点其他任务，也不把该次取消/重新选择的 consent-reset 场景
记为原生通过。该行为仍有自动化规格。

两次已计量的原生请求均发往 `https://api.deepseek.com/chat/completions`，请求和响应模型身份均为
`deepseek-v4-pro`，temperature 0.1、max_tokens 6000、thinking disabled、非流式 JSON。
分析耗时 6,904 ms、4,371 tokens；Query 耗时 2,785 ms、10,665 tokens，合计 15,036 tokens。
这是响应计量，不包含完整 UI 刷新耗时，也不是费用报价。没有自动重试、请求拦截命中或
人工放行超时。精确 config/data/system/request hashes 见[实验 002、003](../experiments/2026-10.md#experiment-exp-20261009-002)。

## 数据保留核对

227 个原有文件/链接中，226 个字节完全相同，只有普通 `debug.log` 更新；没有删除原件。
新增恰好 3 个文件：合成验收材料、它的受管理副本，以及 Query 保存产生的不可变材料。
所有原 Wiki 都没变，92 个设置全部相同。4 份旧 Review、2 条 Apply ledger、4 个旧
Manifest entry 和全部 Forward 状态均保持原值。

19 个旧 job 身份和状态保留；16 个终态记录完全相同。另 3 个旧 pending job 仍为
attempt 0，仅因正常重新观察更新 inputRevision/updatedAt。最终共 21 个 job：新增合成
材料完成、Save 材料排队；旧的 3 个排队任务没有运行。最终无 pending Review、rerun 或
active transaction；原 user pause 时间 `1791128571149` 精确保留。

最终 runtime SHA-256：`d038bb5e8f34d34223addfb908fb298db79bcededba977d59831ea6c69c75dcf`。
Runtime 本身因新增记录和观察更新而变化，不能宣称整个文件 byte-identical。

## 已处理与已定位的问题

### 暂停队列和手动 Apply 的文档矛盾

英文指南两处误称暂停会阻止全部 Review/Apply，可能让用户为了应用已审核提案而恢复其他
排队工作。文档已改为：用户主动暂停时，明确审核后的 Apply 仍可执行，其他材料继续暂停；
限流、恢复、待确认提交或正在执行的单材料任务等阻断条件仍有效。插件行为未改动。

### 全量测试可能意外产生模型费用

真实 DeepSeek 集成套件此前会自动加载 `.env.test`，仅凭存在密钥就发请求。最初全量命令
在测试输出出现前被停止，改为明确排除该套件；不能把中断命令算为通过。现已加入
`COPILOT_RUN_LIVE_DEEPSEEK_TESTS=1` 显式开关；未打开时连 host process/.env.test 都不读取。
六项 mocked 安全规格、两项默认付费跳过和最终普通全量均通过。旧行为用隔离假进程做
RED 复现，未读取真实密钥或联网。见 [issue #21](https://github.com/yydspanda/obsidian-copilot/issues/21)。

### 构建产物正确，但退出阶段打印 Go deadlock

基线构建退出码是 0、产物有效，却出现 esbuild 子进程关闭异常。隔离复现确认强制
`process.exit(0)` 可在 service ping 未结束时留下死锁日志；等待 context 释放后未复现。
生产入口只改为 `try/finally` 等待 `context.dispose()`，开发 watch 不变；成功、失败、
watch 三项回归 RED/GREEN 通过，真实构建干净退出，main.js 和 styles.css 哈希均未变。

这次只动了一个 upstream-owned 构建入口的 7 行新增/2 行删除，没有改上游插件业务代码、
加新抽象或调整包体门槛。原因是已复现的退出生命周期缺陷，而不是为整洁做重构。
见 [issue #22](https://github.com/yydspanda/obsidian-copilot/issues/22)。

### 第十三章增量遗漏：输入完整，但分析未选取新增内容

只读重建生产输入得到 29 条 evidence，哈希逐项匹配最近原生运行的 receipt，全部 locator
验证通过，拼接完整还原 9,140 字符。遗漏的个人方法独立占 159 字符，未被合并进 HTML
大段，也没有预算截断；它在分析结果中有 0 个 supporting claim 和 0 个 target claim。

这能定位本次遗漏发生在模型的分析选择阶段，但不足以证明任何通用代码修复有效。因此
不把 HTML 切分较粗当作已证实根因，不新增验证层，也不修改提示词。最近一次原生运行的
23,289 ms、identical write 1 属于紧接本轮之前的独立授权记录，未重复计成本轮新实验。
完整记录见[核心含义验收](./2026-10-08-core-clarity.md#october-9-user-delegated-native-use)。

## 完整覆盖边界

| 功能面                                   | 今夜确定的证据                                         | 仍未证明的部分                                                 |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Chat / Agent / Projects / 历史 / Context | 相关全部自动化套件通过；原生 Quick Chat 打开           | 新联网 Chat/Agent 回复、项目切换后的真实长会话                 |
| Setup / Add / 源文件与快照               | 相关自动化与本轮原生 Add、来源核对                     | 本轮未做全新 Bundle 首配；首次配置为历史实测                   |
| Folder import / PDF / watcher            | 当前全量的解析、预算、导入、freshness 规格通过         | 物理系统文件选择器、整批 PDF 真实模型整理                      |
| 单材料运行 / 暂停 / 取消 / reanalysis    | 当前全量及原生确认、取消、限定运行、暂停保留           | 不证明模型一定会产出有用目标                                   |
| Review / 编辑 / 拒绝 / Apply             | 当前全量，包括用户暂停时明确 Apply 的用例              | 本轮无非空新提案，未重新执行 Windows Apply；以前的通过只算历史 |
| 冲突 / Recovery / 原子写入               | 当前全量验证实际文件字节、Manifest、ledger、恢复与幂等 | Windows 瞬时 junction 替换、断电、磁盘满、双实例并发矩阵       |
| Query / 引用 / Save                      | 本轮真实 Pro Query、精确回原文、Save 登记通过          | Save 后的重新编译与新 Review/Apply 未执行                      |
| Forward / effective head                 | 当前全量覆盖                                           | 新链路完整 Windows 原生流程仍有历史未验收项                    |
| 卸载重载 / 移动兼容 / 安全边界           | 原生空闲重载；mobile-load smoke；安全回归与审计        | 真实手机、OneDrive、崩溃恢复、全部提供商与端点；依赖告警未消失 |

本轮没有 React 视觉代码改动，因此没有用新 gallery 截图冒充更多原生覆盖；既有组件
测试包含在全量中。此前 10 月 3 日完整 Review/Apply 与 10 月 8 日局部编译测试均不计作
今夜的原生成功记录。

## 下一步与交付状态

优先处理 Knowledge 的内容选择可靠性，评估产品是否应让用户明确选择要整理的主题，
而不是继续堆提示词或强制所有材料都生成页。这只是后续产品讨论方向，本轮没有新增
这种机制或修改提示词。同步 upstream 需作为单独变更批次，先看差异再验收，不能把
125 个落后提交混进当前已经测试的状态。

本轮两项测试/构建修复和文档澄清已在本地验证；没有 commit/push、合并或重新部署。
无需为构建退出修复重载不同的插件产物，因为新旧产物字节完全相同。测试库最终停在
Studio Activity，队列暂停；新增 Save 材料仍待处理，不会无人值守继续产生费用。

报告把输入/模型边界诊断、实际执行结果和历史证据分开，避免用绿灯数量替代内容审阅。

原始本地日志保存在 `.git/acceptance/overnight-20261009/`；含私有 Vault 状态的快照不提交。
本报告不包含密钥、完整模型请求或个人原文。

记录时点：2026-10-09 01:51（Asia/Shanghai）。review 输出中的两项 manifest error
来自预期失败的门禁自测 fixture，最终 fixture suite 通过；它们不是生产 manifest 失败。

最终全量 JSON SHA-256：`a12ae8f1359bbd84df0c6aa99c18132a99fef2de0bd81441d338aa5156700fde`。
