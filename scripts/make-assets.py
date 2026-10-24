"""Generate the logo, app icon and installer artwork into build/. Run: python scripts/make-assets.py"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'build')
BG_TOP, BG_BOT = (30, 35, 46), (12, 14, 18)
CYAN, GREEN = (76, 194, 255), (70, 211, 154)
SS = 4  # supersampling factor for smooth edges


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def gradient(w, h):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(BG_TOP, BG_BOT, y / max(1, h - 1)))
    return img


def logo_mark(size):
    """The VocalForge mark: nine equalizer bars hanging from one edge, their ends tracing a 'V'. Returns RGBA."""
    big = size * SS
    n = 9
    bw = big / (n + (n - 1) * 0.5)
    bars = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(bars)
    for i in range(n):
        k = abs(i - 4) / 4  # 1 at the edges, 0 in the middle
        h = big * (0.26 + 0.66 * (1 - k))  # longest in the middle, so the bar bottoms trace a V
        x = i * bw * 1.5
        y = big * 0.04  # shared top edge
        d.rounded_rectangle([x, y, x + bw, y + h], radius=bw / 2, fill=lerp(CYAN, GREEN, i / (n - 1)) + (255,))
    # soft glow behind the bars
    glow = bars.filter(ImageFilter.GaussianBlur(big * 0.035))
    glow.putalpha(glow.getchannel('A').point(lambda a: int(a * 0.55)))
    out = Image.alpha_composite(glow, bars)
    return out.resize((size, size), Image.LANCZOS)


def font(size, bold=True):
    for name in ('segoeuib.ttf' if bold else 'segoeui.ttf', 'arialbd.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def paste_mark(img, size, x, y):
    img.paste(logo_mark(size), (x, y), logo_mark(size))


# App icon: rounded dark tile + mark.
S = 512
tile = gradient(S, S).convert('RGBA')
mask = Image.new('L', (S * SS, S * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S * SS - 1, S * SS - 1], radius=112 * SS, fill=255)
mask = mask.resize((S, S), Image.LANCZOS)
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(tile, (0, 0), mask)
paste_mark(icon, 340, 86, 86)
icon.save(os.path.join(OUT, 'icon.png'))
icon.save(os.path.join(OUT, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])

# Wizard welcome/finish sidebar: 164x314.
side = gradient(164, 314)
paste_mark(side, 112, 26, 36)
d = ImageDraw.Draw(side)
d.text((82, 190), 'VocalForge', font=font(21), fill=(230, 232, 236), anchor='mm')
d.text((82, 218), 'Make your mic\nsound better', font=font(12, False), fill=(139, 146, 160), anchor='ma', align='center')
d.rectangle([0, 308, 164, 314], fill=CYAN)
side.save(os.path.join(OUT, 'installerSidebar.bmp'))

# Wizard header strip: 150x57.
head = gradient(150, 57)
paste_mark(head, 38, 104, 9)
ImageDraw.Draw(head).text((10, 28), 'VocalForge', font=font(14), fill=(230, 232, 236), anchor='lm')
head.save(os.path.join(OUT, 'installerHeader.bmp'))
print('assets written to', os.path.abspath(OUT))
