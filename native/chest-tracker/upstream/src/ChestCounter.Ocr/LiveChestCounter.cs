using System.Drawing;
using System.Drawing.Imaging;
using ChestCounter;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace ChestCounter.Ocr;

// Real-time chest counter: screen-captures the center of the screen, OCRs the "+XP CHEST" popup,
// and reports how many chests you've searched this match. Anticheat-safe (external screen read only).
// Folds each finished match into the lifetime stats on disk and resets the live count.
public sealed partial class LiveChestCounter
{
    private readonly OcrEngine? _engine = OcrEngine.TryCreateFromUserProfileLanguages();
    private CancellationTokenSource? _cts;

    // False if Windows has no OCR language installed.
    public bool Available => _engine != null;

    // Raised when this match's searched-chest count changes (null = between matches).
    public event Action<int?>? LiveChanged;
    // Raised with human-readable log lines (match ended, chest detected, ...).
    public event Action<string>? Log;
    // Raised with the text of every XP popup the OCR reads, chest or not. Lets the UI show that
    // the screen is actually being read.
    public event Action<string>? PopupRead;
    // Steez: raised after a finished match's replay was read and saved to the lifetime stats.
    public event Action? MatchRecorded;

    // Steez: which monitor Fortnite is on (index into Screen.AllScreens; out of range = primary).
    public int ScreenIndex { get; set; } = -1;

    // Steez: the live count right now (null = between matches).
    public int? Live => _liveRaw < 0 ? null : _liveRaw;

    // Steez: correct the live count by hand (a missed or doubled chest). Starts a count if none.
    public void Adjust(int delta)
    {
        int cur = _liveRaw < 0 ? 0 : _liveRaw;
        _liveRaw = Math.Max(0, cur + delta);
        LiveChanged?.Invoke(_liveRaw);
    }

    public void Start()
    {
        if (_engine == null || _cts != null) return;
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _ = Task.Run(() => MatchWatchLoop(token));
        _ = Task.Run(() => CaptureLoop(token));
    }

    public void Stop()
    {
        _cts?.Cancel();
        _cts = null;
        LiveChanged?.Invoke(null);
    }

    private volatile int _liveRaw = -1; // -1 = null (between matches)

    // Watches the Demos folder. Fortnite creates the replay file when a match starts but only makes
    // it readable when the match ends, so a file that fails to parse is tried again on the next pass.
    private async Task MatchWatchLoop(CancellationToken token)
    {
        var done = new HashSet<string>(ChestCounterService.FindReplays());
        var started = new HashSet<string>();
        while (!token.IsCancellationRequested)
        {
            foreach (var f in ChestCounterService.FindReplays())
            {
                if (done.Contains(f)) continue;
                if (started.Add(f))
                {
                    // A new match: start its live count from zero.
                    _liveRaw = 0;
                    LiveChanged?.Invoke(0);
                }

                var stats = ChestCounterService.LoadStats();
                var run = new ReplayScanner().Scan(new[] { f }, stats);
                if (run.Parsed == 0 && run.AlreadyCounted == 0) continue;   // still being written

                done.Add(f);
                ChestCounterService.Save(stats);
                _liveRaw = -1;
                LiveChanged?.Invoke(null);
                MatchRecorded?.Invoke();
                Log?.Invoke($"[{DateTime.Now:HH:mm:ss}] match ended, replay read ({stats.AvgYou:F1} avg over {stats.Matches}); live count reset.");
            }
            try { await Task.Delay(4000, token); } catch { }
        }
    }

    // Fortnite shows XP popups at one spot, right of the crosshair: "+600 XP" with a small label
    // under it (CHEST, KNOCKED, ASSIST...). Capturing just that area, enlarged, is what makes the
    // small label readable; reading the whole screen misses it most of the time.
    private static Rectangle PopupArea(Rectangle screen) => new(
        screen.X + (int)(screen.Width * 0.58), screen.Y + (int)(screen.Height * 0.24),
        (int)(screen.Width * 0.28), (int)(screen.Height * 0.24));

    private async Task CaptureLoop(CancellationToken token)
    {
        Rectangle ScreenBounds()
        {
            var all = System.Windows.Forms.Screen.AllScreens;
            return ScreenIndex >= 0 && ScreenIndex < all.Length ? all[ScreenIndex].Bounds : System.Windows.Forms.Screen.PrimaryScreen!.Bounds;
        }
        int lastIndex = ScreenIndex;
        var area = PopupArea(ScreenBounds());

        int credited = 0;      // chests already counted from the popup currently on screen
        int emptyFrames = 0;
        while (!token.IsCancellationRequested)
        {
            if (ScreenIndex != lastIndex) { lastIndex = ScreenIndex; area = PopupArea(ScreenBounds()); }
            int n = 0;
            try
            {
                using var shot = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(shot)) g.CopyFromScreen(area.X, area.Y, 0, 0, area.Size);
                n = await ChestsInPopup(shot);
            }
            catch { }

            if (n > credited)
            {
                int cur = _liveRaw < 0 ? 0 : _liveRaw;
                _liveRaw = cur + (n - credited);
                credited = n;
                LiveChanged?.Invoke(_liveRaw);
                Log?.Invoke($"[{DateTime.Now:HH:mm:ss}] CHEST (this match: {_liveRaw})");
            }

            // One unreadable frame in the middle of a popup must not make the same chest count twice,
            // so the popup only counts as gone after a few empty frames in a row.
            emptyFrames = n == 0 ? emptyFrames + 1 : 0;
            if (emptyFrames >= 4) credited = 0;

            try { await Task.Delay(120, token); } catch { }
        }
    }

    // A label line that is just "CHEST", optionally with the "X2" Fortnite appends when popups
    // stack. OCR sometimes reads the S as a 5, the X as a K, or glues the two together.
    [System.Text.RegularExpressions.GeneratedRegex(@"^\W*CHE[S5]T\W*(?:[XxKk\u00d7]\s*(\d{1,2}))?\W*$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex ChestLabel();

    private string _lastPopup = "";

    // Chests named by the XP popup in this capture of the popup area. The text is white with a
    // coloured outline, so everything that is not near-white is dropped before reading. Two
    // passes with different settings: each one misses frames the other gets.
    private async Task<int> ChestsInPopup(Bitmap area)
    {
        var a = await ReadWhiteText(area, scale: 2, minBrightness: 190);
        var b = await ReadWhiteText(area, scale: 3, minBrightness: 205);

        var longest = a.Count >= b.Count ? a : b;
        // Only report real XP popups; the area also catches kill-feed names and the like.
        if (longest.Any(l => l.Contains("XP", StringComparison.OrdinalIgnoreCase)))
        {
            string popup = string.Join(" / ", longest);
            if (popup != _lastPopup)
            {
                _lastPopup = popup;
                PopupRead?.Invoke(popup);
            }
        }
        return Math.Max(CountChests(a), CountChests(b));
    }

    private static int CountChests(List<string> lines)
    {
        int chests = 0;
        foreach (var line in lines)
        {
            var m = ChestLabel().Match(line);
            if (!m.Success) continue;
            chests += m.Groups[1].Success && int.TryParse(m.Groups[1].Value, out var times) ? Math.Max(1, times) : 1;
        }
        return chests;
    }

    private async Task<List<string>> ReadWhiteText(Bitmap area, int scale, int minBrightness)
    {
        using var big = new Bitmap(area.Width * scale, area.Height * scale, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(big))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.DrawImage(area, new Rectangle(0, 0, big.Width, big.Height), new Rectangle(0, 0, area.Width, area.Height), GraphicsUnit.Pixel);
        }

        // Near-white pixels become black text on a white page.
        var data = big.LockBits(new Rectangle(0, 0, big.Width, big.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        var pixels = new byte[data.Stride * data.Height];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        for (int i = 0; i < pixels.Length; i += 4)
        {
            bool white = pixels[i] >= minBrightness && pixels[i + 1] >= minBrightness && pixels[i + 2] >= minBrightness;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = (byte)(white ? 0 : 255);
            pixels[i + 3] = 255;
        }
        System.Runtime.InteropServices.Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
        big.UnlockBits(data);

        using var ms = new MemoryStream();
        big.Save(ms, ImageFormat.Bmp);
        ms.Position = 0;
        var decoder = await BitmapDecoder.CreateAsync(ms.AsRandomAccessStream());
        using var bitmap = await decoder.GetSoftwareBitmapAsync();
        var result = await _engine!.RecognizeAsync(bitmap);
        return result.Lines.Select(l => l.Text.Trim()).Where(t => t.Length > 0).ToList();
    }
}
