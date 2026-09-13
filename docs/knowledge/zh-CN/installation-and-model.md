# 安装、升级与 DeepSeek V4

> 适用范围：Windows Obsidian Desktop、个人使用、当前定制版 Copilot、DeepSeek V4。Knowledge Studio 不是上游社区版现成包含的功能。

## 目标

安装或升级当前定制版插件，安全保存 DeepSeek API Key，并启用一个能被 Knowledge Compiler 使用的 DeepSeek V4 模型。

完成本页后，你应该能在命令面板中找到 **Open Knowledge Studio**，在当前 BYOK / Quick Chat 设置中启用 `deepseek-flash`，并在 Project 的 `project.md` 中为 Knowledge 绑定这个模型。

## 前置条件

- Windows 上的 Obsidian Desktop，版本不低于 `1.11.4`。
- 一个已经打开过的 Obsidian Vault。
- 当前项目构建出的定制版插件包，其中至少包含 `main.js`、`manifest.json` 和 `styles.css`。
- 一个可用的 DeepSeek API Key，并已在 DeepSeek 账户中开通相应 API 用量。
- 开始前备份 Vault。升级已有插件时还应保护插件目录中的 `data.json`：旧安装若仍使用标准磁盘存储，它可能含明文 API Key。新版首次启动会先备份这些凭证，再从 `data.json` 中移除；原文件和凭证备份都必须作为密钥材料加密并限制访问。

本手册不要求 Copilot Plus 订阅。Knowledge Compiler 当前直接使用你自己的 DeepSeek API Key；Copilot Plus 是原项目的另一组功能和服务。

## 操作步骤

### 1. 安装当前定制版

如果这个 Vault 已经能打开 Knowledge Studio，可以跳到“2. 添加 DeepSeek provider 并保存 API Key”。否则：

1. 在 Obsidian 中打开 **设置 → 第三方插件（Community plugins）**，关闭受限模式。
2. 如果已有名为 **Copilot** 的插件，先将它停用。
3. 把同一次构建得到的下列三个文件放入 Vault 的插件目录：

   ```text
   <Vault>\.obsidian\plugins\copilot\
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. 升级时只替换发布包中的插件文件。不要用空文件覆盖 `data.json`，也不要删除 Obsidian Keychain 中已有的密钥。旧标准存储的 `data.json` 可能包含明文 Key，禁止把它上传到公开仓库或普通网盘。
5. 回到 **设置 → 第三方插件**，启用 **Copilot**。必要时重启 Obsidian。
6. 按 `Ctrl+P` 打开命令面板，搜索并运行 **Open Knowledge Studio**。Windows 左侧功能区也应该出现书库图标入口。

这个定制版与上游 Copilot 使用相同的插件 ID `copilot`，因此不能在同一个 Vault 中与上游社区版并存。通过社区插件商店更新上游版本，可能会覆盖当前定制版；升级前必须确认安装包来源和版本。

#### 从 WSL 源码构建个人版

在 WSL 终端进入当前项目的源码目录后，执行：

```bash
COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build
```

这仍然生成一个插件、一个 `main.js`，保留生产压缩和许可证信息；只是把本次构建的体积预算设为严格小于 10,000,000 字节。它不会安装插件、重载 Obsidian 或改变设置。省略这个开关时，构建仍要求严格小于 5,000,000 字节；当前定制版超过这个默认预算时，构建失败是预期结果。

数值只填写正整数的字节数，不要写 `10MB`、小数或留空。这个写法只影响当前命令；不要把它长期导出到整个终端环境或默认发布 CI。

体积预算不是运行流畅度保证，构建通过后仍需实机验收。超过 5 MB 的插件文件不要依赖 Obsidian Sync 标准套餐同步到另一台设备，可在各设备单独安装。Sync Plus 的单文件上限为 200 MB；这是 Obsidian 的同步服务，与 Copilot Plus 无关，本地安装不要求购买它。详见 [Obsidian 官方同步限制](https://obsidian.md/help/sync/plans)。

### 2. 添加 DeepSeek provider 并保存 API Key

1. 打开 **设置 → Copilot → BYOK**。
2. 点击 **Add a provider**，选择 **DeepSeek**。
3. 在 **API key** 中粘贴密钥。保留 DeepSeek 的默认 **Base URL**；Knowledge 不接受自定义 endpoint。
4. 在 **Models** 中选择 `deepseek-flash`。可以先点击 **Test** 验证密钥并刷新模型列表；如果服务没有返回列表，在 **Model ID** 中手工输入 `deepseek-flash` 并点击 **Add**。
5. 点击 **Save**。
6. 新安装默认使用 Obsidian Keychain。升级仍在 `data.json` 中保存密钥的旧安装时，插件首次启动会先创建凭证备份，再从 `data.json` 中移除密钥，并显示备份路径；请在 **BYOK** 中重新输入 DeepSeek Key。确认新 Key 可用后，安全删除该凭证备份。**Advanced → API Key Storage** 只显示 Keychain 状态并提供 **Delete All Keys**，没有手工迁移按钮。

不要把 API Key 写进 Vault 笔记、Schema、`project.md`、截图或本手册。仓库中的 `.env.test` 只用于自动化集成测试，运行中的 Obsidian 插件不会把它当作用户设置；实机使用必须通过 **BYOK** 配置。

### 3. 在 Quick Chat 模型列表中确认启用

1. 打开 **设置 → Copilot → Basic**。
2. 在 **Agents** 区域选择 **Quick Chat**。
3. 在 **Quick Chat models** 中确认刚添加的 `deepseek-flash` 已启用。BYOK 新模型默认会启用，但这里仍是 Knowledge 读取已配置模型的列表。
4. **Default model** 只决定普通 Quick Chat 新对话的默认值；可按需选择，不会代替下一步的 Knowledge Project 绑定。

当前 Knowledge 路径只向 DeepSeek 官方端点发送规范模型名 `deepseek-flash`。已有 Vault 如果仍保存旧 Flash 名称 `deepseek-v4-flash`，可以继续使用：插件只把这个兼容名称规范化为 `deepseek-flash` 后再发送请求，不会切换 provider 或其他模型。新的 Project 应按下一节直接绑定 `deepseek-flash`，不必先创建旧名称。

`deepseek-v4-pro` 已不再受支持，会在发出 provider 请求前停止。根据 [DeepSeek 模型更新](https://api-docs.deepseek.com/updates/)，该名称将由服务端转到 Flash；提前停止可以避免这个变化成为静默降级。旧的 `deepseek-chat`、`deepseek-reasoner` 仍作为已退役记录保留，也不会自动改成当前模型。

| 模型             | Knowledge 思考设置 | 首次使用建议                           |
| ---------------- | ------------------ | -------------------------------------- |
| `deepseek-flash` | Minimal            | 保留默认参数，适合作为最简单的首次配置 |

High 或 XHigh 思考模式下，Temperature 和 Top P 不会作为采样参数发送；Frequency Penalty 当前不受直接 DeepSeek 模型支持。自定义 DeepSeek-compatible endpoint 仍可在普通 Chat 中保留自己的模型名称，但不能用于只接受官方端点的 Knowledge 路径；插件不会把自定义端点的模型名改成 `deepseek-flash`。

### 4. 让 Project 使用这个模型

Knowledge Compiler 读取的是拥有 Bundle 的 Project 中单独保存的 Knowledge 模型绑定，而不是 Quick Chat 的 **Default model**。当前 Agent Project 本身跟随每个对话选择的模型，因此新建 / 编辑弹窗不再显示旧版 **Default Model**。请按当前界面和兼容 frontmatter 配置：

1. 从功能区打开 **Agent Chat**，或在命令面板运行 **Open Copilot Agent Chat Window**。
2. 在 Agent Chat 首页打开 **Projects**，选择 **New project**，输入名称后点击 **Create**。
3. 创建后选择 **Leave project** 返回首页；在 Project 列表中使用 **Reveal in vault**，打开该 Project 文件夹中的 `project.md`，并切换到源码模式。
4. 保留已有 frontmatter，把其中现有的 `copilot-project-model-key` 值改为以下内容；只有该字段确实不存在时才在同一个 `---` 块中加入，不要保留两个同名字段：

   ```yaml
   copilot-project-model-key: deepseek-flash|deepseek
   ```

5. 保存文件。已有 Project 如果仍是 `deepseek-v4-flash|deepseek`，可以继续使用，不必手工改写。

下一步在这个 Project 的 `project.md` 中加入 Bundle 配置，详见 [Bundle 配置](bundle-configuration.md)。

### 5. 用 Setup & status 核对三条独立状态

运行 **Open Knowledge Studio**。配置未完成时，Studio 会直接显示引导页；已经就绪时，可点击 Studio 右上角 **Setup & status** 再打开。

这里故意分成三张卡：

- `Workspace` 检查 Project、Bundle 和本地持久环境。
- `Knowledge model` 检查 Project 为 Knowledge 单独选择的模型、受支持配置和凭证存在性。
- `Chat model (optional)` 检查当前普通 Chat 模型。它与 Knowledge 模型相互独立，未配置不会阻断 Knowledge 主流程。

如果你还没完成 Bundle 配置，`Workspace` 显示 **Needs setup**、`Knowledge model` 显示等待上一步是正常的。卡片会提供打开现有 Chat、Copilot 设置、Project 文件或 Schema 等安全入口；它不会创建目录、Schema、Project 或 Key，也不会改写 `project.md` 中的 Bundle YAML。

配置完成后的 **Configured locally** 只证明本机设置能够通过当前预检，不证明 API Key 真能登录、账户有余额、DeepSeek 在线或网络可达。真正的联网验证仍发生在你明确启动 Chat、来源编译或 Query 等在线工作时。

## 预期结果

- **设置 → Copilot → BYOK** 中已有官方 DeepSeek provider 和 `deepseek-flash`，并且 **Basic → Agents → Quick Chat** 的 **Quick Chat models** 中已启用它。
- Project 的 `project.md` 中有 `copilot-project-model-key: deepseek-flash|deepseek`，或已有 Vault 继续使用兼容的 `deepseek-v4-flash|deepseek`。
- 命令面板能找到 **Open Knowledge Studio**。
- 尚未配置 Bundle 时，打开 Studio 会显示三卡引导页，`Workspace` 提示先完成 Project / Bundle；这不是模型服务失败。
- 完成 Bundle 后，`Workspace` 与 `Knowledge model` 应显示 **Configured locally**；`Chat model (optional)` 单独反映普通 Chat，不决定 Knowledge 是否可用。
- 仅打开 Studio 或查看三卡状态不会测试 API，也不会产生模型费用。真正的模型网络验证发生在来源进入后台编译、运行 Chat 或执行有证据 Query 后。

## 如果结果不同

### 找不到 Open Knowledge Studio

- 确认使用的是当前定制版，而不是社区插件商店中的上游版本。
- 检查插件目录是否同时存在同一构建的 `main.js`、`manifest.json` 和 `styles.css`。
- 在第三方插件设置中停用再启用 Copilot，或重启 Obsidian。
- Knowledge Studio 只在 Windows Desktop 注册界面入口；移动端和其他桌面系统当前不支持。

### 找不到 DeepSeek V4 模型

- 在 **BYOK** 中重新打开 DeepSeek provider，填写 **API key** 后点击 **Test**；如果模型列表仍为空，在 **Model ID** 中手工输入 `deepseek-flash`，点击 **Add**，再点击 **Save**。
- 到 **Basic → Agents → Quick Chat**，确认 **Quick Chat models** 中已启用这个模型。
- 不要把 SiliconFlow 的 DeepSeek V3/R1 或 OpenAI-compatible 自定义模型当成当前 Knowledge 模型。
- 如果只看到已退役的 `deepseek-chat`、`deepseek-reasoner` 或不再受支持的 `deepseek-v4-pro`，必须在 DeepSeek provider 中明确添加 `deepseek-flash`。

### Knowledge model 仍显示 Needs setup

- 在源码模式检查 Project 的 `project.md`，确认 `copilot-project-model-key` 是 `deepseek-flash|deepseek`，或已有兼容值 `deepseek-v4-flash|deepseek`。
- 确认 BYOK 中只有一个能够匹配该绑定的官方 DeepSeek provider，并且模型已在 **Quick Chat models** 中启用。
- 保存 `project.md` 后等待 Studio 自动刷新。不要把自定义 endpoint 的同名模型当成官方 DeepSeek 绑定。

### 首次后台编译提示凭证或模型不可用

- 回到 **BYOK**，编辑 DeepSeek provider，重新保存 **API key**；需要时先点击 **Test**。
- 检查 DeepSeek 账户余额、API 权限和网络连接。
- 检查 `project.md` 绑定的是 `deepseek-flash|deepseek` 或已有的兼容 Flash 配置，不是 `deepseek-v4-pro` 或默认 Chat 中的另一个模型。
- 保留 Flash 默认参数后重试失败任务；不要反复导入同一文件来绕过配置错误。

更多状态对应关系见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 安装插件、保存 Bundle、打开 Studio、查看三卡状态、启动恢复检查和配置预检都在本地完成；这些被动检查不调用模型，也不向模型 provider 发请求。
- 点击卡片中的 **Open Copilot settings** 会进入插件已有的设置页；该页面可能触发插件版本更新检查。它仍不等于 DeepSeek 连通性测试，也不能让 **Configured locally** 变成“在线可用”的证明。
- API Key 应保存在 Obsidian Keychain。它不会写入 Knowledge 的提示词、Review 记录、日志或持久 Runtime 文件。
- 启用模型本身不等于发起 Knowledge 编译。展开在线模型导入、执行模型验证、运行 Chat 或处理来源时，可能产生网络请求。
- 每个成功进入完整编译的来源通常会发出两次 DeepSeek 请求：一次分析、一次生成。
- Query 在有合格证据时另发一次 DeepSeek 请求；没有合格证据时返回 **Insufficient evidence**，不调用模型。
- 编译时，来源正文、Schema 规则和完成任务所需的既有 Wiki 内容会发送给 DeepSeek，并按你的 DeepSeek 账户计费。详见 [隐私与安全](privacy-and-security.md)。

## 相关页面

- [中文使用手册首页](index.md)
- [15 分钟快速开始](quick-start.md)
- [Bundle 配置](bundle-configuration.md)
- [隐私与安全](privacy-and-security.md)
- [故障排查](troubleshooting.md)
