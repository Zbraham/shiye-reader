"""Generate the Android launcher icon and splash artwork from build/icon.png.

The desktop icon is the visual source of truth: the glyph and its underline are
lifted out of it (with a proper alpha matte) and re-composed at the sizes
Android wants. Run with:  py -3 scripts/generate-assets.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "android/android/app/src/main/res"
SOURCE = ROOT / "build/icon.png"

CREAM = (247, 244, 236)
INK = (42, 42, 40)
BROWN = (168, 121, 79)
BORDER = (222, 213, 196)
HAIRLINE = (232, 224, 208)
MUTED = (106, 101, 91)

SERIF = "C:/Windows/Fonts/NotoSerifSC-VF.ttf"
SANS = "C:/Windows/Fonts/NotoSansSC-VF.ttf"


def alpha_crop(box, color):
    """Cut a shape drawn in `color` on the cream background, recovering alpha."""
    src = Image.open(SOURCE).convert("RGB").crop(box)
    w, h = src.size
    v = [CREAM[i] - color[i] for i in range(3)]
    denom = sum(c * c for c in v)
    out = Image.new("RGBA", (w, h), color + (0,))
    pixels = src.load()
    target = out.load()
    for y in range(h):
        for x in range(w):
            p = pixels[x, y]
            a = sum((CREAM[i] - p[i]) * v[i] for i in range(3)) / denom
            a = max(0.0, min(1.0, a))
            target[x, y] = color + (round(a * 255),)
    return out


GLYPH_BOX = (120, 88, 404, 372)
UNDERLINE_BOX = (188, 396, 324, 420)


def mark(glyph_width, center, canvas_size):
    """Compose the glyph + underline onto a transparent square canvas."""
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    glyph = alpha_crop(GLYPH_BOX, INK)
    glyph = glyph.crop(glyph.getbbox())
    scale = glyph_width / glyph.width
    glyph = glyph.resize(
        (round(glyph.width * scale), round(glyph.height * scale)),
        Image.LANCZOS,
    )
    canvas.alpha_composite(
        glyph,
        (round(center[0] - glyph.width / 2), round(center[1] - glyph.height / 2)),
    )

    underline = alpha_crop(UNDERLINE_BOX, BROWN)
    underline = underline.crop(underline.getbbox())
    uw = round(112 * scale)
    uh = max(1, round(9 * scale))
    underline = underline.resize((uw, uh), Image.LANCZOS)
    uy = round(center[1] + (408 - 229.5) * scale - uh / 2)
    canvas.alpha_composite(underline, (round(center[0] - uw / 2), uy))
    return canvas


def legacy_square(size):
    return Image.open(SOURCE).convert("RGBA").resize((size, size), Image.LANCZOS)


def round_master():
    size = 1024
    art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(art)
    inset = 5
    draw.ellipse((inset, inset, size - inset, size - inset), fill=CREAM)
    draw.ellipse(
        (inset, inset, size - inset, size - inset),
        outline=BORDER,
        width=8,
    )
    hair = round(size * 35 / 513)
    draw.ellipse(
        (hair, hair, size - hair, size - hair),
        outline=HAIRLINE,
        width=3,
    )
    art.alpha_composite(mark(266 * size / 513, (size / 2, size * 229.5 / 513), size))
    return art


def adaptive_foreground(size):
    # 48dp of a 108dp layer: comfortably inside the 66dp safe circle.
    master = mark(size * 48 / 108, (size / 2, size / 2), size)
    return master


def splash(width, height, density, landscape):
    art = Image.new("RGB", (width, height), CREAM)
    draw = ImageDraw.Draw(art)
    icon = Image.open(SOURCE).convert("RGBA")
    serif = ImageFont.truetype(SERIF, round(34 * density))
    serif.set_variation_by_name("Medium")
    tag = ImageFont.truetype(SANS, round(13 * density))
    tag.set_variation_by_name("Regular")

    if landscape:
        logo = round(76 * density)
        icon = icon.resize((logo, logo), Image.LANCZOS)
        title = "拾页"
        subtitle = "本地连载写作"
        tw = draw.textlength(title, font=serif)
        sw = draw.textlength(subtitle, font=tag)
        gap = round(22 * density)
        total = logo + gap + max(tw, sw)
        x = (width - total) / 2
        y = (height - logo) / 2
        art.paste(icon, (round(x), round(y)), icon)
        draw.text(
            (round(x + logo + gap), round(y + logo / 2 - 34 * density)),
            title,
            font=serif,
            fill=INK,
        )
        draw.text(
            (round(x + logo + gap), round(y + logo / 2 + 8 * density)),
            subtitle,
            font=tag,
            fill=MUTED,
        )
        return art

    logo = round(96 * density)
    icon = icon.resize((logo, logo), Image.LANCZOS)
    title = "拾页"
    subtitle = "本地连载写作"
    tw = draw.textlength(title, font=serif)
    sw = draw.textlength(subtitle, font=tag)
    gap1 = round(20 * density)
    gap2 = round(9 * density)
    total = logo + gap1 + 40 * density + gap2 + 16 * density
    y = (height - total) / 2 - round(height * 0.03)
    art.paste(icon, (round((width - logo) / 2), round(y)), icon)
    draw.text(
        (round((width - tw) / 2), round(y + logo + gap1)),
        title,
        font=serif,
        fill=INK,
    )
    draw.text(
        (round((width - sw) / 2), round(y + logo + gap1 + 40 * density + gap2)),
        subtitle,
        font=tag,
        fill=MUTED,
    )
    return art


def main():
    for folder, size in {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }.items():
        legacy_square(size).save(RES / folder / "ic_launcher.png")

    rounded = round_master()
    for folder, size in {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }.items():
        rounded.resize((size, size), Image.LANCZOS).save(
            RES / folder / "ic_launcher_round.png"
        )

    foreground = adaptive_foreground(432)
    for folder, size in {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }.items():
        foreground.resize((size, size), Image.LANCZOS).save(
            RES / folder / "ic_launcher_foreground.png"
        )

    portrait = {
        "drawable-port-mdpi": (320, 480, 1),
        "drawable-port-hdpi": (480, 800, 1.5),
        "drawable-port-xhdpi": (720, 1280, 2),
        "drawable-port-xxhdpi": (960, 1600, 3),
        "drawable-port-xxxhdpi": (1280, 1920, 4),
    }
    for folder, (w, h, density) in portrait.items():
        splash(w, h, density, False).save(RES / folder / "splash.png")

    landscape = {
        "drawable-land-mdpi": (480, 320, 1),
        "drawable-land-hdpi": (800, 480, 1.5),
        "drawable-land-xhdpi": (1280, 720, 2),
        "drawable-land-xxhdpi": (1600, 960, 3),
        "drawable-land-xxxhdpi": (1920, 1280, 4),
    }
    for folder, (w, h, density) in landscape.items():
        splash(w, h, density, True).save(RES / folder / "splash.png")

    splash(480, 320, 1, True).save(RES / "drawable/splash.png")
    (RES / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ic_launcher_background">#F7F4EC</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
