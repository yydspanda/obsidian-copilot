# Bundle 配置

> 适用范围：Windows Obsidian Desktop、个人使用、一个有效的 Knowledge Bundle、一个 `sourceRoot`、DeepSeek V4。虽然字段名是复数 `sourceRoots`，当前可用范围只配置一个条目。

## 目标

在 Vault 中建立 Sources、Wiki、Schema 三层目录，并把唯一的 Knowledge Bundle 绑定到一个 Project。完成后，Knowledge Studio 应显示真实 Bundle ID，并连接持久 Activity、Review 和 Query 能力。

## 前置条件

- 已按 [安装、升级与 DeepSeek V4](installation-and-model.md) 启用一个 DeepSeek V4 模型。
- 已备份 Vault。
- 当前只准备启用一个个人知识库 Bundle。
- 你可以在 Obsidian 中编辑 Markdown 源文件和 YAML frontmatter。

如果 Vault 中已经存在多个 Project，可以保留它们；但当前只有一个 Project 可以包含 `copilot-project-knowledge-bundle`。多 Bundle 选择器尚未接通。

## 操作步骤

### 1. 规划三个互不重叠的位置

以下路径只是可直接照用的首次配置示例，不是程序硬编码目录：

```text
Sources/Personal                 原始来源根目录
Wiki/Personal                    审核后生成的 Wiki 根目录
Knowledge/Schemas/personal.md    你维护的规则文件
```

在 Obsidian 文件浏览器中创建：

1. `Sources/Personal` 文件夹。
2. `Wiki/Personal` 文件夹。
3. `Knowledge/Schemas` 文件夹。
4. `Knowledge/Schemas/personal.md` 笔记。

Schema 必须是非空、严格 UTF-8 的普通文件，最多 1,000,000 bytes。不要使用 GBK/ANSI 编码，也不要把二进制文件改名成 `.md`。

当前 Windows Apply 要求新页面的父文件夹已经存在。首次配置应让 Schema 只生成 Wiki 根目录下的平级页面；以后如果要求生成 `Wiki/Personal/Topics/example.md`，必须先创建 `Wiki/Personal/Topics`。

### 2. 写入一个保守的首次 Schema

把以下内容写入 `Knowledge/Schemas/personal.md`。这是用户规则，不是密钥文件；以后可以按自己的知识领域逐步调整。

```markdown
# Personal Knowledge Schema

## 目的

把来源中的明确事实、决定和定义整理为可审核的个人 Wiki。

## 当前页面约定

- 有明确、受来源支持的新事实时，创建或更新 Wiki 根目录下的 `facts.md`。
- `facts.md` 必须使用 YAML frontmatter，并包含 `type: knowledge`。
- 可以维护根目录下的 `index.md`；如使用 frontmatter，只允许 `okfVersion: "0.1"`。
- 可以维护根目录下的 `log.md`；`log.md` 不使用 frontmatter。
- 只写有来源证据支持的事实；推断必须明确标成推断。
- 保留冲突信息，不要为了统一而删除相反证据。
- 当前生成内容不要包含 Wiki 链接、Markdown 链接、URL/裸 URI、电子邮件地址或原始 HTML 标签。
- 不提出删除文件。
```

这份 Schema 刻意使用平级文件，避免首次 Apply 因嵌套父目录不存在而阻断。当前生成校验还不接受 Markdown/Wiki 链接、URL/裸 URI、电子邮件地址或原始 HTML 标签；不要在 Schema 中要求这些内容，直到相应能力明确开放。

### 3. 创建拥有 Bundle 的 Project

1. 从功能区打开 **Agent Chat**，或在命令面板运行 **Open Copilot Agent Chat Window**。
2. 在 Agent Chat 首页打开 **Projects**，选择 **New project**。
3. 输入名称，例如“Personal Knowledge”，然后点击 **Create**。
4. 创建后选择 **Leave project** 返回首页；在 Project 列表中使用 **Reveal in vault**，打开该 Project 文件夹中的 `project.md`，并切换到源码模式。
5. 把已有 frontmatter 中的 `copilot-project-model-key` 值改为 `deepseek-flash|deepseek`；只有该字段不存在时才加入，不要保留两个同名字段。已有 Project 如果仍保存 `deepseek-v4-flash|deepseek`，可以继续使用，不必手工改写。
6. 保存 `project.md`。

默认情况下，Project 配置位于：

```text
copilot/projects/<Project 文件夹>/project.md
```

如果你的 Copilot 使用了自定义 Projects 根目录，应在那个目录下查找对应 Project 的 `project.md`，不要另外创建第二份同名配置。

### 4. 把 Bundle 块加入 project.md

1. 打开刚创建 Project 的 `project.md`。
2. 切换到源码模式，找到文件开头由 `---` 包围的 YAML frontmatter。
3. 保留已有的 Project 字段，只在同一个 frontmatter 中加入下面这一块：

   ```yaml
   copilot-project-knowledge-bundle:
     version: 1
     id: personal
     sourceRoots:
       - Sources/Personal
     wikiRoot: Wiki/Personal
     schemaRef: Knowledge/Schemas/personal.md
     reviewMode: always
   ```

4. 保存文件。

这个对象只接受示例中出现的六个字段，不接受额外字段。`reviewMode` 可以解析 `always`、`multi_file` 或 `trusted_generated_only`，但当前都不会授权自动写入；个人首次配置必须使用最清楚的 `always`。

### 5. 等待自动重新验证

保存 Project 或修改模型设置后，插件会撤销旧的 Knowledge 运行代并自动重新验证，不要求手动重载插件。

1. 等待数秒，让 Projects 刷新。
2. 运行 **Open Knowledge Studio**。
3. 检查顶部 Bundle ID 是否为 `personal`。
4. 检查页面不再显示 **Knowledge Studio unavailable**。如果仍显示，阅读其正文：未配置时会包含 `No project has a Knowledge Bundle configuration...`，配置无效时会包含 `A project Knowledge Bundle configuration is invalid...`，workflow 未就绪时会包含 `live workflow adapter is unavailable`。
5. 检查 Activity 能读取持久队列，Review 和 Query 页签可打开。

如果 Studio 显示 Recovery 提示，应先按 [维护与恢复](maintenance-and-recovery.md) 处理，不要通过修改私有运行文件跳过它。

## 字段参考

| 字段          | 作用                                       | 当前建议                                  |
| ------------- | ------------------------------------------ | ----------------------------------------- |
| `version`     | Bundle 配置契约版本                        | 必须为数字 `1`                            |
| `id`          | 持久 Bundle 身份                           | 使用稳定、非空、不会再复用的名称          |
| `sourceRoots` | 允许注册和读取来源的 Vault 相对目录列表    | 当前必须只写一个目录                      |
| `wikiRoot`    | 系统经 Review/Apply 后可以写入的 Wiki 边界 | 与 Sources、Schema 完全分开               |
| `schemaRef`   | 规则文件的 Vault 相对路径                  | 指向一个实际存在的 Markdown 文件          |
| `reviewMode`  | 审核策略声明                               | 当前使用 `always`；任何值都不会自动 Apply |

## 路径规则

所有 Bundle 路径必须是使用 `/` 的规范 Vault 相对路径：

- 必须写 `Sources/Personal`，不能写 Windows 绝对路径或 `Sources\Personal`。
- 禁止盘符、UNC 路径、开头 `/`、`.`、`..`、空路径和 Windows 保留名称。
- Sources 不能与 Wiki 相同，也不能互为父子目录。
- Schema 不能位于 Wiki 内。
- Windows 路径比较不区分大小写，因此 `Sources/Personal` 与 `sources/personal` 会冲突。
- Bundle ID 在所有 Project 中必须唯一。
- 当前只有一个 Bundle 能进入可用状态；不要在第二个 Project 中复制 Bundle 块。

Sources、Wiki 和 Schema 的精确拼写也是持久配置的一部分。不要只改变路径大小写来“整理”目录；应先备份并按照迁移计划处理。

## 预期结果

- Studio 顶部显示 `personal` 或你设置的真实 Bundle ID。
- 能看到持久 revision，而不是占位 revision。
- Activity、Review 和 Query 已连接；空队列、空 Review 都可以是正常初始状态。
- `Sources/Personal`、`Wiki/Personal` 和 Schema 都仍由你在 Vault 中直接看到和备份。
- 到此为止不应产生 DeepSeek 请求或费用。

## 如果结果不同

| 提示或现象                                               | 常见原因                                                                                             | 处理方式                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `No project has a Knowledge Bundle configuration...`     | Bundle 块不在被 Projects 识别的 `project.md`，或字段名拼错                                           | 确认配置位于当前 Projects 根目录下一层 Project 的 `project.md` frontmatter |
| `A project Knowledge Bundle configuration is invalid...` | 多余字段、路径不规范、目录重叠、Schema 位于 Wiki、大小写冲突                                         | 对照本页六字段示例和路径规则逐项修正                                       |
| 多 Bundle 或没有选中的 Bundle                            | 多个 Project 都含 Bundle 配置                                                                        | 当前只保留一个 Bundle 块                                                   |
| 模型配置不可用                                           | Project 未绑定受支持的 Flash、绑定了不再支持的 `deepseek-v4-pro`、模型未启用、密钥缺失或参数不受支持 | 回到 [安装、升级与 DeepSeek V4](installation-and-model.md) 检查            |
| Schema 无法读取                                          | `schemaRef` 拼写与实际文件不同，或它指向文件夹                                                       | 创建/移动正确文件，并保持大小写完全一致                                    |
| Apply 提示父目录不存在                                   | Schema 要求了尚未创建的嵌套 Wiki 路径                                                                | 先创建目标父文件夹，再从 Review 重试合格操作                               |
| Studio 要求 Recovery                                     | 上次有持久事务或队列状态尚未收敛                                                                     | 使用 Recovery 提供的有限操作，不要手改运行文件                             |

修改 Bundle 后仍无变化时，先确认 `project.md` 已保存，再关闭并重新打开 Studio。修改 Project/Bundle 或模型设置会使插件自动重建运行代；只修改 `schemaRef` 指向文件的内容则不会被 watcher 直接观察。在没有 `Applying`/`Finalizing` 时禁用再启用 Copilot，或完整重启 Obsidian，让新 Schema 字节进入下一代 fingerprint。完整排查见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 创建目录、编辑 Schema、保存 Project 和 Bundle 验证都在本地完成。
- 启动预检和恢复 Gate 不调用 DeepSeek。
- Schema 会在每次获授权的编译中发送给 DeepSeek；不要在其中放 API Key、密码、私密令牌或与知识整理无关的敏感信息。
- 修改 Bundle 路径、Project 模型或设置会触发运行代重建；修改 Schema 内容后需要安全地禁用/启用插件或重启 Obsidian。新一代会改变处理指纹，已有来源可能重新编译，并产生新的 DeepSeek 请求和费用。
- Wiki 只有在你明确接受 Review 并执行 Apply 后才会改变；`reviewMode` 不会绕过这个步骤。

## 相关页面

- [中文使用手册首页](index.md)
- [安装、升级与 DeepSeek V4](installation-and-model.md)
- [15 分钟快速开始](quick-start.md)
- [知识来源与导入](sources-and-import.md)
- [Knowledge Studio 与 Activity](knowledge-studio.md)
- [Review 与 Apply](review-and-apply.md)
- [隐私与安全](privacy-and-security.md)
- [参考手册](reference.md)
