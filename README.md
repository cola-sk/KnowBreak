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
资源搜索词清单
   │  7. 图片获取            (images) — Pexels/Pixabay 自动下载竖向免版权图
   ▼
每个 topic 一张开头封面图 + 每个分镜一张配图
   │  8. TTS 配音            (tts) — edge-tts 合成每句 + 拼接完整 mp3
   ▼
每个选题一份完整配音
   │  9. 自动成片            (compose) — 配图背景 + 字幕 + 配音 → MP4
   ▼
out/<id>/compose/<topic>.mp4
```

> 想要全自动跑到 MP4 用 `knowbreak run`；只想搭时间线在剪映/CapCut 里精修，跑到 `storyboard` 或 `assets` 即可。

## 一键执行（新视频最常用）

配置好 `.env` 后（见下方 [配置](#配置)），一个新 YouTube 视频从下载到产出 N 个 MP4 只需一条命令：

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID"
```

会按顺序自动跑完 9 个阶段（asr → extract → topics → script → storyboard → assets → images → tts → compose），最终在 `out/<video_id>/compose/` 下产出 3-5 个 MP4（每个选题一个，1080×1920 竖屏，开头标题封面 + 配图背景 + 烧入字幕 + edge-tts 配音）。

默认内容风格是面向中国抖音/视频号的严肃科普：标题和开头有信息流抓力，但脚本保持克制、可信、强调误区纠偏、关键证据和可执行结论。

**耗时参考**：25 分钟源视频 ≈ 15 分钟跑完（下载 + ASR + 多轮 LLM + 图片获取 + TTS + 成片）。如果某个 LLM 请求超过 `KB_LLM_TIMEOUT`，流程会中断并保留已生成的中间产物；质量关键阶段不自动降级生成低质量结果。

**常用变体**：

```bash
# 中途断了从某阶段续跑（已生成的产出会保留）
uv run knowbreak run "..." --from tts

# 想先看一个选题的效果，省图片 API 配额：分两步
# 1) 先全流程跑到 compose（如果只关心单题，这步会浪费其他题的配额）
#    更省的做法是跑到 assets 后停止，再单题跑后段：
uv run knowbreak images out/<id>/storyboards.json --topic 2
uv run knowbreak tts out/<id>/scripts.json
uv run knowbreak compose out/<id>/tts.json --topic 2

# 看所有项目进度
uv run knowbreak list
uv run knowbreak show <id>
```

默认不启用版本层，产物仍写在 `out/<video_id>/`，`list` 中显示为 `legacy`。如果要在同一个视频下面保留多次成片版本，使用 `--version-mode`。版本模式下，`source.mp4`、`audio.wav`、`transcript.json`、`knowledge.json` 会放在 `out/<video_id>/` 根目录作为共享基础产物；`v001/v002/...` 只保存从选题开始的版本化产物。

```bash
# 自动新建 out/<id>/v001；再次 create 会生成 v002、v003...
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --version-mode create

# 指定版本名新建
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --version-mode create --version draft-a

# 覆盖更新已有版本；update 必须传 --version，避免误覆盖
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --version-mode update --version draft-a --from images

# 查看某个版本
uv run knowbreak show <id> --version draft-a
```

**前置条件**（首次配置后不用再动）：

- `.env` 里有 `KB_LLM_*` / `KB_ASR_*`；如果想自动配图，再配置 `PEXELS_API_KEY` 或 `PIXABAY_API_KEY`
- YouTube 受限视频需要 `cookies.txt`（首次导出后不用再管，见 [方式三](#方式三youtube-登录态-cookies)）
- 系统装了 `ffmpeg` 和 `deno`（见 [安装](#安装)）

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
KB_LLM_TIMEOUT=120   # 单次 LLM 请求超时秒数；超时后流程中断，保留中间产物

KB_ASR_PROVIDER=openai
KB_ASR_MODEL=whisper-1
KB_OUT_DIR=./out
```

如果 ASR 也走 OpenAI 兼容服务，额外配置：

```bash
KB_ASR_BASE_URL=https://api.openai.com/v1
KB_ASR_API_KEY=sk-...
```

TTS 默认用 `edge-tts`（免费、无需 key），不配置也能跑。可调音色和语速：

```bash
KB_TTS_VOICE=zh-CN-XiaoxiaoNeural  # 默认女声，详见 .env.example
KB_TTS_RATE=+0%                     # +10% 加速，-5% 减速
```

配图 provider 可选。默认按 `KB_IMAGE_PROVIDERS=pexels,pixabay` 的顺序尝试，某个 provider 没有 key 会自动跳过；两个 key 都不配置时，`images` 阶段只写空清单，`compose` 退化为纯色背景 + 字幕。

```bash
KB_IMAGE_PROVIDERS=pexels,pixabay

# Pexels: https://www.pexels.com/api/
PEXELS_API_KEY=...

# Pixabay: https://pixabay.com/api/docs/
PIXABAY_API_KEY=...
```

如果想优先试 Pixabay，改成：

```bash
KB_IMAGE_PROVIDERS=pixabay,pexels
```

每个成片默认会在开头插入一张标题封面图，封面图跟随 `KB_IMAGE_PROVIDERS` 顺序（默认 Pexels → Pixabay），音频会延迟到封面结束后再开始：

```bash
KB_INTRO_ENABLED=true
KB_INTRO_DURATION=2.0
```

## 快速开始

```bash
# 推荐通过 uv run 调用，确保使用项目虚拟环境里的依赖
uv run knowbreak --help

# 全流程：从一个视频链接或本地文件跑到自动成片 MP4
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
├── assets.json         # 资源清单
├── images.json         # 配图清单（provider/query/source/license/path）
├── images/             # 图片本体（按 topic 分目录）
│   └── <topic>/
│       ├── cover.jpg
│       └── shot_<i>.jpg
├── tts.json            # TTS 配音元数据（每句实际时长）
├── tts/                # 音频本体
│   └── <topic>/
│       ├── line_<i>.mp3  # 每句一段
│       └── full.mp3      # 拼接后的完整配音
└── compose/
    └── <topic>.mp4     # 最终成片：1080×1920 竖屏
```

如果使用版本模式，目录结构会变成共享基础产物 + 多个版本目录：

```text
out/<video_id>/
├── source.mp4          # 共享：原视频
├── audio.wav           # 共享：原视频音频
├── transcript.json     # 共享：字幕/ASR 转写结果
├── knowledge.json      # 共享：知识点提取
├── v001/
│   ├── topics.json
│   ├── scripts.json
│   ├── storyboards.json
│   ├── assets.json
│   ├── images.json
│   ├── tts.json
│   └── compose/<topic>.mp4
└── v002/
    └── ...
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
uv run knowbreak images ./out/<id>/storyboards.json            # 全部选题
uv run knowbreak images ./out/<id>/storyboards.json --topic 4  # 只跑指定选题
uv run knowbreak tts ./out/<id>/scripts.json
uv run knowbreak compose ./out/<id>/tts.json                   # 全部选题
uv run knowbreak compose ./out/<id>/tts.json --topic 4         # 只生成一个 MP4

uv run knowbreak list
uv run knowbreak show <id>
uv run knowbreak show <id> --stage script
```

`images` 和 `compose` 都支持 `--topic`，便于先验证单题质量再批量跑，省图片 API 配额。

### 单题重跑封面/配图

当脚本、分镜和 TTS 已经生成，只想重新试某个选题的封面图和最终 MP4：

```bash
# 先让图片阶段重抓该 topic 的 cover.jpg 和 shot 图片
uv run knowbreak images ./out/<id>/storyboards.json --topic 0

# 再只重渲染该 topic 的视频
uv run knowbreak compose ./out/<id>/tts.json --topic 0
```

如果只想重新获取封面，不想动正文分镜图：

```bash
uv run knowbreak images ./out/<id>/storyboards.json --topic 0 --cover-only
uv run knowbreak compose ./out/<id>/tts.json --topic 0
```

重跑后重点看：

```bash
open ./out/<id>/images/0/cover.jpg
open ./out/<id>/compose/0.mp4
jq '.[] | select(.topic_index == 0) | .cover' ./out/<id>/images.json
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
**总耗时**：约 15 分钟（视频下载 + ASR 转写 + 5 轮 LLM 调用 + 图片获取 + TTS + 成片）

**产出**（legacy 模式在 `out/<video_id>/` 下；版本模式下 asr/extract 在 `out/<video_id>/`，后续阶段在 `out/<video_id>/<version>/`）：

| 阶段 | 文件 | 大小 | 内容 |
|---|---|---|---|
| asr | transcript.json | 31KB | 5 个分块转写拼接的逐字稿 |
| extract | knowledge.json | 11KB | 结构化知识点列表 |
| topics | topics.json | 2KB | 5 个短视频选题 |
| script | scripts.json | 13KB | 5 份原创口播脚本 |
| storyboard | storyboards.json | 32KB | 5 份分镜表，共 85 个镜头 |
| assets | assets.json | 20KB | 60+ 条素材建议带搜索词 |
| images | images.json + images/ | ~4MB | 每个 topic 1 张 cover + 50+ 张竖向分镜配图 |
| tts | tts.json + tts/ | ~3MB | 5 份完整 mp3 配音 |
| compose | compose/<0-4>.mp4 | 1.7-3.3MB | 5 个 1080×1920 竖屏 MP4 |

**查看产出**：

```bash
uv run knowbreak list                       # 所有项目及完成阶段
uv run knowbreak show <video_id>            # 概览
uv run knowbreak show <video_id> -s script  # 只看某阶段
open out/<video_id>/compose/4.mp4           # 直接预览成片
```

`storyboards.json` 可以直接对照在剪映/CapCut 里搭时间线，`assets.json` 里的搜索词直接拿到 Pexels/Pixabay/Unsplash 找素材。`compose/<topic>.mp4` 已经是可以直接发抖音/视频号的成品（开头封面 + 配图 + 字幕 + 配音），不需要再剪辑也可以发。

## 分镜生成（阶段 5）

`storyboard` 阶段默认让 LLM 把口播拆成竖屏分镜，画面风格偏严肃科普：真人讲解、信息图、医学/科学示意、实拍素材和结论卡片。每个 shot 会包含 `narration`、`visual`、`broll`、`subtitle` 和 `duration`。

如果分镜 LLM 超时、返回异常或 JSON 不合法，标准流程会直接中断。此时优先检查脚本质量、调整 prompt 或更换模型，再用 `--from storyboard` 或单阶段命令续跑；不要为了跑完整流程自动生成低质量分镜。

## 图片获取（阶段 7）

为每个分镜自动下载一张竖向免版权图。默认支持两个 provider：

| Provider | 环境变量 | 适合场景 |
|---|---|---|
| Pexels | `PEXELS_API_KEY` / `KB_PEXELS_API_KEY` | 质感照片、人物、生活方式、通用场景 |
| Pixabay | `PIXABAY_API_KEY` / `KB_PIXABAY_API_KEY` | 照片、插画、矢量感素材、科普图兜底 |

**工作流程**：

1. LLM 读 `storyboards.json`，为每个 shot 生成 2-3 个英文搜索词（具体、可视化，避免抽象词）
2. 每个 topic 先额外生成一组封面图搜索词，封面图跟随 `KB_IMAGE_PROVIDERS` 顺序
3. 按 `KB_IMAGE_PROVIDERS` 顺序调用 provider 搜索竖向大图
4. 过滤掉宽高小于 1080 的，下载封面图到 `images/<topic>/cover.jpg`，分镜图到 `images/<topic>/shot_<i>.jpg`
5. 写入 `images.json`，记录 `cover`、`shots`、`provider`、`query`、图片路径、来源 URL、作者、license

**provider fallback**：例如 `KB_IMAGE_PROVIDERS=pexels,pixabay` 时，普通分镜和封面图都会先查 Pexels；Pexels 没结果或没 key，再查 Pixabay。图片关键词 LLM 超时/失败时会中断，避免下载一批不对题图片。某个 shot 或 cover 两个 provider 都搜不到时，在 compose 阶段使用纯色背景。

**去重**：同一个 topic 内会跳过已经用过的 `source_url`，避免 `cover.jpg` 和多个 `shot_<i>.jpg` 都下载成同一张图。

**没配 key 怎么办**：`images` 阶段不会报错，会写出空清单；`compose` 自动退化为纯色背景 + 字幕的视频（仍可发布，只是没那么好看）。

**当前验证样例**：`67dca56980` 的 topic 0 已用 Pexels 跑通，封面元数据写入 `images.json`：

```json
{
  "provider": "pexels",
  "query": "milk vs calcium pills calcium supplement truth",
  "image_path": "67dca56980/images/0/cover.jpg"
}
```

**图不对题怎么办**：LLM 偶尔会把比喻当字面意思（例如"成骨细胞像建筑工人"会去搜 construction worker）。处理方式：

1. 看 `images.json` 里每条记录的 `query` 字段
2. 手动改 `storyboards.json` 里对应 shot 的 `broll` 描述，去掉比喻
3. 删掉 `images/<topic>/shot_<i>.jpg` 重跑 `images --topic <topic_index>`

## TTS 配音（阶段 8）

用 `edge-tts`（微软 Edge 浏览器内置的 TTS 服务，免费、无需 API key、不限调用次数）合成中文口播。

- 默认音色 `zh-CN-XiaoxiaoNeural`（女声，自然度高，适合科普）
- 每句口播单独合成一个 mp3，再用 ffmpeg concat demuxer 拼接成 `full.mp3`
- 实际时长由 ffprobe 探测后写入 `tts.json`，供 compose 阶段对齐画面

可调项（在 `.env` 里）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `KB_TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | 完整列表见 [Azure 语音语言支持](https://learn.microsoft.com/azure/ai-services/speech-service/language-support) |
| `KB_TTS_RATE` | `+0%` | 语速，`+10%` 加速、`-5%` 减速 |
| `KB_TTS_VOLUME` | `+0%` | 音量 |

> edge-tts 走的是公共端点，国内偶尔会连不上。失败重试即可；如果持续失败，可以换 `zh-CN-YunxiNeural`（男声）或其他音色试一下。

## 自动成片（阶段 9）

把 TTS 配音 + 配图 + 字幕烧录成一个 MP4。

**画面结构**（开头封面 + 每句口播一张 PNG，按 TTS 实际时长拼成视频）：

```
┌─────────────────────────┐
│      [封面图背景]        │
│  知点拆解局              │
│                          │
│        大标题            │  ← 默认 2 秒，音频延迟到封面后起播
└─────────────────────────┘
          ↓
┌─────────────────────────┐
│  ▓▓▓▓ 顶部标题条 ▓▓▓▓▓▓  │  ← 半透明黑条 (170α) + 标题
│                         │
│                         │
│      [配图背景]          │  ← cover-crop 填满 1080×1920
│                         │
│                         │
│  ▓▓▓ 字幕正文（描边）▓▓▓ │  ← 底部半透明遮罩 (150α)
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│      ▓▓▓▓▓▓▓▓▓▓▓       │  ← 进度条
└─────────────────────────┘
```

**关键参数**（在 `knowbreak/stages/compose.py` 顶部常量）：

| 常量 | 默认 | 调整建议 |
|---|---|---|
| `VIDEO_W/H` | 1080×1920 | 抖音/视频号标准竖屏，一般不动 |
| `BG_COLOR` | `(14,14,18)` | 无配图时的背景色 |
| `SUBTITLE_FONT_SIZE` | 62 | 字太大改小，看不清改大 |
| `TITLE_FONT_SIZE` | 38 | 顶部标题 |
| `COVER_TITLE_FONT_SIZE` | 88 | 开头封面大标题 |
| `MAX_CHARS_PER_LINE` | 16 | 中文每行字数，超出自动换行 |
| `TOP_BAR_ALPHA` | 170 | 顶部标题条透明度，越大越暗 |
| `BOTTOM_OVERLAY_ALPHA` | 150 | 字幕区遮罩，越大字幕越清晰 |

**字体**：自动探测 PingFang → STHeiti Medium → Hiragino Sans GB → Arial Unicode 的顺序，第一个能 PIL 打开的就用。在新版 macOS 上 PingFang.ttc 在私有路径下 PIL 打不开，会自动降级到 STHeiti Medium。

**FFmpeg 不需要 libass**：字幕直接 PIL 渲染成 PNG，再用 `concat demuxer + duration` 按每句实际 TTS 时长拼接，绕开了 ffmpeg 没装 libass/drawtext 的常见坑（macOS 默认 ffmpeg 就是这样）。

**只跑单题**：

```bash
uv run knowbreak compose ./out/<id>/tts.json --topic 4
```

会保留 `compose.json` 里其他 topic 的记录，只重渲染指定 topic 的 MP4。改了字幕样式/字体后调试很省时间。

如果只想关掉开头封面：

```bash
KB_INTRO_ENABLED=false
```

如果想调整封面停留时间：

```bash
KB_INTRO_DURATION=1.5
```

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
│       ├── assets.py       # 6. 资源清单
│       ├── images.py       # 7. 图片获取（Pexels/Pixabay）
│       ├── tts.py          # 8. edge-tts 配音
│       └── compose.py      # 9. 自动成片（PIL + ffmpeg）
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

### TTS 报 `edge-tts` 连接失败 / 超时

edge-tts 走微软公共端点，国内偶尔会连不上。先重试一次；持续失败的话换音色（例如 `KB_TTS_VOICE=zh-CN-YunxiNeural`）或挂代理。`tts` 阶段是幂等的，重跑会覆盖之前生成的 mp3。

### LLM 阶段超时 / 返回 JSON 解析失败

`topics`、`script`、`storyboard`、`images` 关键词生成都属于质量关键阶段。超时或 JSON 不合法时流程会中断，不自动兜底生成低质量内容。先检查 `.env` 里的 `KB_LLM_MODEL` 和 `KB_LLM_TIMEOUT`，必要时换更稳定的模型或增大超时时间；确认前序产物没问题后，用 `--from <stage>` 或单阶段命令续跑。

### 图片 provider 报 `401 Unauthorized` 或 `429 Too Many Requests`

- 401：检查 `.env` 里的 `PEXELS_API_KEY` / `PIXABAY_API_KEY` 是否正确
- 429：免费额度用完，等配额恢复、换 provider 顺序，或用 `--topic` 单题跑省配额

### compose 报 `cannot open resource`（PIL 字体）

macOS 新版本上 PingFang.ttc 在私有路径下 PIL 打不开。代码已经自动降级到 STHeiti Medium / Hiragino Sans GB，如果还是报错，确认 `/System/Library/Fonts/` 下至少有一个 `.ttc` 字体存在，或手动改 `knowbreak/stages/compose.py` 顶部的 `_FONT_CANDIDATES` 加上你能用的字体路径。

### 配图不对题（图与口播内容不符）

LLM 偶尔会把比喻当字面意思（例如"成骨细胞像建筑工人"会去搜 construction worker）。看 `images.json` 里 `query` 字段定位问题 shot，改 `storyboards.json` 里对应 shot 的 `broll` 描述去掉比喻，删掉 `images/<topic>/shot_<i>.jpg` 后重跑 `images --topic <i>`。

### 开头封面图不够吸引人

先确认 `images.json` 里的 `cover.query` 是否贴近选题。如果 query 方向对但图片不理想，直接重跑该 topic 的 `images` 阶段；如果 query 方向不对，改 `storyboards.json` 里该 topic 的标题或第一条 broll，再重跑：

```bash
uv run knowbreak images ./out/<id>/storyboards.json --topic 0
uv run knowbreak compose ./out/<id>/tts.json --topic 0
```

### 想改字幕样式 / 字号 / 配色

所有参数都在 `knowbreak/stages/compose.py` 顶部常量区。改完只重跑 compose 即可，不用重做 TTS：

```bash
uv run knowbreak compose ./out/<id>/tts.json --topic 4
```

## 合规边界

- 仅用原视频作为**知识点输入**，不搬运画面/音频片段。
- 每期口播脚本必须为原创表达，不得整段改写原文。
- 引用原视频片段时标注来源，单条不超过合理引用限度。
- 不针对平台审核做规避，只对内容质量与版权负责。
- 配图来自已配置的免版权图库 provider，需遵守对应 provider 的 license；`images.json` 里记录了每张图的 provider、作者、来源 URL 和 license，发布时如需署名可直接取用。
- TTS 配音使用 edge-tts 公共端点，仅用于本人自有内容发布；商用场景建议接入正式 Azure Speech 服务。
