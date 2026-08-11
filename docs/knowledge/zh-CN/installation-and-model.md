# 安装、升级与 DeepSeek V4

> 适用范围：Windows Obsidian Desktop、个人使用、当前定制版 Copilot、DeepSeek V4。Knowledge Studio 不是上游社区版现成包含的功能。

## 目标

安装或升级当前定制版插件，安全保存 DeepSeek API Key，并启用一个能被 Knowledge Compiler 使用的 DeepSeek V4 模型。

完成本页后，你应该能在命令面板中找到 **Open Knowledge Studio**，并能在新建 Project 时选择 `deepseek-v4-flash` 或 `deepseek-v4-pro`。

## 前置条件

- Windows 上的 Obsidian Desktop，版本不低于 `1.11.4`。
- 一个已经打开过的 Obsidian Vault。
- 当前项目构建出的定制版插件包，其中至少包含 `main.js`、`manifest.json` 和 `styles.css`。
- 一个可用的 DeepSeek API Key，并已在 DeepSeek 账户中开通相应 API 用量。
- 开始前备份 Vault。升级已有插件时还应保护插件目录中的 `data.json`：旧安装若仍使用标准磁盘存储，它可能含明文 API Key，应该先迁移到 Obsidian Keychain；无法先迁移时，必须把备份当作密钥材料加密并限制访问。

本手册不要求 Copilot Plus 订阅。Knowledge Compiler 当前直接使用你自己的 DeepSeek API Key；Copilot Plus 是原项目的另一组功能和服务。

## 操作步骤

### 1. 安装当前定制版

如果这个 Vault 已经能打开 Knowledge Studio，可以跳到“2. 配置 DeepSeek API Key”。否则：

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

### 2. 配置 DeepSeek API Key

1. 打开 **设置 → Copilot → Basic**。
2. 在 **API Keys** 一栏点击 **Set Keys**。
3. 找到 **DeepSeek**，粘贴 API Key。
4. 关闭密钥窗口。
5. 新安装默认使用 Obsidian Keychain。旧安装如果仍使用标准存储，可在 **设置 → Copilot → Advanced → API Key Storage** 中迁移到 **Obsidian Keychain**。

不要把 API Key 写进 Vault 笔记、Schema、`project.md`、截图或本手册。仓库中的 `.env.test` 只用于自动化集成测试，运行中的 Obsidian 插件不会把它当作用户设置；实机使用必须通过 **Set Keys** 配置。

### 3. 启用受支持的 DeepSeek V4 模型

1. 打开 **设置 → Copilot → Model**。
2. 在 **Chat Models** 中找到以下至少一个内置模型：
   - `deepseek-v4-flash`
   - `deepseek-v4-pro`
3. 勾选该模型的 **Enabled**。
4. 如果列表中没有这两个模型，先使用 **Chat Models** 标题旁的刷新按钮恢复当前内置模型目录，再查找一次。
5. 第一次使用建议保留内置参数，不要复制模型后改名，也不要给它填写自定义 Base URL。

当前 Knowledge 路径只接受 DeepSeek 官方端点和上面两个精确模型名。旧的 `deepseek-chat`、`deepseek-reasoner` 会作为已退役记录保留，但不会自动改成 V4，也不能用于 Knowledge Compiler。

| 模型                | 内置思考设置 | 首次使用建议                            |
| ------------------- | ------------ | --------------------------------------- |
| `deepseek-v4-flash` | Minimal      | 保留内置参数，适合作为最简单的首次配置  |
| `deepseek-v4-pro`   | High         | 保持 Temperature 为 `0`，不要设置 Top P |

High 或 XHigh 思考模式下，Temperature 和 Top P 不会作为采样参数发送；Frequency Penalty 当前不受直接 DeepSeek 模型支持。不要为了“兼容”而改用旧模型名或自定义端点，Knowledge 会直接停止而不是静默降级。

### 4. 让 Project 使用这个模型

Knowledge Compiler 读取的是拥有 Bundle 的 Project 所选模型，而不是 **Default Chat Model**。创建或编辑 Project 时：

1. 在 Chat 顶部把模式切换到 **Projects (alpha)**。
2. 新建或编辑准备承载个人知识库的 Project。
3. 在 **Default Model** 中选择刚启用的 DeepSeek V4 模型并保存。

下一步在这个 Project 的 `project.md` 中加入 Bundle 配置，详见 [Bundle 配置](bundle-configuration.md)。

## 预期结果

- **设置 → Copilot → Model** 中至少有一个已启用的 DeepSeek V4 模型。
- 新建或编辑 Project 时，**Default Model** 列表能选中该模型。
- 命令面板能找到 **Open Knowledge Studio**。
- 打开 Studio 后可能暂时显示 **Knowledge Studio unavailable**，正文为 `No project has a Knowledge Bundle configuration...`；在尚未配置 Bundle 时，这是正确结果。
- 仅打开 Studio 不会测试 API，也不会产生模型费用。真正的网络验证发生在来源进入后台编译后。

## 如果结果不同

### 找不到 Open Knowledge Studio

- 确认使用的是当前定制版，而不是社区插件商店中的上游版本。
- 检查插件目录是否同时存在同一构建的 `main.js`、`manifest.json` 和 `styles.css`。
- 在第三方插件设置中停用再启用 Copilot，或重启 Obsidian。
- Knowledge Studio 只在 Windows Desktop 注册界面入口；移动端和其他桌面系统当前不支持。

### 找不到 DeepSeek V4 模型

- 在 **Model → Chat Models** 中刷新内置模型。
- 不要把 SiliconFlow 的 DeepSeek V3/R1 或 OpenAI-compatible 自定义模型当成当前 Knowledge 模型。
- 如果只看到 `deepseek-chat` 或 `deepseek-reasoner`，它们是退役记录；必须明确选择 V4。

### Project 的模型列表中没有 DeepSeek V4

- 确认模型已勾选 **Enabled**。
- 确认模型仍是内置的直接 DeepSeek 记录；当前两个 V4 内置模型支持 Project。
- 重新打开 Project 编辑窗口，让列表读取最新设置。

### 首次后台编译提示凭证或模型不可用

- 回到 **Basic → Set Keys** 重新保存 DeepSeek API Key。
- 检查 DeepSeek 账户余额、API 权限和网络连接。
- 检查 Project 选择的是精确的 V4 模型，不是默认 Chat 中的另一个模型。
- 保留 V4 内置参数后重试失败任务；不要反复导入同一文件来绕过配置错误。

更多状态对应关系见 [故障排查](troubleshooting.md)。

## 数据、网络与费用

- 安装插件、保存 Bundle、打开 Studio、启动恢复检查和配置预检都在本地完成，预检不调用 DeepSeek。
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
