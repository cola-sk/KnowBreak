# KnowBreak

**知点拆解局** —— 知识二创短视频生产流水线。

把一个长视频（讲座/科普/访谈）提炼成原创短视频选题，生成口播脚本和画面分镜，最后自动成片。**不搬运原视频**，只用其知识点做二创输入。默认严肃科普 profile 只生成 1 个成片；需要多条视频时可在 profile 里调整选题数量。

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
按 profile 配置生成短视频选题（默认严肃科普为 1 个）
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
   │  8. TTS 配音            (tts) — edge/OpenAI/火山/MiniMax 合成每句 + 拼接完整 mp3
   ▼
每个选题一份完整配音
   │  9. 自动成片            (compose) — 配图背景 + 字幕 + 配音 → MP4
   ▼
out/<id>/compose/<topic>.mp4
```

> 想要全自动跑到 MP4 用 `knowbreak run`；只想搭时间线在剪映/CapCut 里精修，跑到 `storyboard` 或 `assets` 即可。
>
> 不想从原视频出发、想直接围绕一个手工给定的主题生成短视频？用 `topic_seed` workflow 跳过 ASR/提取/选题，从阶段 0 直接进入 script → storyboard → ... → compose。

## 能力执行策略

| 能力 | 输入 | 使用能力 | Profile prompt / 配置 | 执行策略 | 产出文件 | 版本目录规则 |
|---|---|---|---|---|---|---|
| 0. `topic_seed` 主题播种 | 手工给定的主题字符串（CLI `--topic` 或 workflow `params.topic`） | LLM JSON 结构化输出 | `prompts/topic_seed.md` 作为 system prompt；只在 `topic_seed` / 主题绑定 workflow 中调用，作为流程第一步 | 把一个手工主题转成可直接进入 `script` 的 Topic。如果 workflow params 同时给了 `topic` / `hook` / `angle`，直接用不调 LLM；只给 `topic` 时由 LLM 生成 ≤20 字标题、3 秒钩子和切入角度。 | `topics.json`（单 Topic） | 版本化产物；不依赖原视频，video_id 由主题字符串稳定生成 |
| 1. `asr` 字幕/转写 | 视频 URL、本地视频、`.srt` / `.vtt` / `.ass` 字幕 | `yt-dlp`、`ffmpeg`、OpenAI 兼容 ASR 或本地 `faster-whisper` | 不使用 profile prompt；ASR provider 在 `.env` 配置 | 优先使用本地同名字幕或 URL 自动字幕；没有字幕时下载/抽取音频为 16kHz 单声道 WAV，再走 ASR。OpenAI 兼容 ASR 会先尝试带 segment 时间戳，失败后回退为纯文本整段 segment。 | `audio.wav`、`transcript.json`、字幕文件；URL 源视频缓存为根目录 `source.mp4` | 版本模式下 `transcript.json` / `audio.wav` 放在版本目录；只有 `source.mp4` 可跨版本共享 |
| 2. `extract` 知识点提取 | `transcript.json` | LLM JSON 结构化输出 | `prompts/extract.md` 作为 system prompt，在逐字稿渲染成时间戳文本后调用；定义知识点数量、字段、摘要和原文依据要求 | 把逐字稿渲染为带时间戳文本，要求 LLM 提炼 5-12 个知识点，每个知识点包含摘要、核心论断、示例和原文依据。 | `knowledge.json` | 版本化产物；不同 profile / prompt 下必须重新生成，不跨版本共享 |
| 3. `topics` 选题拆分 | `knowledge.json` | LLM JSON 结构化输出 | `prompts/topics.md` 作为 system prompt，在知识点提取完成后调用；`profile.toml` 的 `[topics]` 定义选题数量和目标时长范围 | 基于知识点生成指定数量的独立短视频选题；当前严肃科普 profile 默认只生成 1 个 topic，强调抓人标题、3 秒钩子、误区纠偏、证据和可执行结论。 | `topics.json` | 版本化产物，放在 `out/<video_id>/<version>/` |
| 3b. `rewrite` 按原结构洗稿 | `transcript.json` | LLM JSON 结构化输出 | `prompts/rewrite.md` 作为 system prompt；`profile.toml` 的 `[rewrite]` 定义目标时长范围和口播字速；只在 `rewrite_same_structure` workflow 中调用 | 不重新提炼知识点、不拆选题，保持原视频结构、知识点顺序和核心论证，同时按目标时长和建议字数压缩重复铺垫、重复例子，改写成 1 条原创短视频口播脚本。输出明显超过目标上限时中断，不继续生成低质量后续产物。 | `scripts.json` | 版本化产物；与 `script` 二选一产出同一个脚本文件 |
| 4. `script` 口播脚本 | `topics.json` + `knowledge.json` | LLM JSON 结构化输出 | `prompts/script.md` 作为 system prompt，对每个 topic 单独调用；定义口播结构、语气、禁用流量词、估算时长和 hashtag。严肃科普风格允许前 3 句以内适度卖关子，但要服务事实解释。`generation.script_temperature` 控制生成随机性 | 每个 topic 单独生成原创逐字口播脚本；按“强钩子 → 适度悬念 → 问题说明 → 误区/现象 → 数据/机制 → 行动建议”推进，并给出每句估算时长和 hashtag。 | `scripts.json` | 版本化产物 |
| 5. `storyboard` 画面分镜 | `scripts.json` | LLM JSON 结构化输出 | `prompts/storyboard.md` 作为 system prompt，在脚本生成后调用；定义 shot 字段、画面风格、字幕密度和免版权画面要求。前 3 个 shot 以内可保留“常见认知 vs 真实原因”的悬念，但第 3 个 shot 内要进入事实解释 | 把口播拆成竖屏分镜，每个 shot 包含 narration、visual、broll、subtitle、duration；画面风格偏严肃科普的信息图、真人讲解、实拍和机制示意。LLM 超时或 JSON 异常时中断，不自动生成低质量兜底分镜。 | `storyboards.json` | 版本化产物 |
| 6. `assets` 资源清单 | `storyboards.json` | LLM JSON 结构化输出 | `prompts/assets.md` 作为 system prompt，在分镜完成后调用；定义资源类型、描述、搜索关键词和版权约束 | 根据每个 topic 的分镜摘要生成 5-12 条资源建议，包含资源类型、具体描述、搜索关键词和可选来源 URL；用于人工精修或后续素材搜索。 | `assets.json` | 版本化产物 |
| 7. `images` 自动配图 | `storyboards.json` | LLM 关键词生成、Pexels API、Pixabay API、HTTP 下载 | `prompts/images.md` 作为 system prompt，在请求图库前调用；把分镜转成英文 `cover_keywords` 和每个 shot 的搜索词，避免把比喻当字面素材；封面关键词优先体现片名和前几个分镜的具体主体 | 先让 LLM 为封面和每个 shot 生成英文搜索词，再按 `KB_IMAGE_PROVIDERS` 顺序查 Pexels/Pixabay，下载竖向大图；同 topic 内按 `source_url` 去重。遇到命名动画/IP 题材时，封面走符号化/剪影/物件化关键词，和主题相关但不搬运原片截图。关键词 LLM 失败会中断，provider 没结果才 fallback 到下一个图库。 | `images.json`、`images/<topic>/cover.jpg`、`images/<topic>/shot_<i>.jpg` | 版本化产物 |
| 8. `tts` 配音 | `scripts.json` | TTS provider：`edge` / `openai` / `volcengine` / `volcengine_legacy` / `minimax`、`ffmpeg`、`ffprobe` | 不使用 profile prompt；TTS provider、音色、语速和模型在 `.env` 配置 | 逐句合成 `line_<i>.mp3`，探测每句真实时长，再用 ffmpeg concat 拼成每个 topic 的 `full.mp3`。非 edge provider 失败时切到 edge 继续，避免整条流水线卡死。当前火山新版 provider 按 `seed-tts-2.0` 单向流式接口解析音频 chunk。 | `tts.json`、`tts/<topic>/line_<i>.mp3`、`tts/<topic>/full.mp3` | 版本化产物 |
| 9. `compose` 自动成片 | `tts.json` + `images.json` | PIL、系统字体、`ffmpeg`、`ffprobe` | 不使用 LLM prompt；读取 `profile.toml` 的 `[compose]`，控制品牌字、尺寸、颜色、字号、遮罩、字幕/封面位置和进度条 | 用 PIL 渲染开头标题封面、每句字幕 PNG、顶部标题条、底部进度条；按 TTS 实际时长生成 1080×1920 竖屏视频，音频延迟到封面结束后开始。没有图片时退化为纯色背景。 | `compose.json`、`compose/<topic>.mp4` | 版本化产物 |

## 一键执行（新视频最常用）

配置好 `.env` 后（见下方 [配置](#配置)），一个新 YouTube 视频从下载到产出 MP4 只需一条命令：

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID"
```

默认 workflow 是 `serious_science_one`，会按顺序跑完 `asr → extract → topics → script → storyboard → images → tts → compose`，最终在 `out/<video_id>/compose/` 下按 profile 配置产出 MP4（严肃科普默认 1 个，1080×1920 竖屏，开头标题封面 + 配图背景 + 烧入字幕 + TTS 配音）。

### 人工审核模式（Web 审核台 + 审核闸门）

如果你希望脚本、分镜、图片都先人工确认，再继续下一阶段，使用新增 workflow：

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --workflow serious_science_review
# 主题直出版本
uv run knowbreak run "manual:你的主题" --workflow topic_seed_review
```

这两个 workflow 会在 `script_review → storyboard_review → image_review` 阶段暂停，直到审核状态变成 `approved` 才继续。

审核台是 `app/` 下的 Next.js 项目：

```bash
cd app
npm install
npm run dev
```

默认地址 `http://localhost:3000`，pipeline 会在终端打印当前审核链接。

可选环境变量：

- `KB_REVIEW_BASE_URL`：审核台地址（默认 `http://localhost:3000`）
- `KB_REVIEW_POLL_SECONDS`：轮询间隔秒数（默认 `3`）
- `KB_REVIEW_WAIT_TIMEOUT`：等待超时秒数（默认 `0`，表示不超时）
- `KB_REVIEW_AUTO_APPROVE`：设为 `1/true` 时自动通过审核闸门（适合 CI）

如果你要“洗稿但不改变原视频结构和知识点”，使用配置式 workflow `rewrite_same_structure`：

```bash
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --workflow rewrite_same_structure
```

这个 workflow 会跑 `asr → rewrite → storyboard → images → tts → compose`，跳过 `extract`、`topics` 和 `script`，直接按原逐字稿结构改写成 1 条原创短视频口播脚本。改写时会读取 profile 的 `[rewrite] target_duration_min/max` 和 `spoken_chars_per_second`，默认按 60-90 秒、约 5 字/秒约束正文长度；每次运行都会在产出目录写入 `workflow_plan.json`，记录本次调用了哪些能力、对应 prompt、输入和输出。

### 从手工主题直接生成短视频（不依赖原视频）

不想从原视频出发、已经知道要做什么主题时，用 `topic_seed` workflow 跳过 ASR/提取/选题，从主题字符串直接走到成片：

```bash
uv run knowbreak run "manual:鼠疫是如何影响明朝历史进程的" --workflow topic_seed
# 或者用 --topic 显式传主题，source 可以是任意占位字符串
uv run knowbreak run "manual:_placeholder" --workflow topic_seed --topic "鼠疫是如何影响明朝历史进程的"
```

`topic_seed` workflow 会跑 `topic_seed → script → storyboard → images → tts → compose`。主题字符串会稳定生成一个 `video_id`（不依赖视频下载），所以同一主题多次跑会落在同一个 `out/<id>/` 下，可以配合 `--version-mode create` 做多版本对比。`topic_seed` 阶段会调 LLM 根据 `prompts/topic_seed.md` 生成 ≤20 字标题、3 秒钩子和切入角度，写入 `topics.json` 后续走标准流程。

### 主题绑定 workflow（topic/hook/angle 烤进 TOML）

如果某个主题要反复跑、或者想固定标题/钩子/角度不让 LLM 自由发挥，复制一份 `workflows/topic_seed.toml` 改成主题绑定 workflow，把 `topic` / `hook` / `angle` 写死在 `[capabilities.topic_seed].params` 里：

```toml
[capabilities.topic_seed]
params = { topic = "鼠疫是如何影响明朝历史进程的", hook = "崇祯六年的北京城，不是被攻破的，是被鼠疫掏空的。", angle = "从北京城人口与城防崩溃切入，串起鼠疫与明朝灭亡的因果链" }
```

内置 `ming_plague` workflow 就是一个完整样例，还会把 `script` 阶段指向主题专属 prompt `prompts/ming_plague/script.md`，其余阶段沿用 profile 标准 prompt：

```bash
uv run knowbreak run "manual:_placeholder" --workflow ming_plague
```

workflow TOML 里每个 capability 可以选配 `prompt`（相对 profile 根的 `.md` 路径，如 `prompts/ming_plague/script.md`）和 `params`（stage 专属参数）。运行时会优先读 workflow 里的 prompt，没配则回退到 `profile.toml [prompts]` 绑定的标准 prompt；`workflow_plan.json` 里会记录每个 capability 实际用的 prompt 路径、inputs、outputs 和 params，便于追溯。

默认内容风格是面向中国抖音/视频号的严肃科普：标题和开头有信息流抓力，但脚本保持克制、可信、强调误区纠偏、关键证据和可执行结论。

**耗时参考**：25 分钟源视频 ≈ 15 分钟跑完（下载 + ASR + 多轮 LLM + 图片获取 + TTS + 成片）。如果某个 LLM 请求超过 `KB_LLM_TIMEOUT`，流程会中断并保留已生成的中间产物；质量关键阶段不自动降级生成低质量结果。

**常用变体**：

```bash
# 中途断了从某阶段续跑（已生成的产出会保留）
uv run knowbreak run "..." --workflow rewrite_same_structure --from tts

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

默认不启用版本层，产物仍写在 `out/<video_id>/`，`list` 中显示为 `legacy`。如果要在同一个视频下面保留多次成片版本，使用 `--version-mode`。版本模式下，只有 URL 下载得到的 `source.mp4` 会放在 `out/<video_id>/` 根目录作为跨版本缓存；`audio.wav`、`transcript.json`、`knowledge.json` 和后续所有产物都放在具体版本目录。因为 profile prompt 会影响 `extract` 结果，每次 `create` 都必须从头完整生成，不能带 `--from`。

```bash
# 自动新建 out/<id>/v001；再次 create 会生成 v002、v003...
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --version-mode create

# 指定版本名新建
uv run knowbreak run "https://www.youtube.com/watch?v=VIDEO_ID" --version-mode create --version draft-a

# 覆盖更新已有版本；update 必须传 --version，避免误覆盖，可从指定阶段续跑
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

TTS 默认用 `edge-tts`（免费、无需 key），不配置也能跑；也可以通过 provider 切换到 OpenAI、火山引擎或 MiniMax。非 edge provider 失败后会自动切到 edge 兜底，避免整条流水线中断在配音阶段：

```bash
KB_TTS_PROVIDER=edge       # edge | openai | volcengine | minimax
KB_TTS_SPEED=1.0           # 通用语速；edge 仍优先用 KB_TTS_RATE
KB_TTS_VOICE=zh-CN-XiaoxiaoNeural
KB_TTS_RATE=+0%
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

每个成片默认会在开头插入一张标题封面图，封面图跟随 `KB_IMAGE_PROVIDERS` 顺序（默认 Pexels → Pixabay），音频会延迟到封面结束后再开始。封面开关和停留时长属于出片节奏参数，在 profile 的 `[intro]` 中配置。

### 风格 Profile

Workflow 和 profile 是两层配置：

| 配置 | 作用 | 示例 |
|---|---|---|
| `profiles/<name>/workflows/*.toml` | 决定调用哪些能力、顺序是什么、每步输入输出是什么；可以在 capability 上覆写 `prompt` 路径和 `params` 参数 | `serious_science_one`、`rewrite_same_structure`、`topic_seed`、`ming_plague` |
| `profiles/<name>/` | 一个完整创作方案包，包含 workflow、prompt、生成参数和成片样式 | `serious_science` |

Python stage 代码不内置 LLM prompt；所有 LLM 能力必须在 `profile.toml [prompts]` 里绑定对应 `.md` 文件。缺失 prompt 会直接中断，避免静默走代码里的兜底文案。

影响出片质量和观感的非固定参数集中放在 `profiles/<name>/`，`.env` 只负责选择哪套 profile：

```bash
KB_STYLE_PROFILE=serious_science
# 或者临时指定一个实验配置
# KB_STYLE_PROFILE_PATH=./profiles/my_style/profile.toml
```

内置 `profiles/serious_science/` 是当前“中国抖音严肃科普”风格。要做多个视频类型，复制整个目录并改名，例如 `profiles/storytelling_science/`、`profiles/fast_news/`，再在 `.env` 中切换。

```text
profiles/
└── serious_science/
    ├── profile.toml        # 短参数：temperature、颜色、字号、位置等
    ├── workflows/
    │   ├── serious_science_one.toml   # 标准全流程：asr → extract → topics → ... → compose
    │   ├── rewrite_same_structure.toml # 按原结构洗稿：asr → rewrite → ... → compose
    │   ├── topic_seed.toml            # 通用主题 workflow：topic_seed → script → ... → compose
    │   └── ming_plague.toml           # 主题绑定样例：topic/hook/angle 烤死在 params 里，script 用主题专属 prompt
    └── prompts/
        ├── extract.md      # 长 prompt：知识点提取
        ├── topics.md       # 长 prompt：选题
        ├── rewrite.md      # 长 prompt：按原结构洗稿改写
        ├── topic_seed.md   # 长 prompt：手工主题 → 标题/钩子/角度
        ├── script.md       # 长 prompt：口播脚本
        ├── storyboard.md   # 长 prompt：分镜
        ├── assets.md       # 长 prompt：资源清单
        ├── images.md       # 长 prompt：配图关键词
        └── ming_plague/
            └── script.md   # 主题绑定 workflow 专属的 script prompt 覆写
```

| 配置块 | 影响 | 典型可调项 |
|---|---|---|
| `prompts` | LLM 怎么提知识点、选题、写脚本、拆分镜、生成配图搜索词 | 在 `profile.toml` 里引用 `prompts/topics.md`、`prompts/script.md` 等 |
| `generation` | 每个 LLM 阶段的生成随机性 | `script_temperature`、`topics_temperature`、`images_temperature` |
| `intro` | 开头标题封面是否启用、停留时长 | `enabled`、`duration` |
| `topics` | 生成几个短视频选题、每条目标时长范围 | `count`、`target_duration_min`、`target_duration_max` |
| `rewrite` | 洗稿 workflow 的单条视频目标时长和字数控制 | `target_duration_min`、`target_duration_max`、`spoken_chars_per_second` |
| `compose` | 最终 MP4 的视觉样式 | 品牌字、尺寸、字体大小、字幕每行字数、遮罩透明度、封面/字幕纵向位置、进度条颜色 |

配置边界：

| 放在 `.env` | 放在 `profiles/<name>/` |
|---|---|
| API key、provider、模型地址、输出目录、cookies、图片/TTS provider 顺序 | prompt md 文件、文案风格、生成温度、封面开关和时长、封面样式、字幕样式、品牌字、颜色、版式位置 |

## 快速开始

```bash
# 推荐通过 uv run 调用，确保使用项目虚拟环境里的依赖
uv run knowbreak --help

# 全流程：从一个视频链接或本地文件跑到自动成片 MP4
uv run knowbreak run https://www.bilibili.com/video/xxx
uv run knowbreak run ./inputs/source.mp4

# 不依赖原视频，从手工主题直接生成短视频
uv run knowbreak run "manual:鼠疫是如何影响明朝历史进程的" --workflow topic_seed
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

如果使用版本模式，目录结构会变成源文件缓存 + 多个完整版本目录：

```text
out/<video_id>/
├── source.mp4          # 可选共享：URL 下载得到的原视频缓存；本地文件输入不一定会复制到这里
├── v001/
│   ├── audio.wav
│   ├── transcript.json
│   ├── knowledge.json
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

`create` 模式用于新建一个完整版本，必须从 `asr` 跑到 `compose`。如果只是微调某个阶段，用 `update --from` 或单阶段命令覆盖已有版本。

断点续跑：

```bash
# legacy 模式：例如 transcript.json 已经生成，只想从知识点提取继续
uv run knowbreak run ./inputs/source.mp4 --from extract

# 版本模式：覆盖更新已有版本，从指定阶段继续
uv run knowbreak run ./inputs/source.mp4 --version-mode update --version v002 --from script
```

单阶段调试：

```bash
# legacy 路径
uv run knowbreak asr ./inputs/source.mp4
uv run knowbreak extract ./out/<id>/transcript.json
uv run knowbreak topics ./out/<id>/knowledge.json
uv run knowbreak rewrite ./out/<id>/transcript.json
uv run knowbreak topic-seed ./out/<id> --topic "鼠疫是如何影响明朝历史进程的"
uv run knowbreak script ./out/<id>/topics.json
uv run knowbreak storyboard ./out/<id>/scripts.json
uv run knowbreak assets ./out/<id>/storyboards.json
uv run knowbreak images ./out/<id>/storyboards.json            # 全部选题
uv run knowbreak images ./out/<id>/storyboards.json --topic 4  # 只跑指定选题
uv run knowbreak tts ./out/<id>/scripts.json
uv run knowbreak compose ./out/<id>/tts.json                   # 全部选题
uv run knowbreak compose ./out/<id>/tts.json --topic 4         # 只生成一个 MP4

# 版本路径，把 v002 替换成目标版本
uv run knowbreak extract ./out/<id>/v002/transcript.json
uv run knowbreak topics ./out/<id>/v002/knowledge.json
uv run knowbreak rewrite ./out/<id>/v002/transcript.json
uv run knowbreak topic-seed ./out/<id>/v002 --topic "..."
uv run knowbreak script ./out/<id>/v002/topics.json
uv run knowbreak storyboard ./out/<id>/v002/scripts.json
uv run knowbreak assets ./out/<id>/v002/storyboards.json
uv run knowbreak images ./out/<id>/v002/storyboards.json --topic 4
uv run knowbreak tts ./out/<id>/v002/scripts.json
uv run knowbreak compose ./out/<id>/v002/tts.json --topic 4

uv run knowbreak list
uv run knowbreak show <id>
uv run knowbreak show <id> --version v002 --stage script
```

`images` 和 `compose` 都支持 `--topic`，便于先验证单题质量再批量跑，省图片 API 配额。

局部微调时按影响范围重跑：

| 改动内容 | 建议命令 |
|---|---|
| 只改封面图 | `uv run knowbreak images ./out/<id>/<version>/storyboards.json --topic 0 --cover-only`，然后 `compose --topic 0` |
| 只改分镜配图 | `uv run knowbreak images ./out/<id>/<version>/storyboards.json --topic 0`，然后 `compose --topic 0` |
| 只改成片视觉参数 `[compose]` | `uv run knowbreak compose ./out/<id>/<version>/tts.json --topic 0` |
| 只改 TTS provider / 音色 | `uv run knowbreak tts ./out/<id>/<version>/scripts.json`，然后 `compose` |
| 改 `prompts/rewrite.md` 或 `[rewrite]` 目标时长 | `rewrite → storyboard → images → tts → compose` |
| 改 `prompts/script.md` | `script → storyboard → images → tts → compose` |
| 改 `prompts/storyboard.md` | `storyboard → assets/images → compose`，如果口播没变通常不用重跑 TTS |
| 改 `prompts/images.md` | `images → compose` |
| 改 `prompts/topics.md` | `topics → script → storyboard → assets/images → tts → compose` |
| 改 `prompts/extract.md` | `extract → topics → script → storyboard → assets/images → tts → compose` |
| 改 `prompts/topic_seed.md` 或主题绑定 workflow 的 `params` | `topic_seed → script → storyboard → images → tts → compose`，可 `--from script` 续跑后段 |

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
**说明**：下表是早期 `topics.count=5` 时的规模参考；当前 `serious_science` 默认 `topics.count=1`，只会生成 1 个成片。

**产出**（legacy 模式在 `out/<video_id>/` 下；版本模式下所有生成产物都在 `out/<video_id>/<version>/`；根目录只缓存 URL 源视频 `source.mp4`）：

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
2. 每个 topic 先额外生成一组封面图搜索词，封面图跟随 `KB_IMAGE_PROVIDERS` 顺序；封面关键词会优先贴合片名/前几个分镜里的具体主体
3. 按 `KB_IMAGE_PROVIDERS` 顺序调用 provider 搜索竖向大图
4. 过滤掉宽高小于 1080 的，下载封面图到 `images/<topic>/cover.jpg`，分镜图到 `images/<topic>/shot_<i>.jpg`
5. 写入 `images.json`，记录 `cover`、`shots`、`provider`、`query`、图片路径、来源 URL、作者、license

**provider fallback**：例如 `KB_IMAGE_PROVIDERS=pexels,pixabay` 时，普通分镜和封面图都会先查 Pexels；Pexels 没结果或没 key，再查 Pixabay。图片关键词 LLM 超时/失败时会中断，避免下载一批不对题图片。某个 shot 或 cover 两个 provider 都搜不到时，在 compose 阶段使用纯色背景。

**去重**：同一个 topic 内会跳过已经用过的 `source_url`，避免 `cover.jpg` 和多个 `shot_<i>.jpg` 都下载成同一张图。

**命名动画/IP 题材**：封面不直接搜索原片截图或复制角色，而是用“符号化物件、剪影、风格化图标、相关场景元素”表达主题。例如“葫芦娃”题材会优先尝试七个彩色葫芦、藤蔓、老人/蛇影、概率模型等元素。

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

`tts` 阶段把每句口播合成为单独 mp3，再用 ffmpeg concat demuxer 拼成每个选题的 `full.mp3`。实际时长由 ffprobe 探测后写入 `tts.json`，供 compose 阶段对齐画面。

支持的 provider：

| Provider | `KB_TTS_PROVIDER` | 说明 |
|---|---|---|
| edge-tts | `edge` | 默认，免费、无需 key；质量够用但口播节奏偏机械 |
| OpenAI TTS | `openai` | 接入简单，适合做质量对照 |
| 火山引擎 / 豆包大模型语音合成 | `volcengine` | 默认使用 `seed-tts-2.0` 单向流式接口，中文短视频口播优先试这个 |
| MiniMax Speech | `minimax` | 中文自然度和多音色可作为重点候选 |

通用配置：

```bash
KB_TTS_PROVIDER=edge
KB_TTS_TIMEOUT=60
KB_TTS_SPEED=1.0
```

edge-tts 配置：

```bash
KB_TTS_VOICE=zh-CN-XiaoxiaoNeural
KB_TTS_RATE=+0%
KB_TTS_VOLUME=+0%
```

OpenAI TTS 配置：

```bash
KB_TTS_PROVIDER=openai
KB_OPENAI_TTS_API_KEY=sk-...
KB_OPENAI_TTS_BASE_URL=https://api.openai.com/v1
KB_OPENAI_TTS_MODEL=gpt-4o-mini-tts
KB_OPENAI_TTS_VOICE=alloy
```

火山引擎 / 豆包大模型语音合成配置：

```bash
KB_TTS_PROVIDER=volcengine
KB_VOLC_TTS_API_KEY=...
KB_VOLC_TTS_MODEL=seed-tts-2.0
KB_VOLC_TTS_URL=https://openspeech.bytedance.com/api/v3/tts/unidirectional
KB_VOLC_TTS_SPEAKER=zh_female_xiaohe_uranus_bigtts
KB_VOLC_TTS_CONTEXT=自然、清晰、克制的中文科普男声，语速适中，不要背景音乐和音效。
```

MiniMax Speech 配置：

```bash
KB_TTS_PROVIDER=minimax
KB_MINIMAX_TTS_API_KEY=...
KB_MINIMAX_TTS_GROUP_ID=...
KB_MINIMAX_TTS_MODEL=speech-02-turbo
KB_MINIMAX_TTS_VOICE_ID=Chinese (Mandarin)_News_Anchor
```

非 edge provider 失败时会打印错误并切到 edge 兜底，后续句子也会继续使用 edge，避免同一个选题里反复失败。

## 自动成片（阶段 9）

把 TTS 配音 + 配图 + 字幕烧录成一个 MP4。

**画面结构**（开头封面 + 每句口播一张 PNG，按 TTS 实际时长拼成视频）：

```
┌─────────────────────────┐
│      [封面图背景]        │
│  知点拆解局              │
│                          │
│        大标题            │  ← 时长由 profile.toml 的 [intro].duration 控制，音频延迟到封面后起播
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

**关键参数**（在 `profiles/<style>/profile.toml` 的 `compose` 配置块）：

| 参数 | 默认 | 调整建议 |
|---|---|---|
| `video_w` / `video_h` | 1080×1920 | 抖音/视频号标准竖屏，一般不动 |
| `bg_color` | `[14,14,18]` | 无配图时的背景色 |
| `subtitle_font_size` | 62 | 字太大改小，看不清改大 |
| `title_font_size` | 38 | 顶部标题 |
| `cover_title_font_size` | 88 | 开头封面大标题 |
| `max_chars_per_line` | 16 | 中文每行字数，超出自动换行 |
| `top_bar_alpha` | 170 | 顶部标题条透明度，越大越暗 |
| `bottom_overlay_alpha` | 150 | 字幕区遮罩，越大字幕越清晰 |
| `subtitle_center_ratio` | 0.45 | 正文字幕的纵向位置，越大越靠下 |
| `cover_title_center_ratio` | 0.45 | 封面大标题的纵向位置 |
| `brand` | `知点拆解局` | 封面左上品牌字 |

**字体**：自动探测 PingFang → STHeiti Medium → Hiragino Sans GB → Arial Unicode 的顺序，第一个能 PIL 打开的就用。在新版 macOS 上 PingFang.ttc 在私有路径下 PIL 打不开，会自动降级到 STHeiti Medium。

**FFmpeg 不需要 libass**：字幕直接 PIL 渲染成 PNG，再用 `concat demuxer + duration` 按每句实际 TTS 时长拼接，绕开了 ffmpeg 没装 libass/drawtext 的常见坑（macOS 默认 ffmpeg 就是这样）。

**只跑单题**：

```bash
uv run knowbreak compose ./out/<id>/tts.json --topic 4
```

会保留 `compose.json` 里其他 topic 的记录，只重渲染指定 topic 的 MP4。改了字幕样式/字体后调试很省时间。

如果只想关掉开头封面，在 `profiles/<style>/profile.toml` 中修改：

```toml
[intro]
enabled = false
duration = 2.0
```

如果想调整封面停留时间：

```toml
[intro]
enabled = true
duration = 1.5
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
│   ├── style_profile.py    # 风格 profile 加载与校验
│   ├── workflow.py         # 配置式 workflow 加载、prompt 解析、plan 写出
│   └── stages/
│       ├── asr.py          # 1. 字幕优先，失败后语音转写
│       ├── extract.py      # 2. 知识点提取
│       ├── topics.py       # 3. 选题拆分
│       ├── rewrite.py      # 3b. 按原结构洗稿
│       ├── topic_seed.py   # 0. 手工主题播种（跳过 ASR/提取/选题）
│       ├── script.py       # 4. 口播脚本
│       ├── storyboard.py   # 5. 画面分镜
│       ├── assets.py       # 6. 资源清单
│       ├── images.py       # 7. 图片获取（Pexels/Pixabay）
│       ├── tts.py          # 8. 多 provider TTS 配音
│       └── compose.py      # 9. 自动成片（PIL + ffmpeg）
├── profiles/               # prompt、文案风格、成片视觉参数
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

legacy 模式可以删除对应阶段及其后续产物，或使用 `--from` 从某阶段续跑：

```bash
uv run knowbreak run ./inputs/source.mp4 --from script
```

版本模式下，`create` 永远完整新建版本；要覆盖已有版本，用 `update --version <version> --from <stage>`，或者使用上文的单阶段命令精确覆盖某个文件。

### 不想调用 ASR

给本地视频准备同名字幕文件，或者直接把 `.srt` / `.vtt` 作为输入：

```bash
uv run knowbreak asr ./inputs/source.srt
```

如果根本没有原视频、只想围绕一个主题做原创短视频，用 `topic_seed` workflow 跳过整个 ASR/提取/选题链路：

```bash
uv run knowbreak run "manual:你的主题" --workflow topic_seed
```

### TTS provider 连接失败 / 超时

OpenAI、火山、MiniMax 任一 provider 失败时，代码会自动切到 edge 兜底并继续生成后续句子。edge-tts 走微软公共端点，国内偶尔也会连不上；持续失败时可以换音色（例如 `KB_TTS_VOICE=zh-CN-YunxiNeural`）、挂代理，或临时改回已验证可用的商业 provider。火山新版优先用 `KB_TTS_PROVIDER=volcengine` + `KB_VOLC_TTS_MODEL=seed-tts-2.0`。`tts` 阶段是幂等的，重跑会覆盖之前生成的 mp3。

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
- TTS 配音可使用 edge-tts、OpenAI、火山引擎或 MiniMax；商用发布前需确认所选 provider 的授权范围、音色使用条款和署名要求。
