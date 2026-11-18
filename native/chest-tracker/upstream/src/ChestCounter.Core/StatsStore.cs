using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChestCounter;

// One stored match: its id, start time, and how many chests you opened.
public sealed class MatchRecord
{
    public string MatchId { get; set; } = "";
    public DateTime Time { get; set; }   // match start (UTC); DateTime.MinValue if unknown
    public int You { get; set; }

    // Squadmates' chests as seen from your replay. A minimum: a chest a teammate opens far away
    // from you never reaches your replay.
    public List<MateCount> Mates { get; set; } = new();

    // Treasure-hunt prizes pulled in this match by anyone in view.
    public List<PrizeFind> Prizes { get; set; } = new();
}

// A teammate's totals across the matches you played together.
public readonly record struct MateTotal(string Name, int Matches, long Chests);

// A time-window aggregate.
public readonly record struct Period(int Matches, long YourChests, double AvgYou);

// Per-match history, persisted to disk and only ever appended to.
public sealed class LifetimeStats
{
    public const int CurrentVersion = 6;   // 6 = patched parser; late opener names; chests broken with nobody named; squad-wide gizmos

    public int Version { get; set; }
    public List<MatchRecord> Records { get; set; } = new();

    // Keys (filename|size) of replays already parsed, so repeat scans skip them.
    public HashSet<string> ScannedFiles { get; set; } = new();

    [JsonIgnore] private HashSet<string>? _ids;

    // Whole-history convenience accessors.
    [JsonIgnore] public int Matches => Records.Count;
    [JsonIgnore] public long YourChests => Records.Sum(r => (long)r.You);
    [JsonIgnore] public double AvgYou => Records.Count > 0 ? (double)YourChests / Records.Count : 0;

    // Add a match, or refresh one that is already recorded (a rescan after an upgrade).
    // Returns false if it was already recorded.
    public bool AddMatch(MatchChestCounts m)
    {
        if (string.IsNullOrEmpty(m.MatchId)) return false;
        _ids ??= new HashSet<string>(Records.Select(r => r.MatchId));
        if (!_ids.Add(m.MatchId))
        {
            var existing = Records.First(r => r.MatchId == m.MatchId);
            existing.You = m.You;
            existing.Mates = m.Mates;
            existing.Prizes = m.Prizes;
            return false;
        }
        Records.Add(new MatchRecord { MatchId = m.MatchId, Time = m.Time, You = m.You, Mates = m.Mates, Prizes = m.Prizes });
        return true;
    }

    // Who you play with most, by matches together.
    public List<MateTotal> TopMates(DateTime? since, int take) =>
        Records.Where(r => since is not { } s || r.Time >= s)
            .SelectMany(r => r.Mates)
            .GroupBy(m => m.Name)
            .Select(g => new MateTotal(g.Key, g.Count(), g.Sum(m => (long)m.Chests)))
            .OrderByDescending(t => t.Matches).ThenByDescending(t => t.Chests)
            .Take(take).ToList();

    // Matches on/after `since` (null = all time), oldest-first by time.
    public List<MatchRecord> RecordsSince(DateTime? since) =>
        Records.Where(r => since is not { } s || r.Time >= s).OrderBy(r => r.Time).ToList();

    // Aggregate over matches on/after `since` (null = all time).
    public Period Over(DateTime? since)
    {
        int n = 0; long y = 0;
        foreach (var r in Records)
        {
            if (since is { } s && r.Time < s) continue;
            n++; y += r.You;
        }
        return new Period(n, y, n > 0 ? (double)y / n : 0);
    }
}

public static class StatsStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ChestCounter", "stats.json");

    public static LifetimeStats Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var stats = JsonSerializer.Deserialize<LifetimeStats>(File.ReadAllText(path)) ?? new();
                if (stats.Version < LifetimeStats.CurrentVersion)
                {
                    // Older data has no squad or treasure info: let the next scan re-read whatever
                    // replays are still on disk. Matches whose replay is gone keep their count.
                    stats.ScannedFiles.Clear();
                    stats.Version = LifetimeStats.CurrentVersion;
                }
                return stats;
            }
        }
        catch { /* corrupt/old file -> start fresh rather than crash */ }
        return new() { Version = LifetimeStats.CurrentVersion };
    }

    public static void Save(string path, LifetimeStats stats)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(stats, Options));
    }
}
