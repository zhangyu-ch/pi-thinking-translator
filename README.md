# pi-thinking-translator

Pi 编码助手插件：当指定模型（默认自动加入本地所有 Gemini / DeepSeek 系列模型，支持多选）输出英文思维链（Thinking）时，自动调用指定翻译模型（默认 `magpie/group/ds-flash`，思考等级 `low`）将其翻译为中文，并在对应思维链正下方实时展示中文译文。

## 功能特点

- **仅显示本地可用模型并自动匹配**：模型列表从本地 Pi Agent 已配置的可用模型（`ctx.modelRegistry.getAvailable()`）获取，模型名称包含 `gemini`、`ds` 或 `deepseek` 的模型会自动进入需要翻译的源模型列表，也可通过交互界面或命令自由勾选/取消。
- **逐段流式并行翻译**：将长思维链按段落（自动保留代码块与标题结构）拆分，在主模型思考过程中每完成一段即刻后台发起 `magpie/group/ds-flash (low)` 流式翻译，并在**每一段英文下方直接紧跟对应的中文译文**，避免长段合并导致难以对照阅读。
- **不污染上下文**：基于 `pi.registerMarkdownTransformer` (`assistant-thinking`) 渲染层注入译文，不修改原始 `AssistantMessage` 与 `thinkingSignature`，不消耗后续多轮对话上下文 Token。
- **会话持久化缓存**：翻译结果自动写入当前会话分支的自定义条目，`/reload`、`/resume` 或 `/tree` 切换分支时无需重复请求翻译。

## 安装方式

### 1. 通过 GitHub 安装

```bash
pi install git:github.com/zhangyu-ch/pi-thinking-translator
```

### 2. 通过本地路径安装

```bash
pi install "E:/0-AI/0-Pi-agent配置/0-谷歌思维链翻译/pi-thinking-translator"
```

## 使用与配置

在 Pi 交互终端中输入：

```text
/thinking-translate
```

即可打开交互式配置面板（支持输入关键词搜索模型、使用 `Enter` / `Space` 多选源模型、修改翻译模型及思考等级）。

### 命令行快捷子命令

- `/thinking-translate status` — 查看当前插件状态与配置
- `/thinking-translate on` / `/thinking-translate off` — 开启 / 关闭自动翻译
- `/thinking-translate add <provider/model>` — 添加需要翻译思维链的源模型
- `/thinking-translate remove <provider/model>` — 移除源模型
- `/thinking-translate translator <provider/model> [thinkingLevel]` — 设置翻译模型与思考等级（如 `magpie/group/ds-flash low`）

配置文件持久化保存在 `~/.pi/agent/thinking-translator.json`。
