# 中文字体（思源黑体子集）

页面用 **思源黑体**。CSS 里字体族名是 `KnowFit Sans`：Mac 先命中系统苹方（`local`），
其他平台加载本目录的子集文件，Windows 不再退回微软雅黑。

- **来源**：Google Fonts 的 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)
  可变字体（与思源黑体同源）。
- **许可**：SIL OFL 1.1，见 `OFL.txt`。OFL 保留字体名包含 `Source`，
  **子集属于修改版，故字体名改为 `KnowFit Sans`**；版权声明保留在字体的 name 表里。
- **字重**：400 / 500 两档，由可变字体 `wght` 轴实例化；600–700 由浏览器合成加粗（ADR-052）。
- **子集**：ASCII + Latin-1 + CJK 标点 + 全角形式 + GB2312 一级汉字（3755 个）
  + 应用自身文案用字，约 4300 字符；单档约 580KB。生僻字逐字回退到系统字体。
- `PingFangSC-*.woff2` 是苹果专有字体，只留在本机，已被 `.gitignore` 排除，**不要提交**。

## 重新生成

需要 `pip install fonttools brotli`。

```bash
# 1. 取可变字体
curl -L -o NotoSansSC-VF.ttf \
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"

# 2. 实例化两档
python -m fontTools.varLib.instancer NotoSansSC-VF.ttf wght=400 --output=NotoSansSC-Regular.ttf
python -m fontTools.varLib.instancer NotoSansSC-VF.ttf wght=500 --output=NotoSansSC-Medium.ttf

# 3. 改名（OFL 保留名 Source；子集是修改版）
python - <<'PY'
from fontTools.ttLib import TTFont
for weight, sub in ((400, "Regular"), (500, "Medium")):
    f = TTFont(f"NotoSansSC-{sub}.ttf")
    for nid, value in ((1, "KnowFit Sans"), (2, sub), (4, f"KnowFit Sans {sub}"),
                       (6, f"KnowFitSans-{sub}"), (16, "KnowFit Sans"), (17, sub)):
        f["name"].setName(value, nid, 3, 1, 0x409)
        f["name"].setName(value, nid, 1, 0, 0)
    f["OS/2"].usWeightClass = weight
    f.save(f"KnowFitSans-{sub}.ttf")
PY

# 4. 生成字符表（GB2312 一级 + 应用文案，在仓库根目录执行）
python - <<'PY'
import pathlib
chars = {chr(c) for c in range(0x20, 0x7F)} | {chr(c) for c in range(0xA0, 0x100)}
chars |= {chr(c) for c in range(0x3000, 0x3040)} | {chr(c) for c in range(0xFF00, 0xFFF0)}
for b1 in range(0xB0, 0xD8):
    for b2 in range(0xA1, 0xFF):
        try: chars.add(bytes([b1, b2]).decode("gb2312"))
        except UnicodeDecodeError: pass
chars.update("·•→←↑↓×÷°±≥≤≠≈…—–‘’“”「」『』【】〔〕《》〈〉、。，！？；：（）▪▶▸✓✔✕✖★☆⚠♥")
for pat in ("apps/web/src/**/*.tsx", "apps/web/src/**/*.ts", "apps/api/seed/*.json", "apps/api/src/**/*.ts"):
    for p in pathlib.Path(".").glob(pat):
        chars.update(p.read_text(encoding="utf-8"))
chars = {c for c in chars if c.isprintable() or c == "　"}
open("charset-l1.txt", "w", encoding="utf-8").write("".join(sorted(chars)))
PY

# 5. 子集化
pyftsubset KnowFitSans-Regular.ttf --text-file=charset-l1.txt --flavor=woff2 \
  --output-file=KnowFitSans-Regular.woff2 --layout-features='*' --no-hinting --name-IDs='*'
pyftsubset KnowFitSans-Medium.ttf --text-file=charset-l1.txt --flavor=woff2 \
  --output-file=KnowFitSans-Medium.woff2 --layout-features='*' --no-hinting --name-IDs='*'
```