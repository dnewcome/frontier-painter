# art/character/make_sheet.py — composes out/ines_sheet.png from the Blender renders.
from PIL import Image, ImageDraw, ImageFont
import os

O = os.path.join(os.path.dirname(__file__), "out")
BG, INK, MUTE, CARD = (239, 230, 216), (34, 28, 24), (120, 104, 90), (229, 217, 200)


def font(sz, bold=False):
    p = f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"
    return ImageFont.truetype(p, sz) if os.path.exists(p) else ImageFont.load_default()


def trim(im, pad=20):
    bb = im.getbbox()
    return im.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(im.width, bb[2] + pad), min(im.height, bb[3] + pad)))


views = ["front", "threequarter", "side", "back"]
ims = [trim(Image.open(f"{O}/ines_{v}.png").convert("RGBA")) for v in views]
hero = trim(Image.open(f"{O}/ines_hero.png").convert("RGBA"), 50)

W, H = 2400, 1500
sheet = Image.new("RGBA", (W, H), BG + (255,))
d = ImageDraw.Draw(sheet)
d.text((60, 40), "INES “OKE” OKAFOR-HALE", font=font(56, True), fill=INK)
d.text((60, 112), "Surface Engineer, Grade II — the ship's painter · Frontier Painter · concept model v2 (low-poly)",
       font=font(26), fill=MUTE)

# Turnaround: same scale for all four views, bottoms aligned.
th = 820
scale = th / max(i.height for i in ims)
x, base = 50, 170 + th
for v, im in zip(views, ims):
    s = im.resize((int(im.width * scale), int(im.height * scale)))
    sheet.alpha_composite(s, (x + (360 - s.width) // 2, base - s.height))
    label = "3/4" if v == "threequarter" else v.upper()
    tw = d.textlength(label, font=font(20, True))
    d.text((x + 180 - tw / 2, base + 14), label, font=font(20, True), fill=MUTE)
    x += 370

# Hero card on the right.
hx0, hy0, hx1, hy1 = 1560, 160, W - 40, H - 40
d.rounded_rectangle((hx0, hy0, hx1, hy1), radius=30, fill=CARD)
hs = hero.resize((int(hero.width * (hy1 - hy0 - 60) / hero.height), hy1 - hy0 - 60))
if hs.width > hx1 - hx0 - 40:
    hs = hero.resize((hx1 - hx0 - 40, int(hero.height * (hx1 - hx0 - 40) / hero.width)))
sheet.alpha_composite(hs, (hx0 + (hx1 - hx0 - hs.width) // 2, hy0 + (hy1 - hy0 - hs.height) // 2))

# Palette (2 columns) and design notes, below the turnaround.
pal = [("Safety orange", "#e8672c", "coverall"), ("Thermal teal", "#2f5f66", "undershirt"),
       ("Cryo-film", "#7cc8ee", "cold coat"), ("Trace ink", "#d9823b", "conductive · hair"),
       ("Ferro primer", "#9b6be0", "magnetic · earrings"), ("Mag-boot slate", "#3b3f47", "boots"),
       ("Goggle amber", "#f2b33d", "goggles"), ("Bandana cream", "#e9d8a6", "neckerchief")]
py = 1060
d.text((60, py), "PALETTE", font=font(24, True), fill=INK)
for i, (n, hx_, use) in enumerate(pal):
    cx, cy = 60 + (i % 2) * 370, py + 44 + (i // 2) * 88
    c = tuple(int(hx_[j:j + 2], 16) for j in (1, 3, 5))
    d.rounded_rectangle((cx, cy, cx + 64, cy + 64), radius=14, fill=c, outline=INK, width=3)
    d.text((cx + 78, cy + 4), n, font=font(21, True), fill=INK)
    d.text((cx + 78, cy + 36), f"{hx_} · {use}", font=font(16), fill=MUTE)
notes = ["Coverall sleeves tied at the waist —",
         "   regulation suit, worn her way",
         "Test swatches of every coating on the",
         "   thighs and tied sleeves",
         "Mismatched painted toe caps (cryo / trace)",
         "Violet mag-strip soles; chunky work gloves",
         "Three coating canisters = the game palette",
         "Applicator tip glows the loaded coat",
         "Amber goggles up; copper streak in her curls",
         "Patches in different decades' dye lots"]
nx = 830
d.text((nx, py), "DESIGN NOTES", font=font(24, True), fill=INK)
for i, n in enumerate(notes):
    d.text((nx, py + 44 + i * 34), ("   " if n.startswith("   ") else "• ") + n.strip(), font=font(18), fill=INK)
sheet.convert("RGB").save(f"{O}/ines_sheet.png")
print("wrote", f"{O}/ines_sheet.png")
