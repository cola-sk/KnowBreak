# AGENTS.md

Instructions and guidelines for AI coding agents working with the KnowBreak codebase.

---

## 一、项目是什么 (Project Overview)

**KnowBreak（知点拆解局）** 是一款基于 Python 的知识二创短视频生产流水线。它能够将长视频（讲座/科普/访谈）或手工给定的主题（Topic）提炼为原创的短视频选题、口播脚本、画面分镜、资源清单，并自动通过免版权图库、TTS 语音合成与视频渲染合成（Compose）生成完整的 MP4 短视频。

*   **核心价值**：不搬运原视频，仅提取长视频中的知识点进行二次创作。
*   **技术栈**：
    *   **核心后端**：Python (uv, Pydantic, Typer, Jinja2, Pytest, Pillow 等)
    *   **Web 审核后台**：Next.js + TailwindCSS + React（提供二创流程的可视化与审核编辑界面）
    *   **多媒体处理**：yt-dlp, FFmpeg, faster-whisper

---

## 二、项目目录结构 (Project Directory Structure)

```text
KnowBreak/
├── knowbreak/                  # Python 核心流水线实现
│   ├── stages/                 # 各流水线阶段的具体执行代码（asr, extract, script, compose 等）
│   ├── cli.py                  # 命令行接口 (Typer)
│   ├── pipeline.py             # 流水线执行调度器
│   └── workflow.py             # Workflow 的解析与加载
├── profiles/                   # 视频内容风格包
│   └── serious_science/        # 严肃科普风格（默认）
│       ├── profile.toml        # 视频版式、颜色、字号等参数
│       ├── workflows/          # 通用 workflow；主题绑定 workflow 放在 workflows/topics/
│       └── prompts/            # 通用 prompt；主题专属 prompt 放在 prompts/topics/
├── app/                        # Next.js 页面与审核后台 (可视化交互系统)
├── tests/                      # 单元测试与集成测试
└── pyproject.toml              # 依赖与 Python 环境配置 (uv 管理)
```

---

## 三、开发工作流与规范 (Workflow & Development Guidelines)

### 3.1 运行测试
每次修改核心 Python 代码或配置解析后，**必须**运行测试以确保系统稳定性：
```bash
uv run pytest
```

### 3.2 运行流水线
可以使用如下命令测试特定的 Workflow：
```bash
uv run knowbreak run "manual:_placeholder" --workflow <workflow_name>
```
主题绑定 workflow 位于 `workflows/topics/` 时，CLI 名称也必须带上子目录：
```bash
uv run knowbreak run "manual:_placeholder" --workflow topics/<topic_slug>
```

---

## 四、Prompt 与 Workflow 的设计与组织规范 (Prompt & Workflow Customization Rules)

当有新的短视频主题或特定风格需要定制 Prompt 或 Workflow 时，必须按照以下规范执行，以避免通用文件夹被特定主题的文件污染。

### 4.1 目录组织结构
*   **通用模版 / 流水线定义**：
    *   Workflow 文件直接存放于 `profiles/<profile_name>/workflows/` 下（如 `topic_seed.toml`）。
    *   通用 Prompt 文件直接存放于 `profiles/<profile_name>/prompts/` 下（如 `script.md`）。
*   **特定主题 / 定制化配置**：
    *   主题 Workflow 存放于：`profiles/<profile_name>/workflows/topics/<topic_slug>.toml`
    *   主题 Prompt 存放于：`profiles/<profile_name>/prompts/topics/<topic_slug>/<stage>.md`
    *   `topic_slug` 使用稳定的英文/拼音小写命名（如 `ming_plague`），Workflow 文件名、Prompt 目录名和 TOML 中引用的 prompt 路径必须保持一致。
    *   主题 Workflow 的 CLI 调用名是 `topics/<topic_slug>`，例如 `--workflow topics/ming_plague`。
    *   *示例*：
        *   `profiles/serious_science/workflows/topics/ming_plague.toml`
        *   `profiles/serious_science/prompts/topics/ming_plague/script.md`

### 4.2 Workflow 与 Prompt 引用规则
*   Workflow TOML 中的 `prompt` 必须使用相对 profile 根目录的路径，例如 `prompts/topics/ming_plague/script.md`。
*   CLI 的 `--workflow` 参数按 `profiles/<profile_name>/workflows/` 下的相对文件路径解析；TOML 内的 `id` 主要用于 `workflow_plan.json` 追溯，不决定加载路径。
*   修改或新增 prompt 覆写后，必须确认该路径真实存在；路径不存在时，当前运行逻辑可能把路径字符串本身当作 prompt 内容传给 LLM。
*   通用 workflow 放在 `workflows/` 根目录；只有与具体主题强绑定、包含固定 `topic` / `hook` / `angle` / 史实护栏的 workflow 才放入 `workflows/topics/`。
*   主题 workflow 优先只覆写必要 stage 的 prompt，例如只覆写 `script`，其余阶段沿用 profile 标准 prompt，避免无意义复制。

### 4.3 定制决策 Checklist
在处理新的选题或定制要求时，AI Agent **必须**按照以下三步进行评估和决策：

1.  **判断是否需要定制 (Custom vs. Standard)**：
    *   **能用标准则用标准**：判断当前选题是否可以直接使用现有的标准通用 Prompt 进行生成。如果可以直接达到高质量要求，**严禁新建定制 Prompt**。
    *   **必须定制的场景**：只有当选题存在**强绑定的史实护栏、特定的考证锚点（例如明朝鼠疫的具体年份和数字限制）、特殊的叙事禁忌，或必须要覆盖的内容事实**时，才创建该主题专用的 Prompt 覆写。
2.  **按规范结构进行存放 (Structured Storage)**：
    *   若决定需要定制，必须将配置文件与 Prompt 存放在 `topics/` 子目录下，并在 Workflow TOML 中正确引用该路径。
3.  **评估并沉淀为标准化流程 (Template Consolidation)**：
    *   在定制主题流程后，评估这一工作流或 Prompt 逻辑**是否可以被泛化**。
    *   如果其逻辑可以应用于其他同类选题（例如，抽象出一种“大事件分析”的结构，或者“争议话题辟谣”的模式），应该将其中与具体主题绑定的参数、史实抽离为变量/参数。
    *   将其作为**标准化 Workflow** 沉淀在 `workflows/` 根目录下，以供后续一键复用。
