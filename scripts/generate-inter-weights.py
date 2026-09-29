"""Build fixed Inter weights for FFmpeg from the bundled OFL variable font.

Development only: python -m pip install fonttools
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


root = Path(__file__).resolve().parents[1] / "apps/desktop/src-tauri/resources/visual-13d/fonts"
source = root / "Inter.ttf"
for weight in (400, 500, 600, 700, 800, 900):
    target = root / f"Inter-{weight}.ttf"
    if target.is_file() and target.stat().st_size:
        continue
    font = TTFont(source)
    instantiateVariableFont(font, {"wght": weight}, inplace=True)
    font.save(target)
