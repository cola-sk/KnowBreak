"""生成 KnowBreak 极简科技风 Logo（PNG + SVG），无文字版本。"""
from PIL import Image, ImageDraw
import math
import os

# ── 设计参数 ──
SIZE = 512
BG = (245, 245, 250)         # 亮色背景
ACCENT = (232, 100, 108)       # 珊瑚红 #e8646c
ACCENT_LIGHT = (252, 165, 165) # 浅珊瑚 #fca5a5
WHITE = (50, 30, 35)           # 暗暖色碎片
DIM = (200, 170, 170)         # 暖灰辅助线


def _hex_points(cx, cy, r, start_angle=30):
    """正六边形顶点"""
    return [
        (cx + r * math.cos(math.radians(start_angle + 60 * i)),
         cy + r * math.sin(math.radians(start_angle + 60 * i)))
        for i in range(6)
    ]


def generate_png(out_path: str):
    img = Image.new("RGBA", (SIZE, SIZE), (*BG, 255))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2
    hex_r = 110

    # 六边形外框 — 完整轮廓（淡色）
    pts = _hex_points(cx, cy, hex_r)
    draw.polygon(pts, fill=None, outline=(*DIM, 255), width=3)

    # 拆解碎片：把六边形切成 3 个碎片，各碎片向外偏移
    fragments = [
        # 上三角 → 向上偏移
        {"pts_indices": [0, 1, "c"], "dx": 0, "dy": -22, "fill": (*ACCENT, 230)},
        # 右三角 → 向右偏移
        {"pts_indices": [2, 3, "c"], "dx": 22, "dy": 0, "fill": (*WHITE, 190)},
        # 左三角 → 向左偏移
        {"pts_indices": [4, 5, "c"], "dx": -22, "dy": 4, "fill": (*ACCENT_LIGHT, 180)},
    ]
    for frag in fragments:
        coords = []
        for idx in frag["pts_indices"]:
            if idx == "c":
                base = (cx, cy)
            else:
                base = pts[idx]
            coords.append((base[0] + frag["dx"], base[1] + frag["dy"]))
        draw.polygon(coords, fill=frag["fill"], outline=(*ACCENT, 255), width=2)

    # 中心点 — 知识锚点
    dot_r = 7
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=(*ACCENT, 255))

    # 连线：从中心向三个碎片中心发射
    for frag in fragments:
        frag_pts = []
        for idx in frag["pts_indices"]:
            if idx == "c":
                frag_pts.append((cx + frag["dx"], cy + frag["dy"]))
            else:
                px, py = pts[idx]
                frag_pts.append((px + frag["dx"], py + frag["dy"]))
        mid = (sum(p[0] for p in frag_pts) / 3, sum(p[1] for p in frag_pts) / 3)
        draw.line([(cx, cy), mid], fill=(*DIM, 220), width=2)

    img.save(out_path, "PNG")
    print(f"✓ PNG saved: {out_path}")


def generate_svg(out_path: str):
    cx, cy = 256, 256
    hex_r = 110
    pts = _hex_points(cx, cy, hex_r)

    fragments = [
        {"indices": [0, 1], "dx": 0, "dy": -22, "fill": "rgba(232,100,108,0.9)", "stroke": "#e8646c"},
        {"indices": [2, 3], "dx": 22, "dy": 0, "fill": "rgba(50,30,35,0.75)", "stroke": "#e8646c"},
        {"indices": [4, 5], "dx": -22, "dy": 4, "fill": "rgba(252,165,165,0.7)", "stroke": "#e8646c"},
    ]

    frag_polys = []
    for frag in fragments:
        coords = []
        for idx in frag["indices"]:
            px, py = pts[idx]
            coords.append(f"{px + frag['dx']},{py + frag['dy']}")
        coords.append(f"{cx},{cy}")
        frag_polys.append({
            "points": " ".join(coords),
            "fill": frag["fill"],
            "stroke": frag["stroke"],
        })

    hex_outline = " ".join(f"{x},{y}" for x, y in pts)

    lines_svg = ""
    for frag in fragments:
        mid_x = sum(pts[i][0] + frag["dx"] for i in frag["indices"]) / len(frag["indices"])
        mid_y = sum(pts[i][1] + frag["dy"] for i in frag["indices"]) / len(frag["indices"])
        lines_svg += f'<line x1="{cx}" y1="{cy}" x2="{mid_x}" y2="{mid_y}" stroke="#c8aaaa" stroke-width="2"/>\n'

    frag_svg = "\n".join(
        f'<polygon points="{p["points"]}" fill="{p["fill"]}" stroke="{p["stroke"]}" stroke-width="2"/>'
        for p in frag_polys
    )

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f5f5fa" rx="64"/>

  <!-- 六边形完整轮廓 -->
  <polygon points="{hex_outline}" fill="none" stroke="#c8aaaa" stroke-width="3"/>

  <!-- 拆解碎片 -->
  {frag_svg}

  <!-- 中心锚点 -->
  <circle cx="{cx}" cy="{cy}" r="7" fill="#c0392b"/>

  <!-- 连线 -->
  {lines_svg}
</svg>'''

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"✓ SVG saved: {out_path}")


# ── 导航栏小尺寸版本（64x64，亮色，透明背景） ──
def generate_nav_svg(out_path: str):
    cx, cy = 32, 32
    hex_r = 14
    pts = _hex_points(cx, cy, hex_r)

    fragments = [
        {"indices": [0, 1], "dx": 0, "dy": -3, "fill": "#e8646c", "stroke": "#e8646c"},
        {"indices": [2, 3], "dx": 3, "dy": 0, "fill": "#3d2025", "stroke": "#e8646c"},
        {"indices": [4, 5], "dx": -3, "dy": 0.6, "fill": "#fca5a5", "stroke": "#e8646c"},
    ]

    frag_polys = []
    for frag in fragments:
        coords = []
        for idx in frag["indices"]:
            px, py = pts[idx]
            coords.append(f"{px + frag['dx']},{py + frag['dy']}")
        coords.append(f"{cx},{cy}")
        frag_polys.append({
            "points": " ".join(coords),
            "fill": frag["fill"],
            "stroke": frag["stroke"],
        })

    hex_outline = " ".join(f"{x},{y}" for x, y in pts)

    frag_svg = "\n".join(
        f'<polygon points="{p["points"]}" fill="{p["fill"]}" stroke="{p["stroke"]}" stroke-width="0.8"/>'
        for p in frag_polys
    )

    lines_svg = ""
    for frag in fragments:
        mid_x = sum(pts[i][0] + frag["dx"] for i in frag["indices"]) / len(frag["indices"])
        mid_y = sum(pts[i][1] + frag["dy"] for i in frag["indices"]) / len(frag["indices"])
        lines_svg += f'<line x1="{cx}" y1="{cy}" x2="{mid_x}" y2="{mid_y}" stroke="#c8aaaa" stroke-width="0.8"/>\n'

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <polygon points="{hex_outline}" fill="none" stroke="#c8aaaa" stroke-width="1.5"/>
  {frag_svg}
  <circle cx="{cx}" cy="{cy}" r="1.2" fill="#c0392b"/>
  {lines_svg}
</svg>'''

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"✓ Nav SVG saved: {out_path}")


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "assets")
    os.makedirs(out_dir, exist_ok=True)
    generate_png(os.path.join(out_dir, "logo.png"))
    generate_svg(os.path.join(out_dir, "logo.svg"))

    # 导航栏版本放到 app/src/app/static/
    nav_dir = os.path.join(os.path.dirname(__file__), "..", "app", "src", "app", "static")
    os.makedirs(nav_dir, exist_ok=True)
    generate_nav_svg(os.path.join(nav_dir, "logo-nav.svg"))
