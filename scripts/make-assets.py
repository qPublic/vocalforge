"""Generate installer artwork and the app icon into build/. Run: python scripts/make-assets.py"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'build')
BG_TOP, BG_BOT = (29, 33, 42), (14, 16, 20)
ACCENT, ACCENT2 = (76, 194, 255), (70, 211, 154)
BARS = [0.35, 0.6, 0.85, 1.0, 0.75, 0.9, 0.55, 0.7, 0.4]


def gradient(w, h):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)))
    return img


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def draw_bars(d, x, y, w, h, bars=BARS, gap_ratio=0.45):
    n = len(bars)
    bw = w / (n + (n - 1) * gap_ratio)
    for i, v in enumerate(bars):
        bx = x + i * bw * (1 + gap_ratio)
        bh = h * v
        d.rounded_rectangle([bx, y + (h - bh) / 2, bx + bw, y + (h + bh) / 2], radius=bw / 2,
                            fill=lerp(ACCENT, ACCENT2, i / (n - 1)))


def font(size, bold=True):
    for name in ('segoeuib.ttf' if bold else 'segoeui.ttf', 'arialbd.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


# Icon: rounded dark tile with equalizer bars.
S = 512
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
tile = gradient(S, S).convert('RGBA')
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=110, fill=255)
icon.paste(tile, (0, 0), mask)
draw_bars(ImageDraw.Draw(icon), 96, 130, S - 192, S - 260)
icon.save(os.path.join(OUT, 'icon.png'))
icon.save(os.path.join(OUT, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])

# Welcome/finish page sidebar: 164x314.
side = gradient(164, 314)
d = ImageDraw.Draw(side)
draw_bars(d, 22, 40, 120, 110)
d.text((82, 190), 'VocalForge', font=font(21), fill=(230, 232, 236), anchor='mm')
d.text((82, 218), 'Make your mic\nsound better', font=font(12, False), fill=(139, 146, 160), anchor='ma', align='center')
d.rectangle([0, 308, 164, 314], fill=ACCENT)
side.save(os.path.join(OUT, 'installerSidebar.bmp'))

# Header strip on inner pages: 150x57.
head = gradient(150, 57)
d = ImageDraw.Draw(head)
draw_bars(d, 106, 12, 34, 32, bars=BARS[:5])
d.text((10, 28), 'VocalForge', font=font(14), fill=(230, 232, 236), anchor='lm')
head.save(os.path.join(OUT, 'installerHeader.bmp'))
print('assets written to', os.path.abspath(OUT))
