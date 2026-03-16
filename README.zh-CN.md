<p align="center">
  <a href="README.md">English</a> | <b>简体中文</b>
</p>

<p align="center">
  <img src="docs/images/hero.png" alt="pi-pompom" width="720">
</p>

<h1 align="center">pi-pompom</h1>
<p align="center"><strong>一个生活在终端里的 3D 光线行进虚拟宠物。</strong></p>
<p align="center">
  <!-- BADGES:START -->
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/v/@codexstar/pi-pompom.svg" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom"><img src="https://img.shields.io/npm/dm/@codexstar/pi-pompom.svg" alt="npm 下载量"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="许可证: MIT"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="平台">
  <!-- BADGES:END -->
</p>
<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#命令">命令</a> ·
  <a href="#快捷键">快捷键</a> ·
  <a href="#功能">功能</a> ·
  <a href="#设置面板">设置</a> ·
  <a href="#工作原理">原理</a>
</p>

---

Pompom 是 [Pi CLI](https://github.com/mariozechner/pi-coding-agent) 的互动伴侣。它使用混合 Unicode 象限/半块字符在编辑器上方实时渲染 3D 光线行进角色。Pompom 会走路、睡觉、追萤火虫、捡球、跳舞、接星星、穿戴天气配饰，还能回应你的语音。

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

## 命令

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
| `/pompom hide` | 走到屏幕外 |
| `/pompom give <物品>` | 赠送配饰（umbrella、scarf、sunglasses、hat） |
| `/pompom inventory` | 查看 Pompom 的背包 |
| `/pompom toggle` | 隐藏/显示动画（语音和追踪继续运行） |
| `/pompom:voice` | 语音设置 — on/off/setup/test/volume |
| `/pompom:ambient` | 环境天气音效 — on/off/volume/pregenerate |
| `/pompom:chat` | 与 Pompom 侧边聊天 |
| `/pompom:ask <问题>` | 向 Pompom 询问会话信息 |
| `/pompom:recap` | 会话摘要 |
| `/pompom:agents` | 代理状态仪表盘 |
| `/pompom:stuck` | 检查代理是否卡住 |
| `/pompom:analyze` | AI 会话分析 |
| `/pompom-settings` | 互动设置面板（9个标签） |

## 快捷键

| macOS | Windows/Linux | 动作 |
|-------|--------------|------|
| `⌥p` | `Alt+p` | 抚摸 |
| `⌥e` | `Alt+e` | 喂食 |
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
| `⌥v` | `Alt+v` | 切换视图（隐藏/显示） |
| `⌥/` | `Alt+/` | Pompom 聊天 |

> **注意：** Alt+f、Alt+b、Alt+d、Alt+h、Alt+w 被 Pi 内置编辑器占用。
> Pompom 使用不冲突的安全替代键。

支持四种输入方式：Ghostty 键绑定、ESC 前缀、macOS Unicode、Kitty 键盘协议。

## 功能

### 渲染
- 带实时光照、阴影和地面反射的 3D 光线行进身体
- 混合渲染器：边缘使用 Unicode 象限块（2倍水平细节），平滑区域使用半块
- 卡哇伊面部设计：白色巩膜、棕色虹膜、分层瞳孔/高光、明亮面板
- 暗色身体轮廓（面部跳过以增加对比度）
- 4种颜色主题：Cloud、Cotton Candy、Mint Drop、Sunset Gold

### 场景
- 通过关键帧插值平滑过渡天空颜色（从黎明到黄昏渐变，无硬切换）
- 白天带光晕的太阳圆盘，夜间带辉光的弯月
- 闪烁的彩色星星（蓝白、黄、橙红）
- 远处起伏的山丘
- 摇曳的草叶和地面上的小花
- 飘浮的云丝（即使在晴天也有）

### 天气系统
- 5种天气类型：晴天、多云、雨、暴风雨、雪
- 天气从晴天开始，每30分钟至2小时自然过渡
- 7秒平滑颜色混合过渡
- 雨条和飞溅粒子、暴风雨闪电、带风漂的轻柔雪花
- 语音气泡播报："Clouds rolling in..."、"It's starting to rain!"、"Snowflakes!"

### 天气配饰
- 天气变化时 Pompom 会请求配饰（"I wish I had an umbrella..."）
- `/pompom give umbrella` — 雨/暴风雨时的红色条纹雨伞
- `/pompom give scarf` — 下雪时的温暖条纹围巾
- `/pompom give sunglasses` — 晴天的深色反光太阳镜
- `/pompom give hat` — 帽子配饰
- 配饰跨会话持久化（保存在 `~/.pi/pompom/accessories.json`）
- 每种物品只请求一次（不会反复唠叨）

### 小游戏
- `/pompom game` 开始20秒的接星星挑战
- 金色星星从天空落下
- Pompom 自动追逐最近的星星
- 接到星星得分并产生闪光效果
- 计时结束时公布最终分数

### 语音合成
- 3种引擎：ElevenLabs（云端，最佳）、Deepgram（云端）、Kokoro（本地，免费）
- 19种 ElevenLabs 语音、5种 Deepgram 语音、8种 Kokoro 语音
- Pompom 大声说出反应、评论和公告
- 6种性格模式控制语音频率：
  - **安静** — 仅用户操作和错误
  - **普通** — 适度、随意（默认）
  - **话多** — 频繁评论
  - **专业** — 错误、里程碑、直接操作
  - **导师** — 在错误和完成时引导
  - **禅** — 近乎静音，仅在被问到时回应
- 语音测试：`/pompom:voice test`
- 音量控制：`/pompom:voice volume 0-100`

### 语音输入
- 配合 [@codexstar/pi-listen](https://www.npmjs.com/package/@codexstar/pi-listen) 使用
- 录音时 Pompom 会冲到中间面向你
- 嘴巴随音频水平同步张开（越大声张得越大）
- 耳朵随语音摆动
- 随音频振幅弹跳

### 代理追踪
- Pompom 观察编码代理并对工具调用、错误和完成做出反应
- 心情变化：空闲 → 好奇 → 专注 → 忙碌 → 担忧 → 庆祝 → 困倦
- 天气反映代理状态（错误时暴风雨，庆祝时下雪）
- 主动卡顿检测并通过语音气泡提醒
- 会话仪表盘：`/pompom:agents`
- AI 驱动的分析：`/pompom:analyze`
- 侧边聊天：`/pompom:chat` 或 `Alt+/`

### 性格与行为
- 自然的眨眼、呼吸、耳朵摆动、尾巴摇摆
- 饥饿和精力需求，带可视化状态条
- 萤火虫伙伴，Pompom 会去追
- 球的物理模拟，带弹跳和捡球行为
- 走路、偷看、翻转、跳舞、唱歌动画
- 状态栏中可读的状态信息
- 状态栏中易读的快捷键标签

### 环境天气音效
- 匹配当前天气的背景音频（雨声、风声、鸟鸣等）
- 首次播放时通过 ElevenLabs Sound Effects API 生成，本地缓存
- 语音播放时自动降至20%音量，结束后恢复
- 视图隐藏时暂停（`Alt+V`），`/pompom off` 时停止
- 预生成所有5种音效：`/pompom:ambient pregenerate`
- 默认：开启，40%音量

### 设置面板
- 使用 `/pompom-settings` 打开
- 9个标签：**Pompom** · **语音** · **环境** · **性格** · **主题** · **配饰** · **模型** · **快捷键** · **关于**
- 方向键导航，Enter 选择，Esc 关闭
- Pompom 标签让非技术用户无需了解快捷键即可抚摸、喂食和玩耍
- 快捷键标签显示完整的键盘参考卡

### 视图切换
- `Alt+V` 或 `/pompom toggle` 隐藏动画，但语音、环境音效、健康检查和代理追踪继续运行
- 再次按下即可恢复 Pompom

## 工作原理

渲染器是在终端中运行的软件光线行进器。每一帧：

1. 物理模拟更新位置、粒子和状态机（60fps 子步进）
2. 场景对象（身体、耳朵、爪子、尾巴、触角、球、食物、配饰）带旋转和振荡构建
3. 对每个单元格取4个象限采样。边缘单元格使用象限字符获得2倍水平细节。平滑单元格使用半块。
4. 物体碰撞使用漫反射 + 包裹光照、环境光遮蔽、高光、萤火虫点光源进行着色
5. 着色后的像素编码为 ANSI 真彩色转义序列
6. 语音气泡和粒子叠加层合成在顶部

组件以约7 FPS 通过150ms `setInterval` 重新渲染。

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发设置和指南。

## 安全

请参阅 [SECURITY.md](SECURITY.md) 了解漏洞报告方式。

## 许可证

MIT。请参阅 [LICENSE](LICENSE)。

---

<p align="center">
  <strong>由 <a href="https://x.com/baanditeagle">@baanditeagle</a> 制作</strong>
</p>
<p align="center">
  <a href="https://x.com/baanditeagle">𝕏 Twitter</a> ·
  <a href="https://github.com/codexstar69/pi-pompom">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@codexstar/pi-pompom">npm</a> ·
  <a href="https://github.com/codexstar69/pi-pompom/issues">报告问题</a> ·
  <a href="https://github.com/mariozechner/pi-coding-agent">Pi CLI</a>
</p>
