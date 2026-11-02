"""Outline the approved logo lettering and create self-contained SVG variants.

Requires fontTools and the locally installed Bahnschrift font. The font file
is not copied or distributed; the delivery assets contain only glyph outlines.
"""

from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "brand"
MASTER = OUT / "studyflow-mark.svg"
FONT = Path("C:/Windows/Fonts/bahnschrift.ttf")
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)


def outline_wordmark() -> tuple[str, float]:
    font = TTFont(FONT)
    if "fvar" in font:
        font = instantiateVariableFont(font, {"wght": 600, "wdth": 100})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = 60 / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs)
    cursor = 110.0
    # The wordmark is deliberately one color and one weight throughout.
    for letter in "StudyFlow":
        glyph = glyphs[cmap[ord(letter)]]
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, 68)))
        cursor += glyph.width * scale - 0.55
    return pen.getCommands(), cursor + 12


def write_variant(name: str, mark: str, fold: str, word: str | None = None) -> None:
    root = ET.parse(MASTER).getroot()
    root.find(f"{{{NS}}}g").set("fill", mark)
    root.findall(f"{{{NS}}}path")[-1].set("fill", fold)
    if word:
        path, width = outline_wordmark()
        root.set("width", str(round(width)))
        root.set("viewBox", f"0 0 {width:.3f} 96")
        ET.SubElement(root, f"{{{NS}}}path", {"d": path, "fill": word})
    ET.indent(root, space="  ")
    ET.ElementTree(root).write(OUT / f"{name}.svg", encoding="unicode")
    print(f"{name}.svg: vector paths only; transparent background")


if __name__ == "__main__":
    write_variant("studyflow-mark-white", "#FFFFFF", "#FFFFFF")
    write_variant("studyflow-mark-ink", "#182230", "#182230")
    write_variant("studyflow-logo", "#2563EB", "#1E40AF", "#182230")
    write_variant("studyflow-logo-dark", "#60A5FA", "#3B82F6", "#FFFFFF")
    write_variant("studyflow-logo-white", "#FFFFFF", "#FFFFFF", "#FFFFFF")
