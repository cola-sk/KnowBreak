"""为 v003 批量生成离谱分镜的本地符号化替换图。"""
from PIL import Image, ImageDraw, ImageFont
import random

W, H = 1080, 1920
BG = (14, 14, 18)
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'
OUT = 'out/8841ee753e/v003/images/0'

ROOF = (75, 70, 65)
ROOF_D = (50, 45, 40)
WALL = (60, 55, 50)
STREET = (30, 28, 25)
RED = (180, 30, 30)
RED_DIM = (120, 20, 20)
COFFIN = (20, 18, 18)
COFFIN_O = (90, 70, 50)
WHITE = (220, 220, 220)
GRAY = (140, 140, 140)
GOLD = (200, 170, 80)


def font(size):
    return ImageFont.truetype(FONT, size)


def new():
    img = Image.new('RGB', (W, H), BG)
    return img, ImageDraw.Draw(img)


def plague_haze(draw, x1, y1, x2, y2, n=40, color=(180, 30, 30, 90)):
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    random.seed(42)
    for _ in range(n):
        px = random.randint(x1, x2)
        py = random.randint(y1, y2)
        r = random.randint(20, 70)
        od.ellipse([px-r, py-r, px+r, py+r], fill=color)
    return overlay


def data_card(draw, x, y, w, h, lines, accent=RED):
    draw.rounded_rectangle([x, y, x+w, y+h], radius=20, fill=(25, 25, 32), outline=accent, width=3)
    cy = y + 20
    for size, text, color in lines:
        f = font(size)
        draw.text((x+30, cy), text, font=f, fill=color)
        cy += size + 15


# shot 5: 华北死亡过半,整户灭绝
def shot_05():
    img, d = new()
    random.seed(1641)
    # 坟包(梯形)排列
    for _ in range(25):
        bx = random.randint(100, 950)
        by = random.randint(500, 1400)
        bw = random.randint(60, 120)
        bh = random.randint(40, 70)
        d.polygon([(bx, by+bh), (bx+bw//2, by), (bx+bw, by+bh)], fill=(50, 45, 40), outline=(70, 60, 50))
        # 十字
        cx, cy = bx+bw//2, by+bh//2
        d.line([cx, cy-10, cx, cy+10], fill=GRAY, width=2)
        d.line([cx-8, cy, cx+8, cy], fill=GRAY, width=2)
    # 人口图标递减(从左到右)
    for col, n in enumerate([12, 8, 4, 1]):
        x0 = 150 + col*220
        for i in range(n):
            px = x0 + (i % 3) * 40
            py = 1500 + (i // 3) * 50
            d.ellipse([px, py, px+20, py+20], fill=GRAY if col < 2 else RED_DIM)
    # 红色疫气
    overlay = plague_haze(d, 80, 480, 1000, 1420, n=50)
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    data_card(d, 130, 1620, 820, 220, [
        (64, '崇祯十四年 1641', RED),
        (48, '华北 · 死亡过半', WHITE),
        (40, '整户整户地死', GRAY),
    ])
    img.save(f'{OUT}/shot_005.jpg', 'JPEG', quality=92)


# shot 6: 1643大爆发 + 五行志原文
def shot_06():
    img, d = new()
    random.seed(1643)
    # 北京古城轮廓
    d.rectangle([180, 380, 900, 1400], outline=WALL, width=6)
    for cx, cy in [(540, 380), (540, 1400), (180, 890), (900, 890)]:
        d.rectangle([cx-30, cy-15, cx+30, cy+15], fill=(40, 35, 30))
    # 屋顶
    for _ in range(35):
        rx = random.randint(200, 850)
        ry = random.randint(400, 1380)
        d.rectangle([rx, ry, rx+random.randint(50,100), ry+random.randint(40,80)], fill=ROOF, outline=ROOF_D)
    # 红色全城覆盖
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle([180, 380, 900, 1400], fill=(160, 20, 20, 80))
    for _ in range(50):
        px = random.randint(190, 890)
        py = random.randint(390, 1390)
        r = random.randint(25, 65)
        od.ellipse([px-r, py-r, px+r, py+r], fill=(200, 30, 30, 100))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    # 棺材剪影
    for _ in range(6):
        cx = random.randint(220, 850)
        cy = random.randint(450, 1350)
        d.rectangle([cx, cy, cx+60, cy+30], fill=COFFIN, outline=COFFIN_O, width=2)
    # 五行志原文卡
    data_card(d, 100, 1500, 880, 350, [
        (52, '《明史·五行志》原文', GOLD),
        (44, '“京师大疫，人鬼错杂', WHITE),
        (44, '   死亡过半。”', WHITE),
        (40, '——崇祯十六年 1643', RED),
    ])
    img.save(f'{OUT}/shot_006.jpg', 'JPEG', quality=92)


# shot 7: 京营兵三万大半死于疫
def shot_07():
    img, d = new()
    # 城墙横线(三段,代表三个时段)
    for i, y in enumerate([600, 1000, 1400]):
        d.rectangle([100, y, 980, y+40], fill=(60, 55, 50), outline=(80, 75, 70))
        # 士兵剪影(从满员到稀疏)
        n = [24, 10, 3][i]
        for j in range(n):
            px = 130 + j * 35
            # 简化士兵剪影(头+身)
            d.ellipse([px, y-30, px+18, y-12], fill=GRAY if i == 0 else RED_DIM)
            d.rectangle([px, y-12, px+18, y+5], fill=GRAY if i == 0 else RED_DIM)
        # 标签
        lbl = ['崇祯初 · 三万精锐', '崇祯十四年 · 减员', '崇祯十六年 · 不足万人'][i]
        d.text((120, y+60), lbl, font=font(36), fill=WHITE if i == 0 else RED)
    # 红色疫气覆盖后两段
    overlay = plague_haze(d, 100, 950, 980, 1450, n=40, color=(180, 30, 30, 100))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    data_card(d, 130, 1620, 820, 220, [
        (56, '京营兵 30000 → 不足 10000', RED),
        (40, '城防站不满垛口', GRAY),
    ])
    img.save(f'{OUT}/shot_007.jpg', 'JPEG', quality=92)


# shot 12: 崇祯煤山自缢
def shot_12():
    img, d = new()
    # 歪脖子树剪影
    # 树干
    d.rectangle([520, 700, 560, 1500], fill=(40, 35, 30))
    # 歪脖子主枝(向左下)
    d.polygon([(520, 800), (520, 840), (300, 1000), (280, 970)], fill=(40, 35, 30))
    # 小枝
    for x1, y1, x2, y2 in [(420, 880, 350, 950), (380, 920, 320, 980), (450, 850, 400, 920)]:
        d.line([x1, y1, x2, y2], fill=(40, 35, 30), width=8)
    # 树根
    d.polygon([(490, 1500), (520, 1450), (560, 1450), (590, 1500)], fill=(30, 25, 20))
    # 绳索(从树枝垂下)
    d.line([(300, 990), (320, 1100), (340, 1200)], fill=(180, 150, 100), width=4)
    # 一个剪影人形(不画细节,只剪影)
    # 头
    d.ellipse([310, 1200, 360, 1250], fill=(15, 15, 18))
    # 身(垂着)
    d.rectangle([315, 1245, 355, 1380], fill=(15, 15, 18))
    # 月亮(氛围)
    d.ellipse([750, 200, 880, 330], fill=(60, 60, 75), outline=(100, 100, 120))
    # 数据卡
    data_card(d, 130, 1620, 820, 220, [
        (64, '崇祯十七年 1644', RED),
        (48, '煤山 · 自缢', WHITE),
        (36, '面对的是被鼠疫掏空的躯壳', GRAY),
    ])
    img.save(f'{OUT}/shot_012.jpg', 'JPEG', quality=92)


# shot 14: 压死骆驼的最后一根稻草
def shot_14():
    img, d = new()
    # 骆驼剪影(简化符号化,不画真实骆驼)
    # 身体(椭圆)
    d.ellipse([300, 1100, 750, 1250], fill=(80, 70, 60), outline=(100, 90, 75))
    # 驼峰(两个弧)
    d.ellipse([380, 1020, 520, 1130], fill=(80, 70, 60), outline=(100, 90, 75))
    d.ellipse([540, 1020, 680, 1130], fill=(80, 70, 60), outline=(100, 90, 75))
    # 脖子(向右上)
    d.polygon([(720, 1130), (760, 1130), (820, 980), (790, 970)], fill=(80, 70, 60))
    # 头
    d.ellipse([790, 950, 850, 1010], fill=(80, 70, 60))
    # 腿(四条)
    for lx in [360, 440, 620, 700]:
        d.rectangle([lx, 1240, lx+20, 1450], fill=(60, 50, 40))
    # 背上堆的东西(财政/流民/辽东)
    blocks = [(380, 950, '财政'), (470, 920, '流民'), (560, 950, '辽东')]
    for bx, by, lbl in blocks:
        d.rectangle([bx, by, bx+80, by+60], fill=(70, 65, 60), outline=(120, 100, 80))
        d.text((bx+10, by+15), lbl, font=font(36), fill=WHITE)
    # 最后一根稻草(金色,从顶上落下)
    d.line([490, 700, 490, 920], fill=GOLD, width=6)
    d.text((410, 640), '鼠疫', font=font(48), fill=GOLD)
    # 红色疫气
    overlay = plague_haze(d, 280, 1080, 770, 1450, n=20, color=(180, 30, 30, 60))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    data_card(d, 130, 1620, 820, 220, [
        (48, '压死骆驼的最后一根稻草', GOLD),
        (40, '也是最致命的一根', RED),
    ])
    img.save(f'{OUT}/shot_014.jpg', 'JPEG', quality=92)


# shot 17: 李自成军染疫撤退
def shot_17():
    img, d = new()
    # 行进箭头(向前,左到右)
    d.line([150, 700, 700, 700], fill=GRAY, width=12)
    d.polygon([(700, 670), (760, 700), (700, 730)], fill=GRAY)
    d.text((300, 620), '李自成入京', font=font(44), fill=WHITE)
    # 中段红色疫气覆盖军队
    overlay = plague_haze(d, 300, 650, 760, 760, n=30, color=(200, 30, 30, 120))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    # 折返箭头(向后,右到左,弯曲)
    d.line([760, 1100, 200, 1100], fill=RED, width=12)
    d.polygon([(200, 1070), (140, 1100), (200, 1130)], fill=RED)
    d.text((350, 1020), '染疫撤退', font=font(44), fill=RED)
    # 士兵倒下剪影(几个)
    random.seed(17)
    for _ in range(6):
        px = random.randint(250, 720)
        py = random.randint(1250, 1400)
        d.ellipse([px, py, px+25, py+25], fill=RED_DIM)
        d.rectangle([px+5, py+20, px+20, py+60], fill=RED_DIM)
    # 数据卡
    data_card(d, 130, 1500, 820, 340, [
        (44, '学者观点（存在争议）', GOLD),
        (40, '李自成军入京后染疫', WHITE),
        (40, '被迫撤退', WHITE),
        (36, '——史实仍有分歧', GRAY),
    ])
    img.save(f'{OUT}/shot_017.jpg', 'JPEG', quality=92)


# shot 18: 破城前北京已是鬼城
def shot_18():
    img, d = new()
    random.seed(1644)
    # 空城轮廓(灰色屋顶)
    for _ in range(30):
        rx = random.randint(100, 950)
        ry = random.randint(500, 1300)
        d.rectangle([rx, ry, rx+random.randint(60,120), ry+random.randint(50,90)], fill=(45, 40, 38), outline=(60, 55, 50))
    # 城墙
    d.rectangle([100, 400, 980, 450], fill=(50, 45, 40))
    d.rectangle([100, 1320, 980, 1370], fill=(50, 45, 40))
    # 红色疫气弥漫
    overlay = plague_haze(d, 80, 380, 1000, 1400, n=60, color=(160, 20, 20, 80))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    d = ImageDraw.Draw(img)
    # 鬼影(白色半透明飘忽)
    ghost = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(ghost)
    for _ in range(8):
        gx = random.randint(150, 930)
        gy = random.randint(550, 1250)
        # 鬼影形(椭圆头+波浪身)
        gd.ellipse([gx, gy, gx+40, gy+50], fill=(220, 220, 230, 60))
        gd.polygon([(gx, gy+45), (gx+40, gy+45), (gx+50, gy+100), (gx+30, gy+90), (gx+20, gy+100), (gx+10, gy+90), (gx-10, gy+100)], fill=(220, 220, 230, 50))
    img = Image.alpha_composite(img.convert('RGBA'), ghost).convert('RGB')
    d = ImageDraw.Draw(img)
    data_card(d, 130, 1500, 820, 340, [
        (64, '破城之前', RED),
        (56, '北京已是鬼城', WHITE),
        (36, '——崇祯十六年', GRAY),
    ])
    img.save(f'{OUT}/shot_018.jpg', 'JPEG', quality=92)


if __name__ == '__main__':
    for fn in [shot_05, shot_06, shot_07, shot_12, shot_14, shot_17, shot_18]:
        fn()
        print(f'  ✓ {fn.__name__}')
    # shot 9 用 wuyouke.png
    src = '/Users/liuzhe.x/pictures/wuyouke.png'
    img = Image.open(src)
    if img.mode == 'RGBA':
        bg = Image.new('RGB', img.size, BG)
        bg.paste(img, mask=img.split()[3])
        img = bg
    else:
        img = img.convert('RGB')
    w, h = img.size
    img = img.resize((1080, int(h*1080/w)), Image.LANCZOS)
    img.save(f'{OUT}/shot_009.jpg', 'JPEG', quality=92)
    print('  ✓ shot_009 (wuyouke.png)')
    print('done')
