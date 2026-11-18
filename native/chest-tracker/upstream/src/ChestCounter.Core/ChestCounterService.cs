namespace ChestCounter;

// High-level entry point the GUI and live counter share.
public static class ChestCounterService
{
    // Default Fortnite replay folder on this machine.
    public static string DefaultDemosPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FortniteGame", "Saved", "Demos");

    public static string StatsPath => StatsStore.DefaultPath;

    // Start of the current (pirate / Treasure Hunters) season. Update each season.
    public static readonly DateTime SeasonStartUtc = new(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);

    // Public site shown (subtly) on the stream overlay.
    public const string Domain = "chesttracker.app";

    // Compact stats as JSON for the stream overlay; `live` = this-match count from OCR.
    public static string OverlayJson(LifetimeStats s, int? live = null)
    {
        var all = s.Over(null);
        var recs = s.Records.OrderBy(r => r.Time).ToList();
        int best = recs.Count > 0 ? recs.Max(r => r.You) : 0;
        int? last = recs.Count > 0 ? recs[^1].You : null;
        var dto = new { live, avg = all.AvgYou, total = all.YourChests, matches = all.Matches, best, last, domain = Domain };
        return System.Text.Json.JsonSerializer.Serialize(dto);
    }

    public static LifetimeStats LoadStats() => StatsStore.Load(StatsPath);

    public static void Save(LifetimeStats stats) => StatsStore.Save(StatsPath, stats);

    public static bool DemosFolderExists(string? demos = null) =>
        Directory.Exists(demos ?? DefaultDemosPath);

    // All replay files in `demos`, newest first.
    public static List<string> FindReplays(string? demos = null)
    {
        demos ??= DefaultDemosPath;
        if (!Directory.Exists(demos)) return new();
        return Directory.GetFiles(demos, "*.replay")
            .OrderByDescending(f => new FileInfo(f).LastWriteTime).ToList();
    }

    // Scan the given replays, fold new matches into the saved lifetime stats, persist, and
    // return both the run summary and the updated lifetime stats.
    public static (RunReport run, LifetimeStats stats) Scan(
        IReadOnlyList<string> files, Action<int, int, string, string?>? onProgress = null)
    {
        var stats = LoadStats();
        var run = new ReplayScanner().Scan(files, stats, onProgress);
        StatsStore.Save(StatsPath, stats);
        return (run, stats);
    }
}
