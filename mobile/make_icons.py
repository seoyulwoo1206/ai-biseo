# 폰 앱 아이콘 만들기: assets/icon.png(하늘냥)를 파스텔 배경 위에 올린다.
# 사용: python -X utf8 mobile/make_icons.py
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'icon.png'
OUT = ROOT / 'mobile' / 'web' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)


def background(size):
    top = (234, 241, 255)
    bottom = (255, 228, 238)
    bg = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(bg)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    return bg


def icon(size, scale, rounded=False):
    bg = background(size)
    char = Image.open(SRC).convert('RGBA')
    w = round(size * scale)
    char = char.resize((w, w), Image.LANCZOS)
    bg.alpha_composite(char, ((size - w) // 2, round((size - w) * 0.56)))
    if rounded:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=255)
        bg.putalpha(mask)
    return bg


icon(192, 0.86, rounded=True).save(OUT / 'icon-192.png')
icon(512, 0.86, rounded=True).save(OUT / 'icon-512.png')
icon(512, 0.62).save(OUT / 'maskable-512.png')  # 안드로이드가 동그랗게 잘라도 캐릭터가 안 잘리게
icon(180, 0.84).convert('RGB').save(OUT / 'apple-touch-icon.png')
for name, s in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    d = OUT / 'android' / f'mipmap-{name}'
    d.mkdir(parents=True, exist_ok=True)
    icon(s, 0.86, rounded=True).save(d / 'ic_launcher.png')
print('ok')
