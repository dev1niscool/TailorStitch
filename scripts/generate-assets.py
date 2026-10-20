"""Generate original, deterministic demo screenshots and app icons.

Requires Pillow and the DejaVu fonts shipped with most Linux distributions.
No network, external imagery, or generated personal information is used.
"""

from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SCALE = 3
WIDTH = 420
VIEWPORT = 670
HEADER = 74
FOOTER = 36
OFFSETS = [0, 400, 800]
HEIGHT = VIEWPORT + OFFSETS[-1]
PAPER = "#faf8f2"
INK = "#26332b"
MUTED = "#69756c"
LINE = "#dedfd4"
LIME = "#d6f79b"
FONTS = Path("/usr/share/fonts/truetype/dejavu")


def font(size, kind="sans"):
    files = {
        "sans": "DejaVuSans.ttf",
        "bold": "DejaVuSans-Bold.ttf",
        "serif": "DejaVuSerif.ttf",
        "italic": "DejaVuSerif-Italic.ttf",
    }
    return ImageFont.truetype(str(FONTS / files[kind]), round(size * SCALE))


class Canvas:
    def __init__(self, width, height, background=PAPER):
        self.image = Image.new("RGB", (width * SCALE, height * SCALE), background)
        self.draw = ImageDraw.Draw(self.image)

    def box(self, rect, fill, radius=0, outline=None, width=1):
        coords = tuple(round(v * SCALE) for v in rect)
        if radius:
            self.draw.rounded_rectangle(
                coords, radius=round(radius * SCALE), fill=fill,
                outline=outline, width=round(width * SCALE)
            )
        else:
            self.draw.rectangle(
                coords, fill=fill, outline=outline, width=round(width * SCALE)
            )

    def text(self, xy, value, size=14, color=INK, kind="sans"):
        self.draw.text(
            (round(xy[0] * SCALE), round(xy[1] * SCALE)), value,
            fill=color, font=font(size, kind)
        )

    def line(self, points, color=LINE, width=1):
        self.draw.line(
            [(round(x * SCALE), round(y * SCALE)) for x, y in points],
            fill=color, width=round(width * SCALE)
        )

    def ellipse(self, rect, fill, outline=None, width=1):
        self.draw.ellipse(
            tuple(round(v * SCALE) for v in rect), fill=fill,
            outline=outline, width=round(width * SCALE)
        )

    def polygon(self, points, fill):
        self.draw.polygon(
            [(round(x * SCALE), round(y * SCALE)) for x, y in points],
            fill=fill
        )

    def finish(self):
        return self.image.resize(
            (self.image.width // SCALE, self.image.height // SCALE),
            Image.Resampling.LANCZOS
        )


def label(canvas, xy, value, color=MUTED):
    canvas.text(xy, value, 10, color, "bold")


def skyline(canvas, x, y, width=364, height=220):
    """A small original geometric canal illustration."""
    canvas.box((x, y, x + width, y + height), "#c7d9dd", radius=12)
    canvas.ellipse((x + 282, y + 25, x + 321, y + 64), "#f8edbf")
    water = y + 151
    canvas.box((x, water, x + width, y + height), "#86b5b4")
    houses = [
        (10, 47, 104, "#e8b362"),
        (59, 43, 119, "#c87152"),
        (104, 50, 95, "#e9d8af"),
        (157, 43, 127, "#697f77"),
        (203, 45, 107, "#d69a82"),
        (251, 44, 117, "#f1d285"),
        (297, 52, 91, "#9c7271"),
    ]
    for index, (dx, hw, hh, color) in enumerate(houses):
        left, right, base = x + dx, x + dx + hw, water - 4
        top = base - hh
        canvas.box((left, top, right, base), color)
        canvas.polygon(
            [(left - 2, top), ((left + right) / 2, top - 22), (right + 2, top)],
            "#59615b"
        )
        for column in range(2):
            for row in range(3):
                wx = left + 9 + column * (hw - 22)
                wy = top + 16 + row * 23
                canvas.box((wx, wy, wx + 7, wy + 12), "#f4f0dd")
                canvas.line([(wx + 3.5, wy), (wx + 3.5, wy + 12)], "#75847e", .6)
        canvas.box((left + hw / 2 - 5, base - 21, left + hw / 2 + 5, base), "#4c625a")
        for row in range(3):
            ry = water + 10 + row * 15 + index % 2 * 3
            canvas.line(
                [(left + 3 + row * 3, ry), (right - 4 - row * 2, ry)],
                color, 3
            )
    canvas.line([(x, water - 3), (x + width, water - 3)], "#faf0cf", 4)
    # A tiny sailboat, rendered from shapes rather than external imagery.
    canvas.line([(x + 225, water + 3), (x + 225, water + 49)], "#384b49", 2)
    canvas.polygon(
        [(x + 222, water + 6), (x + 191, water + 40), (x + 222, water + 40)],
        "#fff4da"
    )
    canvas.polygon(
        [(x + 185, water + 44), (x + 239, water + 44),
         (x + 232, water + 53), (x + 194, water + 53)], "#476b65"
    )


def cup(canvas, x, y):
    canvas.box((x, y, x + 54, y + 54), "#e8dbc6", radius=12)
    canvas.ellipse((x + 12, y + 34, x + 42, y + 41), "#c4b294")
    canvas.ellipse((x + 34, y + 17, x + 44, y + 29), None, "#fffaf0", 4)
    canvas.box((x + 13, y + 17, x + 36, y + 35), "#fffaf0", radius=5)
    canvas.ellipse((x + 13, y + 13, x + 36, y + 22), "#fffaf0")
    canvas.ellipse((x + 17, y + 16, x + 32, y + 20), "#7c513c")


def bicycle(canvas, x, y):
    canvas.box((x, y, x + 54, y + 54), "#dce7c9", radius=12)
    for cx in (x + 14, x + 40):
        canvas.ellipse((cx - 8, y + 26, cx + 8, y + 42), None, "#536647", 2)
    canvas.line(
        [(x + 14, y + 34), (x + 22, y + 22), (x + 31, y + 34),
         (x + 14, y + 34), (x + 24, y + 34), (x + 34, y + 21),
         (x + 40, y + 34)], "#536647", 2
    )
    canvas.line([(x + 19, y + 20), (x + 27, y + 20)], "#536647", 2)
    canvas.line([(x + 32, y + 18), (x + 38, y + 18)], "#536647", 2)


def map_tile(canvas, x, y):
    canvas.box((x, y, x + 54, y + 54), "#d9e5e7", radius=12)
    canvas.line([(x + 8, y + 12), (x + 43, y + 42)], "#fdfbf0", 7)
    canvas.line([(x + 8, y + 40), (x + 44, y + 13)], "#fdfbf0", 5)
    canvas.ellipse((x + 20, y + 14, x + 35, y + 29), "#bd6e53")
    canvas.polygon([(x + 20, y + 24), (x + 35, y + 24), (x + 27.5, y + 36)], "#bd6e53")
    canvas.ellipse((x + 25, y + 19, x + 30, y + 24), PAPER)


def item(canvas, y, time, title, lines, illustration):
    illustration(canvas, 28, y + 1)
    label(canvas, (97, y), time, "#8e6048")
    canvas.text((97, y + 18), title, 17, kind="serif")
    for index, line in enumerate(lines):
        canvas.text((97, y + 46 + index * 21), line, 12, MUTED)


def generate_demo():
    canvas = Canvas(WIDTH, HEIGHT)
    label(canvas, (28, 26), "THE WEEKEND EDIT  /  NO. 014", "#829273")
    canvas.text((26, 54), "A slow weekend", 31, kind="serif")
    canvas.text((26, 94), "in Copenhagen.", 31, kind="serif")
    canvas.text((28, 145), "Good coffee. Long walks. No rush.", 14, MUTED)
    canvas.box((28, 181, 139, 208), "#e8eddd", radius=13)
    canvas.text((40, 187), "3 DAYS · DENMARK", 9, "#596850", "bold")
    canvas.text((266, 188), "By Fieldnotes", 11, MUTED)
    skyline(canvas, 28, 228)
    label(canvas, (28, 464), "55.6761° N  /  12.5683° E", "#7a8f87")
    canvas.text((279, 463), "Take the scenic route.", 10, MUTED)
    canvas.line([(28, 501), (392, 501)])

    label(canvas, (28, 524), "FRIDAY  /  01", "#8e6048")
    canvas.text((28, 548), "Arrive without a plan.", 24, kind="serif")
    canvas.text((28, 586), "Drop your bags. Let the city set the pace.", 13, MUTED)
    item(canvas, 626, "16:00", "Find the waterfront",
         ["Walk beside the painted houses.", "Stay until the light turns golden."], map_tile)
    canvas.line([(28, 742), (392, 742)])

    label(canvas, (28, 765), "SATURDAY  /  02", "#8e6048")
    canvas.text((28, 789), "A little of everything.", 24, kind="serif")
    item(canvas, 837, "09:30", "Coffee, then another",
         ["A warm cup and a flaky pastry.", "Leave your morning wide open."], cup)
    item(canvas, 951, "12:00", "See it on two wheels",
         ["Take the quiet streets north.", "Stop wherever curiosity leads."], bicycle)
    canvas.line([(28, 1068), (392, 1068)])

    label(canvas, (28, 1091), "SUNDAY  /  03", "#8e6048")
    canvas.text((28, 1115), "One more wander.", 24, kind="serif")
    item(canvas, 1167, "10:00", "Something to take home",
         ["A market, a book, a small keepsake.", "The best finds are unplanned."], map_tile)
    canvas.box((28, 1297, 392, 1411), "#e7eddb", radius=12)
    label(canvas, (46, 1314), "A NOTE FOR THE ROAD", "#637553")
    canvas.text((46, 1340), "Leave room for the unexpected.", 16, kind="italic")
    canvas.text((46, 1371), "That is usually where the good stories begin.", 11, MUTED)
    label(canvas, (28, 1437), "FIELDNOTES  /  GO SLOW. LOOK CLOSER.", "#87917f")

    content = canvas.finish()
    fixture_dir = ROOT / "tests" / "fixtures"
    demo_dir = ROOT / "public" / "demo"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    demo_dir.mkdir(parents=True, exist_ok=True)
    content.save(fixture_dir / "demo-source.png", optimize=True)

    header = Canvas(WIDTH, HEADER, PAPER)
    header.text((28, 7), "9:41", 11, kind="bold")
    for index, height in enumerate((3, 5, 7, 9)):
        header.box((343 + index * 4, 20 - height, 345 + index * 4, 20), INK)
    header.box((369, 10, 389, 20), None, radius=3, outline=INK)
    header.box((372, 13, 385, 17), INK, radius=1)
    header.box((391, 13, 392, 17), INK)
    header.box((28, 39, 43, 55), "#7b946b", radius=3)
    header.line([(32, 43), (39, 43), (39, 51), (32, 51)], PAPER, 1)
    header.text((52, 37), "fieldnotes", 18, kind="serif")
    header.line([(369, 42), (390, 42)], INK, 1.5)
    header.line([(369, 49), (390, 49)], INK, 1.5)
    header.line([(0, 73), (420, 73)], LINE)
    header_image = header.finish()

    footer = Canvas(WIDTH, FOOTER, INK)
    footer.text((29, 10), "EXPLORE", 9, LIME, "bold")
    footer.text((176, 10), "SAVED", 9, "#c6cec2", "bold")
    footer.text((323, 10), "PROFILE", 9, "#c6cec2", "bold")
    footer_image = footer.finish()
    for index, offset in enumerate(OFFSETS):
        screenshot = Image.new("RGB", (WIDTH, HEADER + VIEWPORT + FOOTER), PAPER)
        screenshot.paste(header_image, (0, 0))
        screenshot.paste(content.crop((0, offset, WIDTH, offset + VIEWPORT)), (0, HEADER))
        screenshot.paste(footer_image, (0, HEADER + VIEWPORT))
        screenshot.save(demo_dir / f"{index + 1:02d}.png", optimize=True)

    expected = Image.new("RGB", (WIDTH, HEADER + HEIGHT + FOOTER), PAPER)
    expected.paste(header_image, (0, 0))
    expected.paste(content, (0, HEADER))
    expected.paste(footer_image, (0, HEADER + HEIGHT))
    expected.save(fixture_dir / "demo-expected.png", optimize=True)
    metadata = {
        "description": "Original fictional travel guide; crops from one continuous image.",
        "files": ["public/demo/01.png", "public/demo/02.png", "public/demo/03.png"],
        "source": "tests/fixtures/demo-source.png",
        "expectedWithChrome": "tests/fixtures/demo-expected.png",
        "width": WIDTH,
        "screenshotHeight": HEADER + VIEWPORT + FOOTER,
        "header": HEADER,
        "footer": FOOTER,
        "contentViewportHeight": VIEWPORT,
        "offsets": OFFSETS,
        "pairOverlaps": [VIEWPORT - (b - a) for a, b in zip(OFFSETS, OFFSETS[1:])],
        "sourceHeight": HEIGHT,
        "expectedHeightWithChrome": HEADER + HEIGHT + FOOTER,
        "expectedHeightWithoutChrome": HEIGHT,
    }
    (fixture_dir / "demo.json").write_text(json.dumps(metadata, indent=2) + "\n")


def generate_icons():
    icon_dir = ROOT / "public" / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    icon = Canvas(512, 512, "#262b23")
    # Original overlapping frames and dashed seam mark.
    icon.box((122, 91, 325, 309), "#262b23", radius=35, outline=LIME, width=14)
    icon.box((184, 203, 389, 421), "#262b23", radius=35, outline=LIME, width=14)
    icon.box((185, 203, 325, 308), "#333e28")
    icon.line([(184, 203), (325, 203), (325, 309)], LIME, 14)
    icon.line([(184, 203), (184, 309), (325, 309)], LIME, 14)
    for x in range(207, 307, 34):
        icon.line([(x, 257), (x + 15, 257)], LIME, 7)
    master = icon.image
    for size in (180, 192, 512, 1024):
        filename = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
        master.resize((size, size), Image.Resampling.LANCZOS).save(icon_dir / filename, optimize=True)
    # Keep a size-named alias for consumers that expect it.
    (icon_dir / "icon-180.png").write_bytes((icon_dir / "apple-touch-icon.png").read_bytes())


if __name__ == "__main__":
    generate_demo()
    generate_icons()
    print("Generated 3 screenshots, 2 pixel fixtures, metadata, and 5 original icons.")
