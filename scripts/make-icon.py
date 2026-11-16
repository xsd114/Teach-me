# -*- coding: utf-8 -*-
"""
图标生成器：把一张带黑边的截图，裁成干净的方形图标。

    python scripts/make-icon.py                     # 用 build/icon-source.png
    python scripts/make-icon.py 别的图.png          # 指定源图

产出：
    build/icon.png           512×512 主图（打包进 exe 用）
    build/icon.ico          多尺寸 ico（16/24/32/48/64/128/256）
    apps/web/public/icon-256.png   网页 favicon

为什么要裁：截图右下角有纯黑边（#1e1e1f），直接当图标会偏，Windows 上看着像缺一块。
裁法是按"亮度>阈值"的行列包围盒，不写死坐标 —— 换一张图也能用。
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "icon-source.png"
MASTER = 512
THRESHOLD = 45  # 黑边亮度约 31，画面最暗处也在 60 以上


def content_box(im: Image.Image) -> tuple[int, int, int, int]:
    """按列/行平均亮度找画面范围，去掉纯黑边。"""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    cols = [max(sum(max(px[x, y]) for y in range(h)) / h, 0) for x in range(w)]
    rows = [max(sum(max(px[x, y]) for x in range(w)) / w, 0) for y in range(h)]

    xs = [x for x, v in enumerate(cols) if v > THRESHOLD]
    ys = [y for y, v in enumerate(rows) if v > THRESHOLD]
    if not xs or not ys:
        return (0, 0, w, h)
    return (xs[0], ys[0], xs[-1] + 1, ys[-1] + 1)


def square(im: Image.Image) -> Image.Image:
    """裁成正方形：以短边为准居中裁，保证不变形。"""
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    if not src.exists():
        print(f"[icon] 找不到源图：{src}")
        return 1

    im = Image.open(src).convert("RGBA")
    box = content_box(im)
    cropped = im.crop(box)
    if cropped.size[0] != cropped.size[1]:
        cropped = square(cropped)
    print(f"[icon] 源图 {im.size} → 去掉黑边 {box} → {cropped.size}")

    master = cropped.resize((MASTER, MASTER), Image.LANCZOS)
    # 从截图放大过来的图会有点糊，轻微锐化把眼睛和发丝拉回来
    master = master.filter(ImageFilter.UnsharpMask(radius=1.6, percent=110, threshold=2))

    out_png = ROOT / "build" / "icon.png"
    master.save(out_png, "PNG")
    print(f"[icon] {out_png}  {master.size[0]}×{master.size[1]}")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    out_ico = ROOT / "build" / "icon.ico"
    master.save(out_ico, format="ICO", sizes=ico_sizes)
    print(f"[icon] {out_ico}  {len(ico_sizes)} 个尺寸")

    web_dir = ROOT / "apps" / "web" / "public"
    web_dir.mkdir(parents=True, exist_ok=True)
    master.resize((256, 256), Image.LANCZOS).save(web_dir / "icon-256.png", "PNG")
    master.resize((64, 64), Image.LANCZOS).save(web_dir / "icon-64.png", "PNG")
    print(f"[icon] {web_dir / 'icon-256.png'} + icon-64.png")

    # 打包用：图标要能进 dist-electron，主进程按这个路径取窗口图标
    dist = ROOT / "dist-electron"
    if dist.exists():
        master.resize((256, 256), Image.LANCZOS).save(dist / "icon.png", "PNG")
        print(f"[icon] {dist / 'icon.png'}（已存在的 dist-electron 顺手更新）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
