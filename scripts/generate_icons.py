"""Generate Windows icon sizes from the canonical WinCleam logo.

Run after replacing src/assets/wincleam-logo.png: python scripts/generate_icons.py
Requires Pillow.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
SOURCE = ROOT / "src" / "assets" / "wincleam-logo.png"
FAVICON = ROOT / "public" / "favicon.png"
ICONS.mkdir(parents=True, exist_ok=True)
FAVICON.parent.mkdir(parents=True, exist_ok=True)

if not SOURCE.is_file():
    raise FileNotFoundError(f"Canonical logo not found: {SOURCE}")

icon = Image.open(SOURCE).convert("RGBA")
for pixels, name in [(32, "32x32.png"), (128, "128x128.png"),
                     (256, "128x128@2x.png")]:
    icon.resize((pixels, pixels), Image.Resampling.LANCZOS).save(ICONS / name)
icon.resize((512, 512), Image.Resampling.LANCZOS).save(ICONS / "icon.png")
icon.resize((64, 64), Image.Resampling.LANCZOS).save(FAVICON)
icon.save(ICONS / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24),
                                                    (32, 32), (48, 48),
                                                    (64, 64), (128, 128),
                                                    (256, 256)])

print(f"Icons generated from {SOURCE} in {ICONS}; favicon generated at {FAVICON}")
