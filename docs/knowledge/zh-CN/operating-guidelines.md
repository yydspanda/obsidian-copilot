# 长期使用规范

> 目标：让知识价值增长得比维护负担快，同时保留证据、审核和恢复能力。

## 本页目标

这不是一组强制分类法，而是一套长期运行原则。你的主题结构、页面命名和输出语言应该写进 Schema；本手册只规定来源、生成内容和人工决策之间的责任边界。

## 三层所有权

| 层      | 所有者                  | 应该怎样维护                                                                                            | 不应该怎样维护                                                     |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Sources | 你与受限的导入/保存流程 | Chat 注册 user-managed 文件；Folder Import 创建可有意更新的 managed snapshot；Save 创建内容寻址 capture | 不要把 API Key 或临时模型草稿当来源；不要编辑 Save-to-Wiki capture |
| Wiki    | 系统生成、你审核        | 通过 Review/Apply 累积主题页和综合结论                                                                  | 不要让模型绕过 Review 直接写入                                     |
| Schema  | 你                      | 定义语言、目录、页面与证据约定                                                                          | 不要频繁无版本地改变全局规则                                       |

文件夹导入后，外部原件保持不变；Vault 内 managed copy 成为当前来源记录。它不是持续同步关系。

## 建立一个可持续的节奏

### 1. 小批量摄入

初期建议一次导入一个主题文件夹或少量相关资料，然后观察 Activity 和 Review。这样更容易：

- 判断 Schema 是否把页面放到正确位置。
- 看清新资料与旧结论的关系。
- 发现模型是否把推断误写成事实。
- 控制 DeepSeek 请求量和审核负担。

系统支持较大的批次，但技术上能导入不等于认知上适合一次审核。

### 2. 审核后再继续扩展

一个批次出现 Review 时，先处理它，再导入下一个主题。长期积压 Review 会让你难以回忆每个提案的来源和意图。

### 3. 用 Query 驱动知识复利

Query 不只是寻找答案。一个经过证据核对、值得长期保留的 Supported 或 Partial 回答，可以通过 `Save to Wiki` 变成新的 managed source，再进入编译；结果可能是 `no_changes`，也可能进入 Review → Apply。

不要保存每个随手问题。优先沉淀：

- 跨多份资料的比较。
- 反复会用到的决策依据。
- 已标明事实与推断边界的综述。
- 暴露矛盾、空白和下一步研究问题的分析。

## 证据规范

### 事实必须可追溯

重要事实应该指向 Source，而不是只指向另一篇生成 Wiki。Review 时检查引用是否真的支持相应语句。

### 事实与推断分开

- **Source fact**：来源直接表达、且引用能定位的内容。
- **Inference**：在多个事实基础上推导出的判断。

不要因为推断听起来合理就把它改写成没有限定词的事实。

### 矛盾不应被静默抹平

当来源冲突时，优先保留：

- 各自的主张和来源。
- 时间、版本或适用范围差异。
- 当前仍无法判断的部分。

让 Schema 指定矛盾呈现方式，不要硬编码某一领域的裁决规则。

## Schema 变更规范

Schema 是编译行为的一部分。即使 Source 字节没变，修改 Schema 也会改变下一代 pipeline fingerprint；但当前 watcher 不监听 Schema 文件本身，单纯保存 Schema 不会立即建立新的编译代次。

每次修改 Schema 应该：

1. 先备份或 Git 提交当前 Sources、Wiki 和 Schema。
2. 一次只改变一类规则，例如目录结构或证据呈现格式。
3. 确认没有 `Applying` 或 `Finalizing`，然后保存 Schema。
4. 禁用再启用 Copilot，或完整重启 Obsidian；只刷新/重开 Studio 不足以使 Schema 新字节生效。
5. 重新打开 Studio，观察 Activity，不要立即继续批量导入。
6. 审核所有新提案，确认不是意外的大范围重排。
7. 稳定后再提交一个版本。

**禁止**把“自动接受所有内容”“忽略引用校验”之类权限要求写进 Schema。Schema 只能指导内容与组织方式，不能提升模型写权限。

## 文件操作规范

- 应该在 Obsidian 内维护 Sources，以便 watcher 及时观察变化。
- 已注册 Source 不要随意移动、改大小写或删除；误删后只把文件恢复到 `Sources` 显示的精确原路径，再点 `Check again`。
- 永久停止跟踪时，在 `Sources` 使用二次确认的 `Remove`。它不会删除来源文件或既有 Wiki，但会撤销该来源的 provenance 和未来摄入/审核/引用权限，并保留身份与路径，防止静默重新注册；该操作已有自动化覆盖，并已用一次性来源通过 Windows 二次确认现场验收。
- 当前没有从任意新路径替换来源或撤销退役的入口；不要编辑 Manifest/Runtime 绕过这个边界。
- Wiki 的正常变更应该来自 Review/Apply。
- 如果必须手工修正 Wiki，先确认没有 Apply/Finalizing，并预期系统会把它视为外部变化。
- Windows 路径只使用 Vault 相对路径和 `/`；不要制造仅大小写不同的目录或文件。
- 不在 sourceRoot、wikiRoot 和 schemaRef 之间创建重叠或 junction。

## 命名和组织规范

手册不规定固定的“领域/实体/主题”目录，因为不同知识库需要不同结构。你应该在 Schema 中明确：

- 页面标题和文件名语言。
- 主题页、实体页、综述页的最低结构。
- 引用、推断、矛盾和更新时间怎样表示。
- 索引页或日志页是否需要更新。
- 当前禁止模型生成 Markdown/Wiki 链接、URL/裸 URI、电子邮件地址或原始 HTML 标签；等 projected link resolver 明确启用后，再在 Schema 中定义链接约定。

规则应该普适、可解释，避免为某一篇资料写特殊例外。

### Schema 不能覆盖的当前生成契约

你可以自定义目录、页面类型和内容结构，但必须保留这些 production 硬约束：

- 所有生成目标必须是 `.md`。
- 除 `index.md`、`log.md` 外的普通知识页必须有 YAML frontmatter，并包含非空字符串 `type`；可以按 Schema 增加其他 JSON-compatible 字段。
- 任意 `index.md` 的 frontmatter 只能包含 `okfVersion`；只有 Bundle 根目录的 `index.md` 可以声明 `okfVersion: "0.1"`，嵌套 `index.md` 不得声明版本。
- 任意 `log.md` 都不得有 frontmatter。
- 当前仍禁止生成 Markdown/Wiki 链接、URL/裸 URI、电子邮件地址、原始 HTML 标签和 delete。

如果 Schema 忘记这些规则，模型提案会在确定性 candidate validation 阶段失败；系统不会自动修复一个违反契约的页面。

## 审核检查清单

提交 Review 前至少检查：

- [ ] 目标路径属于 wikiRoot，且符合 Schema。
- [ ] 新事实能从 Source 引用中核对。
- [ ] 推断明确标为推断。
- [ ] 没有把旧结论无说明地覆盖掉。
- [ ] 候选没有当前不支持的 Markdown/Wiki 链接、URL/裸 URI、电子邮件地址或原始 HTML 标签；`Links: valid` 在本阶段表示未生成这些内容。
- [ ] 没有把密码、令牌或个人敏感内容扩散到 Wiki。
- [ ] 更新没有删除仍由其他来源支撑的共享内容。

## 高风险主题

医疗、法律、财务、安全和其他高风险结论必须回到原始来源核对。Knowledge Studio 提供的是证据组织和可追溯生成，不替代专业判断，也不能保证外部资料本身正确。

## 备份节奏

最低建议：

- 每次 Schema 变更前后各一次。
- 每个重要 Review/Apply 批次后一次。
- 定期做整个 Vault 的离线备份。
- 偶尔实际恢复到另一个目录，确认备份可用。

## 你应该看到什么

健康的知识库应该表现为：

- Sources 保持原始证据角色。
- Wiki 的重要结论都能追溯来源。
- Review 数量可管理，而不是永久堆积。
- `no_changes` 经常出现，说明系统能识别无需重复改写的输入。
- Query 的 Insufficient evidence 会暴露资料空白，而不是编造答案。
- Schema 的变化可从版本历史解释。

## 数据、网络与费用影响

小批量、先审核后继续的节奏能降低不必要的模型调用和返工。按上述步骤重启运行代后，Schema 变化会改变 pipeline fingerprint，并可能使来源重新进入编译，因此不要把试验性规则直接应用到大型日常 Bundle。

## 相关页面

- [Bundle 配置](bundle-configuration.md)
- [Review 与 Apply](review-and-apply.md)
- [Query、引用与 Save to Wiki](query-and-writeback.md)
- [维护与恢复](maintenance-and-recovery.md)
- [隐私与安全](privacy-and-security.md)
