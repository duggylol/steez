# Upstream

Copied from https://github.com/Inceptofn/Fortnite-Chest-Tracker (MIT, see LICENSE) at commit
`c21c59a` (2026-11-14): `lib/` (patched FortniteReplayDecompressor, MIT, see lib/LICENSE-*) and
`src/ChestCounter.Core`, `src/ChestCounter.Ocr`. The WPF dashboard (`src/ChestCounter.Gui`) is not
used: Steez has its own page and overlays, driven by `../host` (ChestTracker.exe).

Steez changes to the copied files are listed in STEEZ-CHANGES.md. To update, copy the same folders
from a newer commit and re-apply those changes.
