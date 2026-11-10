# know-fit 本地设计系统

> Figma 里的设计规范与组件，落到本地的形态。
> **一件事说清楚**：这不是"Figma 文件的导出物"，而是**从 Figma 读出来的值 + 在这里被代码化**的结果。
> 两者的区别见文末「和 Figma 的关系」。

---

## 一、为什么要有这一层

原型的令牌和组件一开始是内联在 `mobile-prototype.html` 里的。那样有两个问题：

1. **改一个颜色要翻一个 900 行的 HTML** —— 设计系统的入口应该是数据，不是一个 HTML 文件。
2. **Figma 那边会因为账号额度而打不开**（Starter 席位每月 20 次 MCP 调用）。设计系统的唯一副本
   不该住在一个可能进不去的房间里。

所以现在：**`tokens.json` 是唯一事实来源**，`tokens.css` 由它生成，组件层消费这些变量。

---

## 二、文件

> 这份设计系统随前端源码放在 `apps/web/src/design-system/`，`vite.config.ts` 的 `@design`
> 别名指向这里 —— 构建只依赖前端源码，不依赖任何外部目录。

| 文件 | 是什么 | 谁会产生它 |
|---|---|---|
| `tokens.json` | **唯一事实来源**。颜色 / 间距 / 圆角 / 字体令牌 + 字阶规范 + 组件清单 | 人（改令牌改这里） |
| `build.mjs` | 生成器：`tokens.json` → `tokens.css`；`--check` 只校验不写 | 已有 |
| `tokens.css` | **生成物，不要手改** | `node apps/web/src/design-system/build.mjs` |
| `components.css` | 组件层。所有颜色/间距/圆角都走 `var(--…)`，不写死值 | 人 |

用起来就两行：

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/components.css">
```

---

## 三、令牌表

`origin` 一栏区分**直接来自 Figma 库**和**本项目新增**。新增的都有理由，不是随手写的值。

### 颜色

| CSS 变量 | 值 | Figma 变量 | 来源 | 用在哪 |
|---|---|---|---|---|
| `--ink` | `#1E1E1E` | `Text/Default/Default` | Figma | 正文、标题、图标 |
| `--ink-2` | `#4A4A4A` | — | local | 提示条文字（需要比正文轻、但仍要过 AA） |
| `--muted` | `#757575` | `Text/Default/Secondary` | Figma | 次级文字、元信息；对白底 4.6:1 |
| `--faint` | `#B3B3B3` | `Text/Default/Tertiary` | Figma | **只用于图标与禁用态**；对白底 2.2:1，当正文不过 AA |
| `--surface` | `#FFFFFF` | `Background/Default/Default` | Figma | 页面底 |
| `--surface-2` | `#F5F5F5` | `Background/Default/Secondary` | Figma | 用户气泡、来源卡、判定块、输入胶囊 |
| `--line` | `#E6E6E6` | — | local | 卡片内分隔线（比外框更浅，密集列表里减噪） |
| `--line-2` | `#D9D9D9` | `Border/Default/Default` | Figma | 卡片外框、未选中胶囊描边 |
| `--brand` | `#2C2C2C` | `Background/Brand/Default` | Figma | 主按钮、选中胶囊、图表当前值 |
| `--chart-green` | `#14AE5C` | `Background/Positive/Default` | Figma | **仅图形**（上升柱、达标标记） |
| `--green-text` | `#0B7A45` | — | local | 正文里的"上升 / 达标"文字（`#14AE5C` 当文字只有 2.5:1） |

### 间距 / 圆角 / 字体

| 变量 | 值 | Figma 变量 | 来源 |
|---|---|---|---|
| `--s-1 … --s-8` | 4 / 8 / 12 / 16 / 24 / 32 | `Space/100 … /800` | Figma |
| `--r-1` `--r-2` `--r-4` `--r-full` | 4 / 8 / 16 / 999 | `Radius/100` `/200` `/400` `/Full` | Figma |
| `--r-3` | 12 | — | local（库里 4/8/16 之间是空的，卡片内层需要中间档） |
| `--font` | Inter 栈 | 库使用 Inter | Figma |

---

## 四、字阶：一半来自库里，一半是我们补的

库的文本样式只有 **14 / 16 / 24** 三档（`Body Small` / `Body Base` / `Heading`），外加几个变体。
390 宽的移动端用不了这套 —— 元信息落 14 就太大，标题落 24 又太大。

所以字阶是**分层**的：

- **`typeStyles`**：直接对应库的 6 个文本样式，标了 origin=figma。做 Figma 稿时优先用这几个。
- **`typeSteps`**：本项目补的密度档（11 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 17 / 18 / 26），
  标了 origin=local，每档写了用途。

**这是本原型对库最实质性的一次偏离，也是最该被 review 的一处。** 如果要做成正式设计系统，
正确做法是把这套中间档沉淀回 Figma 的文本样式，而不是让它只活在 CSS 里。

---

## 五、组件清单（Figma ↔ 本地类）

| Figma | 类型 | 变体 | 本地类 | 备注 |
|---|---|---|---|---|
| 状态栏 / Status bar | COMPONENT | — | `.statusbar` | 矢量自绘。iOS 官方 kit 因席位无权限 import，换掉了 |
| 顶部导航 / Top nav | COMPONENT_SET | `Active=会话` / `历史` / `我的` | `.topnav` `.tabs` `.tab` | 左「对话历史」+ 三文字入口 + 右「创建新会话」 |
| 气泡 / 用户消息 | COMPONENT | — | `.msg-user` | 右下角收 4px，朝向输入栏 |
| 快捷提问 / Quick chip | COMPONENT | — | `.chip` | |
| 输入栏 / Composer | COMPONENT | — | `.composer` | 胶囊输入 + 近黑圆形发送键 |
| 列表行 / 会话 | COMPONENT | — | `.conv`（抽屉）/ `.row`（卡内） | |
| 设置项 / 档案 | COMPONENT | — | `.set-row` | |
| 来源引用 / Citation | COMPONENT_SET | `有源=是` / `有源=否` | `.src` / `.nosrc` | **F5 硬约束：两类必须可区分**（ADR-005） |
| Button | 库 · COMPONENT_SET | `Primary`/`Subtle` × `Small` | `.btn` `.btn--ghost` | 取自官方库 |
| Icon Button | 库 · COMPONENT_SET | `Neutral` × `Medium` | `.icon-btn` | 取自官方库 |
| Switch Field | 库 · COMPONENT_SET | `Checked` | `.switch` | 取自官方库 |
| Avatar | 库 · COMPONENT_SET | `Initial` × `Medium` × `Circle` | `.avatar` | 取自官方库 |
| —（本地组合） | — | — | `.card` `.hook` `.verdict` `.advice` | 记录确认卡 / 数据钩子 / 评估卡。单屏一次性使用，**没有进 Figma** |

---

## 六、防漂移闸门

`tokens.css` 是生成物，手改它会和 `tokens.json` 对不上。所以有一个检查：

```bash
node apps/web/src/design-system/build.mjs --check   # 同步则 exit 0，不同步 exit 1
```

改令牌的正确姿势：改 `tokens.json` → 跑 `build.mjs` → 重渲染原型 → 看图确认没崩。

---

## 七、未变量化的部分（诚实清单）

| 东西 | 状态 | 为什么不变量化 |
|---|---|---|
| 字阶 | 只在 `tokens.json` 里 | 见第四节：它是本项目的局部决策，且移动端字阶要按屏微调；变量化的收益小于改造 250 行 CSS 的风险 |
| 阴影 | 只在 `tokens.json` 里 | 原型整体是扁平的，只有抽屉与画板外框用得到，还不值得抽象 |
| 组件变体 | 落在 CSS 的类上 | 原型不需要运行时切换变体 |

---

## 八、和 Figma 的关系

**Figma 文件**：<https://www.figma.com/design/5CWT6TIPdCxZ2re7bkJ2dm>

里面实际做完的是：

- 页 `01 · 设计规范` —— 8 个色板（绑变量）、6 条文字样式样张、间距与圆角刻度
- 页 `02 · 组件` —— 状态栏、顶部导航（3 变体）、用户气泡、快捷提问、会话列表行、输入栏、
  设置项、来源引用（2 变体），外加一块官方库组件参照
- 页 `03 · 移动端原型` —— **空的**。12 个屏没有画进 Figma

**本地这一层**是怎么来的：令牌值是用 figma MCP 读库变量的解析值（含模式）之后**转写**的，
文本样式与效果样式同样。**没有做逐项二次核对。**

**为什么没继续**：Starter 席位的 MCP 调用额度用满了（官方口径：Starter 20 次/月，见
[Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access)）。
这与脚本、设计都无关，是账号额度问题。

### 重新同步（额度恢复后怎么做）

额度回来后，按这个顺序把两边对齐 —— **别直接改 `tokens.json`**：

1. 用 `get_design_context` 或 `use_figma` 读回页 `01 · 设计规范` 的色板/字阶/圆角样张，
   以及页 `02 · 组件` 的组件清单；
2. 与 `tokens.json` 逐项对照，把差异写进一次可 review 的提交（改的是 JSON，不是 CSS）；
3. 跑 `node apps/web/src/design-system/build.mjs` 重新生成 CSS；
4. 重渲染原型，对照 Figma 确认没崩（渲染脚本属于原型留档，不在本仓库内）；
5. 如果差异来自"Figma 改过而本地没跟上"，同样走这个流程 —— **两边永远以 Figma 为上游**。

### 两条还没做完的事（留给下次）

1. **页 `03 · 移动端原型` 的 12 个屏**。有两条路：
   用 `use_figma` 按本文件的组件清单逐屏搭（约 8–12 次调用），
   或起个本地 http server 用 `generate_figma_design` 一次抓进去（1 次调用，但节点是像素级的）。
2. **第四节那套本地字阶**应当沉淀回 Figma 的文本样式，否则它只是原型里的私货。
