# KnowBreak

**知点拆解局** —— 知识二创短视频生产流水线。

把一个长视频（讲座/科普/访谈）拆成 3-5 个原创短视频选题，生成口播脚本和画面分镜，最后在 CapCut/PR 里成片。**不搬运原视频**，只用其知识点做二创输入。

## 流水线

```
原视频链接/文件
   │  1. ASR 转写            (asr)
   ▼
全文逐字稿 + 时间戳
   │  2. 知识点提取          (extract)
   ▼
结构化知识点列表
   │  3. 选题拆分            (topics)
   ▼
3-5 个短视频选题（标题/钩子/要点）
   │  4. 口播脚本生成        (script)
   ▼
原创逐字口播脚本（~60-90s）
   │  5. 画面分镜            (storyboard)
   ▼
分镜表（口播/画面描述/B-roll 建议/字幕）
   │  6. 资源清单            (assets) — 配图/PPT/动画/B-roll 候选
   ▼
导出到剪映/PR/CapCut，人工成片 + 合规审核
```

## 安装

```bash
uv sync
```

## 配置

复制 `.env.example` 为 `.env`，填入 API key：

```bash
cp .env.example .env
```

支持任意 OpenAI 兼容端点（OpenAI / DeepSeek / 智谱 GLM / Qwen / Kimi 等）。

## 使用

```bash
# 全流程：从一个视频链接/文件跑到分镜表
knowbreak run https://www.bilibili.com/video/xxx

# 单阶段
knowbreak asr ./input/video.mp4
knowbreak extract ./out/<id>/transcript.json
knowbreak topics ./out/<id>/knowledge.json
knowbreak script ./out/<id>/topics.json
knowbreak storyboard ./out/<id>/scripts.json

# 查看所有产出
knowbreak list
knowbreak show <id>
```

## 项目结构

```
knowbreak/
├── pyproject.toml
├── .env.example
├── knowbreak/
│   ├── cli.py              # 命令行入口
│   ├── config.py           # 配置加载
│   ├── pipeline.py         # 流水线编排
│   ├── models.py           # 数据模型（pydantic）
│   ├── llm.py              # LLM 客户端
│   └── stages/
│       ├── asr.py          # 1. 语音转写
│       ├── extract.py      # 2. 知识点提取
│       ├── topics.py       # 3. 选题拆分
│       ├── script.py       # 4. 口播脚本
│       ├── storyboard.py   # 5. 画面分镜
│       └── assets.py       # 6. 资源清单
├── out/                    # 产出（按 video id 分目录）
└── tests/
```

## 合规边界

- 仅用原视频作为**知识点输入**，不搬运画面/音频片段。
- 每期口播脚本必须为原创表达，不得整段改写原文。
- 引用原视频片段时标注来源，单条不超过合理引用限度。
- 不针对平台审核做规避，只对内容质量与版权负责。
