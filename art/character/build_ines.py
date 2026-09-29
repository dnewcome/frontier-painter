# art/character/build_ines.py
# Procedural concept model of Ines "Oke" Okafor-Hale, ship's painter (see
# docs/STORY.md). Built from primitives in headless Blender, cel-shaded with an
# inverted-hull ink outline for concept renders, and exported as a plain-PBR
# GLB (no outline shells) for development use in Babylon.
#
#   LC_ALL=C LANG=C blender -b -P art/character/build_ines.py -- art/character/out
#
# Writes: ines.glb, ines.blend, and turnaround renders (front, 3q, side, back, hero).
# Blender is Z-up, metres; she faces -Y. ~1.62 m tall, stylized ~5 heads.
import math
import os
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "art/character/out"
os.makedirs(OUT, exist_ok=True)

# Start from an empty scene (the startup file's cube/camera/light would sit in frame).
for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)

# ---------------------------------------------------------------- palette ----
HEX = {
    "skin": "#8a5a3c",
    "skin_dark": "#6e4630",
    "hair": "#2a1d18",
    "copper": "#d9823b",      # trace ink
    "cryo": "#7cc8ee",        # cryo-film
    "ferro": "#9b6be0",       # ferro primer
    "orange": "#e8672c",      # safety orange coverall
    "orange2": "#d9542a",     # patch, older dye lot
    "orange3": "#f08a3e",     # patch, newer dye lot
    "teal": "#2f5f66",        # thermal undershirt
    "silver": "#d8dde2",      # hi-vis band
    "boot": "#3b3f47",
    "sole": "#23252b",
    "glove": "#c9b79c",
    "belt": "#4a3a2e",
    "strap": "#5a6470",
    "goggle": "#f2b33d",
    "lens": "#ffcf6a",
    "white": "#f6f3ec",
    "black": "#16130f",
    "scarf": "#e9d8a6",
    "blush": "#c46a5a",
    "frame": "#6c7580",
}


def rgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear for Blender colour sockets
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


# -------------------------------------------------------------- materials ----
MATS = {}
TOON = []  # (material, base colour hex, emissive?)


def mat(name, glow=0.0):
    """Cel material: Diffuse -> Shader to RGB -> 3-step constant ramp -> Emission.
    Swapped to plain Principled before the GLB export."""
    key = (name, glow)
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(f"ines_{name}{'_glow' if glow else ''}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    base = Vector(rgb(HEX[name]))
    if glow:
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*base, 1)
        em.inputs["Strength"].default_value = 2.0 + glow
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    else:
        dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
        dif.inputs["Color"].default_value = (1, 1, 1, 1)
        s2r = nt.nodes.new("ShaderNodeShaderToRGB")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.interpolation = "CONSTANT"
        cr.elements[0].position = 0.0
        cr.elements[0].color = (*(base * 0.55), 1)
        cr.elements[1].position = 0.28
        cr.elements[1].color = (*base, 1)
        hi = cr.elements.new(0.82)
        hi.color = (*[min(1.0, c * 1.25 + 0.03) for c in base], 1)
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(dif.outputs[0], s2r.inputs[0])
        nt.links.new(s2r.outputs["Color"], bw.inputs[0])
        nt.links.new(bw.outputs[0], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    MATS[key] = m
    TOON.append((m, name, glow))
    return m


INK = bpy.data.materials.new("ines_ink")
INK.use_nodes = True
_n = INK.node_tree
_n.nodes.clear()
_e = _n.nodes.new("ShaderNodeEmission")
_e.inputs["Color"].default_value = (*rgb(HEX["black"]), 1)
_o = _n.nodes.new("ShaderNodeOutputMaterial")
_n.links.new(_e.outputs[0], _o.inputs["Surface"])
INK.use_backface_culling = True

# ------------------------------------------------------------ primitives ----
ROOT = bpy.data.objects.new("Ines", None)
bpy.context.collection.objects.link(ROOT)
PARTS = []


def finish(o, m, sub=2, outline=0.006, smooth=True):
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if sub:
        sm = o.modifiers.new("sub", "SUBSURF")
        sm.levels = sub
        sm.render_levels = sub
    if outline:
        o.data.materials.append(INK)
        so = o.modifiers.new("ink", "SOLIDIFY")
        so.thickness = outline
        so.offset = 1.0
        so.use_flip_normals = True
        so.material_offset = 1
        so.use_rim = False
    o.parent = ROOT
    PARTS.append(o)
    return o


def sphere(name, loc, scale, m, rot=(0, 0, 0), sub=1, outline=0.006, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return finish(o, m, sub, outline)


def box(name, loc, scale, m, rot=(0, 0, 0), sub=2, outline=0.006, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    if bevel:
        bv = o.modifiers.new("bev", "BEVEL")
        bv.width = bevel
        bv.segments = 3
    return finish(o, m, sub, outline)


def cyl(name, loc, r, depth, m, rot=(0, 0, 0), sub=1, outline=0.006, verts=24, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return finish(o, m, sub, outline)


def torus(name, loc, R, r, m, rot=(0, 0, 0), scale=(1, 1, 1), outline=0.004, sub=1):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot,
                                     major_segments=40, minor_segments=12)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    return finish(o, m, sub, outline)


def limb(name, a, b, r1, r2, m, outline=0.006, sub=1):
    """Tapered tube from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(name, (a + b) / 2, r1, d.length, m, sub=sub, outline=outline, r2=r2)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    # round caps
    sphere(name + "_capA", a, (r1, r1, r1), m, outline=outline)
    sphere(name + "_capB", b, (r2, r2, r2), m, outline=outline)
    return o


# ================================================================== BUILD ====
# ---- mag boots (chunky, rounded; mismatched painted toe caps) ----------------
for side, toe in ((-1, "cryo"), (1, "copper")):
    x = 0.12 * side
    sphere(f"boot_{side}", (x, -0.02, 0.09), (0.092, 0.16, 0.085), mat("boot"), sub=1)
    sphere(f"toe_{side}", (x, -0.125, 0.075), (0.082, 0.075, 0.068), mat(toe), sub=1)
    sphere(f"sole_{side}", (x, -0.03, 0.028), (0.1, 0.185, 0.03), mat("sole"), sub=1)
    cyl(f"cuff_{side}", (x, 0.0, 0.19), 0.1, 0.09, mat("boot"))
    torus(f"cuffrim_{side}", (x, 0.0, 0.235), 0.1, 0.014, mat("sole"), outline=0.003)
    box(f"magstrip_{side}", (x, -0.03, 0.006), (0.07, 0.15, 0.006), mat("ferro", glow=1), sub=0, outline=0)
    box(f"buckle_{side}", (x + 0.092 * side, -0.02, 0.15), (0.008, 0.03, 0.018), mat("silver"), bevel=0.004)

# ---- legs: baggy coverall trousers ------------------------------------------
for side in (-1, 1):
    x = 0.115 * side
    limb(f"leg_{side}", (x, 0.0, 0.24), (x * 0.95, 0.0, 0.76), 0.098, 0.108, mat("orange"))
    cyl(f"hivis_{side}", (x, 0.0, 0.36), 0.102, 0.035, mat("silver"), outline=0.004)
    sphere(f"knee_{side}", (x, -0.07, 0.47), (0.07, 0.035, 0.075), mat("boot"))
    # test-swatch dabs on the thigh (outer side)
    for i, c in enumerate(("cryo", "copper", "ferro", "teal")):
        sphere(f"swatch_{side}_{i}", (x + 0.085 * side, -0.045 + i * 0.03, 0.66 - (i % 2) * 0.03),
               (0.012, 0.018, 0.016), mat(c), outline=0.002, sub=0, seg=12)
# mismatched patches (different dye lots)
box("patch_a", (0.1, -0.1, 0.6), (0.05, 0.012, 0.045), mat("orange2"), rot=(0, 0.2, 0), outline=0.003, bevel=0.01)
box("patch_b", (-0.13, -0.095, 0.3), (0.04, 0.012, 0.04), mat("orange3"), rot=(0, -0.3, 0), outline=0.003, bevel=0.01)

# ---- hips, belt, tied sleeves -----------------------------------------------
sphere("hips", (0, 0, 0.82), (0.19, 0.13, 0.12), mat("orange"))
torus("belt", (0, 0, 0.87), 0.175, 0.022, mat("belt"), scale=(1, 0.74, 1), outline=0.004)
box("buckle", (0, -0.135, 0.87), (0.03, 0.01, 0.022), mat("silver"), bevel=0.006, outline=0.003)
for i, (px, c) in enumerate(((-0.14, "belt"), (0.15, "belt"), (-0.18, "strap"))):
    box(f"pouch_{i}", (px, -0.09 if i < 2 else 0.02, 0.83), (0.035, 0.03, 0.04), mat(c), bevel=0.012)
# swatch fan on a belt ring (right hip)
for i, c in enumerate(("cryo", "copper", "ferro", "orange", "teal")):
    a = -0.5 + i * 0.25
    box(f"fan_{i}", (0.2 + 0.025 * math.sin(a), -0.05, 0.78 - 0.02 * i), (0.008, 0.014, 0.045),
        mat(c), rot=(0, a, 0), outline=0.002, sub=0, bevel=0.003)
# coverall top, unzipped, sleeves tied around the waist
torus("tied_sleeves", (0, 0.01, 0.905), 0.19, 0.035, mat("orange"), scale=(1, 0.8, 1))
sphere("knot", (0.03, -0.155, 0.9), (0.05, 0.035, 0.04), mat("orange"))
limb("sleeve_hang_a", (0.02, -0.16, 0.89), (0.09, -0.17, 0.62), 0.045, 0.04, mat("orange"))
limb("sleeve_hang_b", (0.05, -0.16, 0.89), (-0.04, -0.18, 0.64), 0.043, 0.038, mat("orange"))
cyl("cuff_hang_a", (0.09, -0.17, 0.6), 0.042, 0.03, mat("orange2"), rot=(0, 0.26, 0), outline=0.003)
cyl("cuff_hang_b", (-0.04, -0.18, 0.62), 0.04, 0.03, mat("orange2"), rot=(0, -0.3, 0), outline=0.003)
for i, c in enumerate(("cryo", "copper")):
    sphere(f"sleeve_swatch_{i}", (0.07 - 0.1 * i, -0.21, 0.72 + 0.02 * i), (0.016, 0.009, 0.016),
           mat(c), outline=0.002, sub=0, seg=12)

# ---- torso: fitted thermal undershirt with the three-stripe coating band -----
sphere("torso", (0, 0, 1.08), (0.17, 0.12, 0.22), mat("teal"))
sphere("chest", (0, -0.01, 1.16), (0.175, 0.125, 0.12), mat("teal"))
for i, c in enumerate(("cryo", "copper", "ferro")):
    torus(f"stripe_{i}", (0, 0, 1.12 - i * 0.028), 0.172, 0.009, mat(c), scale=(1, 0.72, 1), outline=0.0, sub=0)

# ---- backpack: frame + three coating canisters ------------------------------
box("pack_frame", (0, 0.135, 1.06), (0.13, 0.04, 0.16), mat("frame"), bevel=0.02)
for i, (px, c) in enumerate(((-0.08, "cryo"), (0.0, "copper"), (0.08, "ferro"))):
    cyl(f"can_{i}", (px, 0.185, 1.07), 0.036, 0.26, mat(c))
    cyl(f"cancap_{i}", (px, 0.185, 1.215), 0.028, 0.03, mat("silver"), outline=0.003)
    cyl(f"canband_{i}", (px, 0.185, 1.02), 0.038, 0.02, mat("white"), outline=0.002)
for side in (-1, 1):
    limb(f"strap_{side}", (0.1 * side, -0.07, 1.25), (0.1 * side, -0.1, 0.98), 0.018, 0.018, mat("strap"), outline=0.003)

# ---- neck, neckerchief ------------------------------------------------------
cyl("neck", (0, 0, 1.335), 0.07, 0.12, mat("skin"))
torus("scarf", (0, -0.005, 1.305), 0.08, 0.027, mat("scarf"), scale=(1, 0.95, 0.75))
bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.085, radius2=0.0, depth=0.02,
                                location=(0, -0.075, 1.255), rotation=(math.radians(-80), 0, math.radians(90)))
_tri = bpy.context.object
_tri.name = "scarf_drape"
_tri.scale = (1.0, 1.25, 1.0)
finish(_tri, mat("scarf"), sub=1, outline=0.004)
sphere("scarf_knot", (0.055, -0.06, 1.305), (0.024, 0.02, 0.02), mat("scarf"))
for i in range(3):  # little ferro-violet dots on the scarf
    sphere(f"scarf_dot_{i}", (-0.03 + i * 0.03, -0.088, 1.27 - (i % 2) * 0.02), (0.008, 0.004, 0.008),
           mat("ferro"), outline=0, sub=0, seg=10)

# ---- arms (relaxed A-pose), gloves, applicator -------------------------------
for side in (-1, 1):
    sh = Vector((0.2 * side, 0.0, 1.24))
    el = Vector((0.27 * side, 0.01, 1.0))
    wr = Vector((0.31 * side, -0.04, 0.8))
    sphere(f"shoulder_{side}", sh, (0.07, 0.07, 0.065), mat("teal"))
    limb(f"upper_{side}", sh, sh.lerp(el, 0.55), 0.058, 0.055, mat("teal"))  # sleeve
    limb(f"arm_{side}", sh.lerp(el, 0.5), el, 0.047, 0.045, mat("skin"))
    limb(f"fore_{side}", el, wr, 0.045, 0.04, mat("skin"))
    # paint smudges on the forearms
    for i, c in enumerate(("copper", "cryo") if side > 0 else ("ferro",)):
        sphere(f"smudge_{side}_{i}", el.lerp(wr, 0.35 + 0.25 * i) + Vector((0.035 * side, -0.02, 0)),
               (0.012, 0.012, 0.02), mat(c), outline=0, sub=0, seg=12)
    # chunky work glove
    cyl(f"glovecuff_{side}", wr + Vector((0, 0, 0.01)), 0.05, 0.05, mat("glove"), rot=(0, 0.18 * side, 0))
    sphere(f"glove_{side}", wr + Vector((0.01 * side, -0.01, -0.07)), (0.05, 0.04, 0.065), mat("glove"))
    sphere(f"thumb_{side}", wr + Vector((-0.02 * side, -0.045, -0.05)), (0.018, 0.018, 0.03), mat("glove"))
# stained fingertips on the right glove
for i, c in enumerate(("cryo", "copper", "ferro")):
    sphere(f"tip_{i}", (0.33 + 0.015 * i, -0.075, 0.71), (0.012, 0.01, 0.012), mat(c), outline=0, sub=0, seg=10)
# the applicator ("stylus"): pistol grip + nozzle + glowing copper tip, right hand
box("app_grip", (0.33, -0.07, 0.72), (0.018, 0.022, 0.05), mat("frame"), rot=(0.25, 0, 0), bevel=0.008)
box("app_body", (0.33, -0.13, 0.765), (0.022, 0.07, 0.026), mat("white"), bevel=0.012)
cyl("app_nozzle", (0.33, -0.22, 0.765), 0.012, 0.07, mat("frame"), rot=(math.pi / 2, 0, 0), outline=0.003)
sphere("app_tip", (0.33, -0.258, 0.765), (0.014, 0.014, 0.014), mat("copper", glow=2), outline=0, seg=16)
box("app_window", (0.33, -0.15, 0.79), (0.014, 0.03, 0.006), mat("copper", glow=1), outline=0, sub=0)

# ---- head --------------------------------------------------------------------
HZ = 1.515
sphere("head", (0, 0, HZ), (0.168, 0.16, 0.18), mat("skin"), seg=32)
sphere("jaw", (0, -0.02, HZ - 0.08), (0.125, 0.12, 0.085), mat("skin"))
for side in (-1, 1):
    sphere(f"ear_{side}", (0.165 * side, 0.0, HZ - 0.01), (0.022, 0.03, 0.04), mat("skin_dark"))
    torus(f"earring_{side}", (0.172 * side, -0.005, HZ - 0.06), 0.018, 0.005, mat("ferro"),
          rot=(0, math.pi / 2, 0), outline=0.002, sub=0)
    # eyes: big simple ovals with a highlight
    sphere(f"eye_{side}", (0.058 * side, -0.147, HZ + 0.005), (0.027, 0.012, 0.036), mat("black"), outline=0, sub=0)
    sphere(f"eyehi_{side}", (0.052 * side, -0.158, HZ + 0.02), (0.007, 0.004, 0.009), mat("white"), outline=0, sub=0)
    box(f"brow_{side}", (0.06 * side, -0.15, HZ + 0.066), (0.028, 0.006, 0.007), mat("hair"),
        rot=(0, -0.18 * side, 0), outline=0, sub=0, bevel=0.003)
    sphere(f"blush_{side}", (0.098 * side, -0.132, HZ - 0.035), (0.022, 0.008, 0.012), mat("blush"), outline=0, sub=0)
    for j in range(3):  # freckles
        sphere(f"freckle_{side}_{j}", (0.08 * side + 0.012 * j * side, -0.146, HZ - 0.012 - 0.008 * j),
               (0.0035, 0.002, 0.0035), mat("skin_dark"), outline=0, sub=0, seg=8)
sphere("nose", (0, -0.166, HZ - 0.022), (0.016, 0.014, 0.014), mat("skin_dark"), outline=0.002)
box("mouth", (0, -0.155, HZ - 0.08), (0.026, 0.005, 0.005), mat("skin_dark"), rot=(0, 0, 0), outline=0, sub=0, bevel=0.002)
sphere("smirk", (0.03, -0.154, HZ - 0.076), (0.006, 0.005, 0.006), mat("skin_dark"), outline=0, sub=0, seg=10)

# hair: shaved sides, curly top with a copper (trace-ink) streak
sphere("hair_shave", (0, 0.012, HZ + 0.018), (0.172, 0.165, 0.17), mat("skin_dark"), outline=0.004)
import random
random.seed(7)
for i in range(64):
    a = random.uniform(0, 2 * math.pi)
    rr = random.uniform(0.0, 0.13)
    x, y = math.cos(a) * rr, math.sin(a) * rr * 0.95 + 0.012
    z = HZ + 0.14 + (0.13 - rr) * 0.5 + random.uniform(-0.01, 0.025)
    if y < -0.11:
        continue
    streak = -0.06 < x < -0.01 and y < 0.02
    s = random.uniform(0.032, 0.048)
    sphere(f"curl_{i}", (x, y, z), (s, s, s * 0.9), mat("copper" if streak else "hair"), outline=0.004, sub=1, seg=14)
# goggles pushed up as a headband
_bz = 0.075  # band height above head centre
_bf = math.sqrt(1 - (_bz / 0.18) ** 2)
torus("goggle_band", (0, 0.004, HZ + _bz), 0.168 * _bf + 0.006, 0.011, mat("strap"), rot=(0.22, 0, 0),
      scale=(1.0, 0.16 / 0.168, 1), outline=0.003)
for side in (-1, 1):
    cyl(f"goggle_{side}", (0.058 * side, -0.14, HZ + 0.1), 0.034, 0.03, mat("goggle"), rot=(1.2, 0, 0))
    cyl(f"lens_{side}", (0.058 * side, -0.155, HZ + 0.106), 0.026, 0.012, mat("lens", glow=0.2),
        rot=(1.2, 0, 0), outline=0, sub=0)

# ============================================================ SCENE / RENDER ==
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = True
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
scene.world = world
# key light from the front-left-top (drives the cel bands), soft fill
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(-25), math.radians(-35)))
bpy.context.object.data.energy = 3.2
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(70), 0, math.radians(150)))
bpy.context.object.data.energy = 0.6

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -6, 0.86)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam

views = [("front", 0), ("threequarter", -35), ("side", -90), ("back", 180)]
for name, deg in views:
    ROOT.rotation_euler = (0, 0, math.radians(deg))
    scene.render.filepath = os.path.join(OUT, f"ines_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scene.render.filepath)

# hero: perspective, slightly low angle, 3/4
ROOT.rotation_euler = (0, 0, math.radians(-28))
cam_data.type = "PERSP"
cam_data.lens = 60
cam.location = (0.9, -4.1, 1.05)
cam.rotation_euler = (math.radians(88), 0, math.radians(12))
scene.render.resolution_x = 1200
scene.render.resolution_y = 1400
scene.render.filepath = os.path.join(OUT, "ines_hero.png")
bpy.ops.render.render(write_still=True)
print("rendered", scene.render.filepath)
ROOT.rotation_euler = (0, 0, 0)

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, "ines.blend")))

# ------------------------------------------------------ GLB (plain PBR) ------
# Drop the ink shells and swap the cel node trees for Principled (glTF-exportable).
for o in PARTS:
    for mdf in list(o.modifiers):
        if mdf.type == "SOLIDIFY":
            o.modifiers.remove(mdf)
    if len(o.data.materials) > 1:
        o.data.materials.pop(index=1)
for m, name, glow in TOON:
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (*rgb(HEX[name]), 1)
    p.inputs["Roughness"].default_value = 0.75
    if glow:
        p.inputs["Emission Color"].default_value = (*rgb(HEX[name]), 1)
        p.inputs["Emission Strength"].default_value = 1.5
    nt.links.new(p.outputs[0], out.inputs["Surface"])
for o in list(scene.objects):
    o.select_set(o in PARTS or o is ROOT)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(os.path.join(OUT, "ines.glb")), export_format="GLB",
                          use_selection=True, export_apply=True, export_yup=True)
print("exported", os.path.join(OUT, "ines.glb"))
