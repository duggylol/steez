# Steez changes to the copied upstream files

- `src/ChestCounter.Ocr/LiveChestCounter.cs`: `MatchRecorded` event (after a finished match is saved),
  `Live` (current count), `Adjust(delta)` (manual correction), `ScreenIndex` (which monitor to read).
- `src/ChestCounter.Ocr/LiveChestCounter.cs` (performance): a cheap check skips OCR on frames without
  crisp white outlined text (enough sharp near-white-to-dark edges; smooth bright sky or snow fails it);
  one reused bitmap instead of one per frame. The second, larger OCR pass only runs when the first is
  unsure (an XP line without a chest label or the other way round). The loop looks 4 times a second,
  5 while a popup is up, instead of 8. With `LowPower` (set by the game PC bridge) the capture loop
  also idles unless Fortnite is running and, when replays are recorded, a match is in progress.
  Measured: ~0.4% of one core during play, ~30% of one core for the ~2 s a popup is up.
- `src/ChestCounter.Ocr/LiveChestCounter.cs`: the chest label also accepts `CNEST` (OCR misreads the H of
  the outlined font as N); `TestImage(path)` runs the detection on an image file (Steez's `testimage`
  helper command, for testing).
- `src/ChestCounter.Ocr/ChestCounter.Ocr.csproj`: `AllowUnsafeBlocks` for that pixel check.
