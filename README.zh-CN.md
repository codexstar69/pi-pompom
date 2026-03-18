<p align="center">
  <a href="README.md">English</a> | <b>简体中文</b>
</p>

<p align="center">
  <b>Pi-Pompom</b> — 一个运行在 Pi CLI 中的终端宠物，带有语音、环境天气、
  侧边聊天和感知代理状态的评论能力。
</p>

<h1 align="center">pi-pompom</h1>
<p align="center"><strong>一个拥有语音、环境音效、AI 侧边聊天和代理智能的 3D 光线行进虚拟宠物 — 适用于 Pi CLI。</strong></p>
<p align="center">
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/v/@codexstar/pi-pompom.svg" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/dm/@codexstar/pi-pompom.svg" alt="npm 下载量"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="许可证: MIT"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="平台">
</p>
<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#命令">命令</a> ·
  <a href="#快捷键">快捷键</a> ·
  <a href="#功能">功能</a> ·
  <a href="#侧边聊天">侧边聊天</a> ·
  <a href="#代理智能">代理智能</a> ·
  <a href="#设置面板">设置</a>
</p>

---

Pompom 是 [Pi CLI](https://github.com/mariozechner/pi-coding-agent) 的互动编程伴侣。它在编辑器上方实时渲染 3D 光线行进角色，使用自然 TTS 语音说话，播放环境天气音效，追踪你的编码代理心情，提供 AI 侧边聊天，并根据饥饿、疲劳和你的互动做出情感反应。

## 安装

```bash
pi install @codexstar/pi-pompom
```

## 快速开始

启动 Pi 后 Pompom 自动出现。切换显示：

```
/pompom on
/pompom off
```

使用 `/pompom-settings` 打开互动设置面板 — 9个标签覆盖所有功能，无需记忆命令。

## 命令

### 宠物操作

| 命令 | 功能 |
|------|------|
| `/pompom` | 切换伴侣开/关 |
| `/pompom help` | 显示所有命令和快捷键 |
| `/pompom status` | 查看心情、饥饿、精力、主题 |
| `/pompom pet` | 抚摸 Pompom |
| `/pompom feed` | 投喂食物 |
| `/pompom treat` | 特殊零食（额外饥饿恢复） |
| `/pompom hug` | 抱一抱（恢复精力） |
| `/pompom ball` | 扔球 |
| `/pompom dance` | 跳舞（带闪光粒子） |
| `/pompom music` | 唱歌 |
| `/pompom game` | 接星星！（20秒小游戏） |
| `/pompom theme` | 切换颜色主题 |
| `/pompom sleep` | 小睡 |
| `/pompom wake` | 醒来 |
| `/pompom flip` | 后空翻 |
| `/pompom hide` | 走到屏幕边缘（保持20-30%可见） |
| `/pompom toggle` | 隐藏/显示动画（语音和追踪继续运行） |
| `/pompom give <物品>` | 赠送配饰（umbrella、scarf、sunglasses、hat） |
| `/pompom inventory` | 查看 Pompom 的背包 |

### 语音和音效

| 命令 | 功能 |
|------|------|
| `/pompom:voice` | 语音状态 — 引擎、语音、性格、音量 |
| `/pompom:voice on\|off` | 启用/禁用语音合成 |
| `/pompom:voice setup` | 互动语音配置 |
| `/pompom:voice test` | 播放测试语音 |
| `/pompom:voice kokoro\|deepgram\|elevenlabs` | 切换 TTS 引擎 |
| `/pompom:voice voices` | 列出当前引擎可用语音 |
| `/pompom:voice volume <0-100>` | 调节语音音量 |
| `/pompom:voice quiet\|normal\|chatty\|professional\|mentor\|zen` | 设置性格 |
| `/pompom:ambient` | 环境音效状态 |
| `/pompom:ambient on\|off` | 启用/禁用天气环境音效 |
| `/pompom:ambient volume <0-100>` | 调节环境音量 |
| `/pompom:ambient pregenerate` | 立即生成全部5种天气音效 |
| `/pompom:ambient reset` | 删除已生成音效，重新生成 |
| `/pompom:ambient folder` | 显示自定义音频文件夹路径 |

### AI 和代理智能

| 命令 | 功能 |
|------|------|
| `/pompom:chat` | 打开 Pompom 侧边聊天（并行 AI 助手） |
| `/pompom:ask <问题>` | 向 Pompom 询问会话信息 |
| `/pompom:recap` | 获取简要会话摘要 |
| `/pompom:agents` | 代理活动仪表盘 |
| `/pompom:stuck` | 检查代理是否卡在错误循环中 |
| `/pompom:analyze` | 深度 AI 驱动的会话分析 |
| `/pompom-settings` | 互动设置面板（9个标签） |

## 快捷键

| macOS | Windows/Linux | 动作 |
|-------|--------------|------|
| `⌥p` | `Alt+p` | 抚摸 |
| `⌥n` | `Alt+n` | 喂食 |
| `⌥t` | `Alt+t` | 零食 |
| `⌥u` | `Alt+u` | 拥抱 |
| `⌥r` | `Alt+r` | 扔球 |
| `⌥x` | `Alt+x` | 跳舞 |
| `⌥g` | `Alt+g` | 游戏 |
| `⌥m` | `Alt+m` | 音乐 |
| `⌥c` | `Alt+c` | 主题 |
| `⌥s` | `Alt+s` | 睡觉 |
| `⌥a` | `Alt+a` | 醒来 |
| `⌥z` | `Alt+z` | 翻转 |
| `⌥o` | `Alt+o` | 隐藏 |
| `⌥v` | `Alt+v` | 切换视图 |
| `⌥/` | `Alt+/` | Pompom 侧边聊天 |

> **注意：** Alt+f、Alt+b、Alt+d、Alt+h、Alt+w 被 Pi 内置编辑器占用。Pompom 使用不冲突的安全替代键。

## 功能

### 3D 渲染
- 带实时光照、阴影和地面反射的光线行进身体
- 混合渲染器：边缘使用象限块（2倍细节），平滑区域使用半块
- 4种颜色主题：Cloud、Cotton Candy、Mint Drop、Sunset Gold
- 自然动画：眨眼、呼吸、耳朵摆动、尾巴摇摆

### 场景和天气
- 平滑天空颜色过渡（黎明到黄昏）
- 太阳圆盘、弯月、闪烁星星、起伏山丘、摇曳草叶
- 5种天气：晴天、多云、雨、暴风雨、雪
- 每30分钟至2小时自然过渡
- 雨条、暴风雨闪电、轻柔雪花

### 语音合成（3种引擎）

| 引擎 | 类型 | 语音数 | 特殊功能 |
|------|------|--------|---------|
| **ElevenLabs** | 云端（最佳） | 19种 | v3 音频标签：`[laughs]`、`[sighs]`、`[excited]`、`[whispers]` |
| **Deepgram** | 云端 | 5种 Aura-2 | 标点符号自然韵律 |
| **Kokoro** | 本地（免费） | 8种 | Markdown 发音 `[word](/IPA/)`、重音控制 |

音频标签自动适配引擎 — ElevenLabs 保留 `[laughs]`，Kokoro 和 Deepgram 自动去除。

### 6种语音性格

| 模式 | 行为 |
|------|------|
| **安静** | 仅用户操作和错误 |
| **普通** | 适度、随意（默认） |
| **话多** | 频繁评论 |
| **专业** | 错误、里程碑、直接操作 |
| **导师** | 在错误和完成时引导 |
| **禅** | 近乎静音 |

### 情感反应
Pompom 使用 ElevenLabs v3 音频标签表达自然情感：

- **饥饿** (<30%)：`[sad] My tummy is rumbling...`、`[crying] Feed me!`
- **极度饥饿** (<15%)：`[wheezing] Everything looks like food...`
- **疲劳** (<15%)：`[whispers] Just five more minutes...`
- **快乐** (>80%)：`[laughs] Life is good!`、`[sings] La la la!`
- **想玩** (>60%)：`[excited] Let's play a game!`
- **饥饿时喂食**：`[excited] FINALLY! Food! Oh that's SO good!`

每45秒最多一条情感语音。

### 环境天气音效
匹配当前天气的背景音频，叠加一次性音效。

**环境循环**（持续播放）：
- 支持 Envato Elements 或任何来源的自定义音频 — 放入 `~/.pi/pompom/ambient/custom/`
- 回退到 ElevenLabs 音效 API 生成（本地缓存）
- 语音播放时自动降至20%音量

**23种叠加音效**（一次性、上下文触发）：
- **天气**：雷声、鸟鸣、蜜蜂嗡嗡、风声、雨滴
- **操作**：呼噜、咀嚼、弹跳、拥抱、打鼾、哈欠、闪光、呼啸
- **事件**：星星叮当、游戏开始/结束、蹑手蹑脚、惊喜、萤火虫闪烁、换色、天气过渡、配饰装备、脚步声

音效音量为环境音量的15% — 微妙点缀，从不分散注意力。

### 天气配饰
- 天气变化时 Pompom 会请求配饰
- 雨伞（雨/暴风雨）、围巾（雪）、太阳镜（晴天）、帽子（收藏品）
- 配饰跨会话持久化

### 小游戏：接星星
- `/pompom game` 开始20秒挑战
- 金色星星从天空落下，接到时播放星星叮当声
- 计时结束公布分数

## 侧边聊天

按 `Alt+/` 或运行 `/pompom:chat` 打开浮动 AI 聊天面板。

- Pompom 有独立的 AI 实例并行运行 — 不会中断你的主代理
- 只读 `peek_main` 工具让 Pompom 能看到代理在做什么
- 输入 `help` 查看内置快捷指令：`analyze`、`stuck`、`recap`、`status`
- 锚定在视口底部，最大50%高度
- Esc 关闭，`Alt+/` 切换焦点

## 代理智能

Pompom 实时观察你的编码代理并做出反应。

### 7种心情状态
空闲 → 好奇 → 专注 → 忙碌 → 担忧 → 庆祝 → 困倦

心情由工具调用模式、错误率和活动时间决定。天气反映代理状态 — 错误时暴风雨，庆祝时下雪。

### 评论系统
10个事件桶，基于概率的语音：代理开始/结束、工具调用、工具错误、消息。评论间隔：任意评论最少30秒，同类60秒。

### 卡顿检测
监控4个信号：错误连续、进度停滞（>5分钟）、高错误率（>50%）、重复工具调用。置信度高时 Pompom 通过语音气泡提醒。

### AI 分析命令
- `/pompom:ask <问题>` — 关于当前会话的任何问题
- `/pompom:recap` — 简要会话摘要
- `/pompom:analyze` — 深度 AI 分析和建议
- `/pompom:agents` — 实时仪表盘：活跃工具、成功率、心情、时间

## 设置面板

运行 `/pompom-settings` 打开互动9标签设置面板。

| 标签 | 功能 |
|------|------|
| **Pompom** | 抚摸、喂食、玩耍 — 12个操作按钮 + 心情/饥饿/精力条 |
| **语音** | 选引擎、选语音、调音量、开关、测试 |
| **环境** | 开关天气音效、调音量、预生成全部5种音效 |
| **性格** | 6种语音模式，附说明 |
| **主题** | 4种颜色方案 |
| **配饰** | 赠送物品，附说明何时出现 |
| **模型** | 选择聊天/提问/分析用的 AI 模型 |
| **快捷键** | 完整键盘参考卡 |
| **关于** | 综合仪表盘：心情、饥饿、精力、天气、语音、环境、代理统计 |

方向键导航，Enter 选择，Esc 关闭。非技术用户可以在 Pompom 标签中完成所有操作。

## 工作原理

渲染器是在终端中运行的软件光线行进器。每一帧：

1. 物理模拟更新位置、粒子和状态机（60fps 子步进）
2. 场景对象带旋转和振荡构建
3. 对每个单元格取4个象限采样，边缘用象限字符，平滑区域用半块
4. 漫反射 + 包裹光照、环境光遮蔽、高光着色
5. 编码为 ANSI 真彩色转义序列
6. 语音气泡和粒子叠加层合成在顶部

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

MIT。请参阅 [LICENSE](LICENSE)。

---

<p align="center">
  <strong>由 <a href="https://abhishektiwari.co">Abhishek Tiwari</a> 制作</strong>
</p>
<p align="center">
  <a href="https://abhishektiwari.co">官网</a> ·
  <a href="https://x.com/baanditeagle">𝕏 Twitter</a> ·
  <a href="https://github.com/codexstar69/pi-pompom">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom">npm</a> ·
  <a href="https://github.com/codexstar69/pi-pompom/issues">报告问题</a> ·
  <a href="https://github.com/mariozechner/pi-coding-agent">Pi CLI</a>
</p>
