# KnowBreak

**知点拆解局** —— 知识二创短视频生产流水线。

把一个长视频（讲座/科普/访谈）拆成 3-5 个原创短视频选题，生成口播脚本和画面分镜，最后在 CapCut/PR 里成片。**不搬运原视频**，只用其知识点做二创输入。

## 流水线

```
原视频链接/文件
   │  1. 字幕/ASR 转写       (asr)
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

系统依赖：

```bash
brew install ffmpeg
brew install deno   # YouTube n challenge 求解需要，见下文"下载视频和字幕"
```

`yt-dlp` 会随 `uv sync` 安装在项目虚拟环境里，用于下载字幕和音频。

## 配置

复制 `.env.example` 为 `.env`，填入 API key：

```bash
cp .env.example .env
```

支持任意 OpenAI 兼容端点（OpenAI / DeepSeek / 智谱 GLM / Qwen / Kimi 等）。

最小可用配置：

```bash
KB_LLM_BASE_URL=https://api.deepseek.com/v1
KB_LLM_API_KEY=sk-...
KB_LLM_MODEL=deepseek-chat

KB_ASR_PROVIDER=openai
KB_ASR_MODEL=whisper-1
KB_OUT_DIR=./out
```

如果 ASR 也走 OpenAI 兼容服务，额外配置：

```bash
KB_ASR_BASE_URL=https://api.openai.com/v1
KB_ASR_API_KEY=sk-...
```

## 快速开始

```bash
# 推荐通过 uv run 调用，确保使用项目虚拟环境里的依赖
uv run knowbreak --help

# 全流程：从一个视频链接或本地文件跑到资源清单
uv run knowbreak run https://www.bilibili.com/video/xxx
uv run knowbreak run ./inputs/source.mp4
```

产出会写到：

```text
out/<video_id>/
├── transcript.json     # 字幕/ASR 转写结果
├── knowledge.json      # 知识点提取
├── topics.json         # 短视频选题
├── scripts.json        # 原创口播脚本
├── storyboards.json    # 画面分镜
└── assets.json         # 资源清单
```

断点续跑：

```bash
# 例如 transcript.json 已经生成，只想从知识点提取继续
uv run knowbreak run ./inputs/source.mp4 --from extract
```

单阶段调试：

```bash
uv run knowbreak asr ./inputs/source.mp4
uv run knowbreak extract ./out/<id>/transcript.json
uv run knowbreak topics ./out/<id>/knowledge.json
uv run knowbreak script ./out/<id>/topics.json
uv run knowbreak storyboard ./out/<id>/scripts.json
uv run knowbreak assets ./out/<id>/storyboards.json

uv run knowbreak list
uv run knowbreak show <id>
uv run knowbreak show <id> --stage script
```

## 下载视频和字幕

`asr` 阶段的策略是“字幕优先，找不到字幕才转写音频”：

1. 本地输入：如果传入 `./inputs/source.mp4`，会先找同名字幕文件，例如 `source.srt`、`source.vtt`、`source.zh-Hans.vtt`。
2. 链接输入：如果传入 YouTube / B 站等 URL，会先用 `yt-dlp` 下载中文字幕轨。
3. 字幕不可用：再用 `yt-dlp` 下载音频，转成 `audio.wav`，调用 ASR。

### 方式一：直接用链接

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID"
```

这条命令会自动尝试：

```bash
yt-dlp --skip-download --write-subs --write-auto-subs ...
yt-dlp -f ba ...
```

适合公开视频、未触发平台验证的视频。

### 方式二：用本地视频

如果平台下载被拦，先自己把视频放到 `inputs/`：

```text
inputs/
├── source.mp4
└── source.srt     # 可选；有字幕时会优先用字幕
```

然后执行：

```bash
uv run knowbreak run ./inputs/source.mp4
```

这是最稳定的方式。只要本地文件可被 `ffmpeg` 读取，流程就可以继续。

### 方式三：YouTube 登录态 cookies

YouTube 经常要求登录验证或触发 429，普通 `yt-dlp` 可能失败。项目支持两种 cookies 配置：

```bash
# 优先推荐：导出 cookies.txt 后使用文件
KB_COOKIES_FILE=./cookies.txt

# 备选：直接读取浏览器 cookies
# KB_COOKIES_BROWSER=chrome
```

`KB_COOKIES_FILE` 优先级高于 `KB_COOKIES_BROWSER`。`cookies.txt` 是登录凭证，已经在 `.gitignore` 中排除，不能提交到 git。

#### cookies.txt 导出步骤

1. 在浏览器装扩展 **"Get cookies.txt LOCALLS"**（Chrome/Edge/Firefox 都有）。
2. 浏览器里打开 `https://www.youtube.com`，确认右上角头像是登录账号（不是"登录"按钮）。
3. 在 youtube.com 页面上点扩展图标 → Export，**勾选 "Include HttpOnly cookies"**（必须开，否则拿不到 SID/SAPISID 等登录态 cookie）。
4. 保存为项目根目录的 `cookies.txt`。
5. 导出后**不要再在浏览器里访问 YouTube**（避免触发 cookie 轮换）。
6. 自检（只看名字不打印值）：

```bash
uv run python -c "
logged = ['SID','HSID','SSID','APISID','SAPISID','LOGIN_INFO','__Secure-3PSID','__Secure-3PAPISID']
have = [p.split('\t')[6] for line in open('cookies.txt')
        for p in [line.strip()] if p and not p.startswith('#')
        and len(p.split('\t')) >= 7 and p.split('\t')[6] in logged]
print('登录态 cookie:', have or 'NONE — 文件不可用，重新导出')
"
```

至少有 `SID` 或 `SAPISID` 之一才能用。

#### `--cookies-from-browser` 的局限

`KB_COOKIES_BROWSER=chrome` 能读到 Chrome cookies，但 YouTube 经常返回：

```text
The provided YouTube account cookies are no longer valid.
They have likely been rotated in the browser as a security measure.
```

这是因为 YouTube 检测到浏览器 cookie 被导出并主动轮换失效。遇到这种情况，改用上面导出的 `cookies.txt` 文件方式。

#### YouTube n challenge（JS 挑战）

2025 年起 YouTube 给视频格式加了一道 "n challenge" JS 校验，没有 JS 运行时的 `yt-dlp` 拿不到音视频流，只会报：

```text
n challenge solving failed: Some formats may be missing
ERROR: Requested format is not available
```

项目代码已经自动加了 `--remote-components ejs:github` 参数，让 `yt-dlp` 从 GitHub 下载挑战求解脚本，用本机 Deno 执行。**前提是装了 Deno**（见"安装"小节）。如果还报这个错，检查 `deno --version` 能跑通。

### 手动验证下载

如果想先确认 `yt-dlp` 是否能下载字幕：

```bash
uv run yt-dlp \
  --cookies ./cookies.txt \
  --skip-download \
  --write-subs \
  --write-auto-subs \
  --sub-langs "zh-Hans,zh-CN,zh-Hant,zh,en" \
  --sub-format "vtt/srt/best" \
  -o "out/manual-subtitle" \
  "https://www.youtube.com/watch?v=VIDEO_ID"
```

确认音频下载：

```bash
uv run yt-dlp \
  --cookies ./cookies.txt \
  -f ba \
  -o "out/source.%(ext)s" \
  "https://www.youtube.com/watch?v=VIDEO_ID"
```

## ASR 兼容性

`asr` 阶段调用 OpenAI 兼容的音频转写接口。不同后端实现有差异，代码做了两层兼容：

### 响应格式回退

OpenAI 官方 Whisper 支持 `verbose_json` + `timestamp_granularities=segment`，能返回带时间戳的逐段转写。但部分兼容服务（如 `qwen3-asr`）只支持 `text` 格式。代码会先试 `verbose_json`，遇到 400 错误自动回退到 `text`，并用 `ffprobe` 取整段时长作为单一 segment。

### 分块转写

部分 ASR 服务有单文件大小限制（如 `qwen3-asr` 限 25MB）。一段 25 分钟 16kHz mono wav 大约 48MB，会被拒。代码会按 5 分钟切块（每块约 9.6MB），串行转写后按时间偏移拼接 segment 时间戳。

- 块大小：300 秒，写死在 `knowbreak/stages/asr.py` 的 `chunk_seconds` 常量
- 切块用 `ffmpeg -ss -t`，无损精准
- 每块独立尝试 `verbose_json`，失败的块自动用 `text` 回退
- 中间块文件 `chunk_NNN.wav` 在转写后自动删除

### 推荐配置

| 场景 | 推荐配置 |
|---|---|
| OpenAI Whisper 官方 | `KB_ASR_PROVIDER=openai`, `KB_ASR_MODEL=whisper-1`，无需 base_url |
| 内部 qwen3-asr | `KB_ASR_PROVIDER=openai`, `KB_ASR_MODEL=qwen3-asr`, `KB_ASR_BASE_URL=...`, `KB_ASR_API_KEY=...` |
| 本地 faster-whisper | `KB_ASR_PROVIDER=local`, `KB_ASR_LOCAL_MODEL=medium`, `KB_ASR_LOCAL_DEVICE=cpu`；需 `uv sync --extra local-asr` |

## 端到端示例

以一个真实 YouTube 视频为例，展示完整流程的耗时和产出规模：

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=XA42XDEJcTE"
```

**输入**：25 分钟（1507s）中文科普视频，主题"牛奶与补钙"
**总耗时**：约 12 分钟（视频下载 + ASR 转写 + 5 轮 LLM 调用）

**产出**（`out/<video_id>/` 下）：

| 阶段 | 文件 | 大小 | 内容 |
|---|---|---|---|
| asr | transcript.json | 31KB | 5 个分块转写拼接的逐字稿 |
| extract | knowledge.json | 11KB | 结构化知识点列表 |
| topics | topics.json | 2KB | 5 个短视频选题 |
| script | scripts.json | 13KB | 5 份原创口播脚本 |
| storyboard | storyboards.json | 32KB | 5 份分镜表，共 85 个镜头 |
| assets | assets.json | 20KB | 60+ 条素材建议带搜索词 |

**查看产出**：

```bash
uv run knowbreak list                       # 所有项目及完成阶段
uv run knowbreak show <video_id>            # 概览
uv run knowbreak show <video_id> -s script  # 只看某阶段
```

`storyboards.json` 可以直接对照在剪映/CapCut 里搭时间线，`assets.json` 里的搜索词直接拿到 Pexels/Pixabay/Unsplash 找素材。

## 项目结构

```
KnowBreak/
├── pyproject.toml
├── .env.example
├── knowbreak/
│   ├── cli.py              # 命令行入口
│   ├── config.py           # 配置加载
│   ├── pipeline.py         # 流水线编排
│   ├── models.py           # 数据模型（pydantic）
│   ├── llm.py              # LLM 客户端
│   └── stages/
│       ├── asr.py          # 1. 字幕优先，失败后语音转写
│       ├── extract.py      # 2. 知识点提取
│       ├── topics.py       # 3. 选题拆分
│       ├── script.py       # 4. 口播脚本
│       ├── storyboard.py   # 5. 画面分镜
│       └── assets.py       # 6. 资源清单
├── out/                    # 产出（按 video id 分目录）
└── tests/
```

### 字幕优先策略

`asr` 阶段会优先生成字幕转写，不会一上来调用 ASR：

1. 如果输入是本地视频，先查找同名 `.srt` / `.vtt` / `.ass` 字幕文件。
2. 如果输入是视频链接，先用 `yt-dlp` 尝试下载中文字幕轨。
3. 只有找不到可解析字幕时，才抽取音频并调用 `KB_ASR_PROVIDER` 指定的 ASR。

## 常见问题

### `yt-dlp` 提示需要登录或 429

这是平台侧反爬或登录校验，不是流水线本身的问题。优先尝试 `KB_COOKIES_FILE=./cookies.txt`；如果 cookie 继续失效，改用本地视频输入。详见 [方式三：YouTube 登录态 cookies](#方式三youtube-登录态-cookies)。

### `n challenge solving failed` 或 `Requested format is not available`

YouTube 的 JS 视频流挑战没解开。检查：

1. `deno --version` 能跑（没装就 `brew install deno`）
2. `yt-dlp` 版本不是太旧（`uv run yt-dlp --version`，应该 ≥ 2026.x）
3. 代码已经自动传 `--remote-components ejs:github`，第一次跑会从 GitHub 下载求解脚本，需要联网

### `Maximum file size exceeded` (ASR)

ASR 服务单文件大小超限。代码已经按 5 分钟自动分块，正常不会触发。如果还报这个错，说明 ASR 服务的限制比 25MB 更小，把 `knowbreak/stages/asr.py` 里的 `chunk_seconds` 调小（比如 120.0）。

### `Currently do not support verbose_json`

ASR 服务不支持 `verbose_json` 响应格式。代码会自动回退到 `text` 格式，正常不需要处理。如果回退也失败，检查 ASR 服务是否兼容 OpenAI 协议。

### `ffmpeg` not found

安装系统依赖：

```bash
brew install ffmpeg
```

### 想重新跑某个阶段

删除对应阶段及其后续产物，或使用 `--from` 从某阶段续跑：

```bash
uv run knowbreak run ./inputs/source.mp4 --from script
```

### 不想调用 ASR

给本地视频准备同名字幕文件，或者直接把 `.srt` / `.vtt` 作为输入：

```bash
uv run knowbreak asr ./inputs/source.srt
```

## 合规边界

- 仅用原视频作为**知识点输入**，不搬运画面/音频片段。
- 每期口播脚本必须为原创表达，不得整段改写原文。
- 引用原视频片段时标注来源，单条不超过合理引用限度。
- 不针对平台审核做规避，只对内容质量与版权负责。
