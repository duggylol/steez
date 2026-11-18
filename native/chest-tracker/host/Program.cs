// Steez chest tracker helper. Steez starts this exe and talks to it one JSON object per line.
//
// Commands (stdin):  {"cmd":"live","on":true}  {"cmd":"scan"}  {"cmd":"stats"}  {"cmd":"adjust","delta":1}
//                    {"cmd":"screen","index":1}  {"cmd":"reset"}
// Events (stdout):   ready, live, popup, log, progress, scanned, stats, error
//
// Exits when stdin closes, so it never outlives Steez.
using System.Text.Json;
using System.Text.Json.Nodes;
using ChestCounter;
using ChestCounter.Ocr;

Console.OutputEncoding = System.Text.Encoding.UTF8;
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var outLock = new object();
void Emit(string type, object? data = null)
{
    var node = data == null ? new JsonObject() : JsonSerializer.SerializeToNode(data, json)!.AsObject();
    node["type"] = type;
    lock (outLock)
    {
        Console.Out.WriteLine(node.ToJsonString());
        Console.Out.Flush();
    }
}

var counter = new LiveChestCounter();
counter.LiveChanged += n => Emit("live", new { count = n });
counter.PopupRead += t => Emit("popup", new { text = t });
counter.Log += t => Emit("log", new { text = t });
counter.MatchRecorded += () => Emit("stats", Snapshot.Build(ChestCounterService.LoadStats(), counter.Live));

var screens = System.Windows.Forms.Screen.AllScreens
    .Select((s, i) => new { index = i, name = s.DeviceName.Replace(@"\\.\", ""), primary = s.Primary, width = s.Bounds.Width, height = s.Bounds.Height })
    .ToList();
Emit("ready", new
{
    ocr = counter.Available,
    demos = ChestCounterService.DefaultDemosPath,
    demosExists = ChestCounterService.DemosFolderExists(),
    replays = ChestCounterService.FindReplays().Count,
    statsPath = ChestCounterService.StatsPath,
    screens,
});
Emit("stats", Snapshot.Build(ChestCounterService.LoadStats(), null));

int scanning = 0;
void Scan()
{
    if (Interlocked.Exchange(ref scanning, 1) == 1) { Emit("error", new { message = "A scan is already running." }); return; }
    Task.Run(() =>
    {
        try
        {
            var files = ChestCounterService.FindReplays();
            var last = DateTime.MinValue;
            var (run, stats) = ChestCounterService.Scan(files, (i, n, file, err) =>
            {
                // At most ~6 progress lines a second, plus every failure and the last one.
                if (err != null || i == n || (DateTime.UtcNow - last).TotalMilliseconds > 160)
                {
                    last = DateTime.UtcNow;
                    Emit("progress", new { done = i, total = n, file, error = err });
                }
            });
            Emit("scanned", new { run.Total, run.Parsed, run.Failed, run.NewMatches, run.AlreadyCounted, run.SkippedMode });
            Emit("stats", Snapshot.Build(stats, counter.Live));
        }
        catch (Exception e) { Emit("error", new { message = "Scan failed: " + e.Message }); }
        finally { Interlocked.Exchange(ref scanning, 0); }
    });
}

string? line;
while ((line = Console.In.ReadLine()) != null)
{
    try
    {
        var cmd = JsonNode.Parse(line)?.AsObject();
        switch ((string?)cmd?["cmd"])
        {
            case "live":
                if ((bool?)cmd!["on"] == true)
                {
                    if (!counter.Available) Emit("error", new { message = "No OCR language is installed in Windows (Settings > Time & Language > Language)." });
                    else counter.Start();
                }
                else counter.Stop();
                break;
            case "scan": Scan(); break;
            case "stats": Emit("stats", Snapshot.Build(ChestCounterService.LoadStats(), counter.Live)); break;
            case "adjust": counter.Adjust((int?)cmd!["delta"] ?? 0); break;
            case "screen": counter.ScreenIndex = (int?)cmd!["index"] ?? -1; break;
            case "reset":
                ChestCounterService.Save(new LifetimeStats { Version = LifetimeStats.CurrentVersion });
                Emit("stats", Snapshot.Build(ChestCounterService.LoadStats(), counter.Live));
                break;
        }
    }
    catch (Exception e) { Emit("error", new { message = e.Message }); }
}
counter.Stop();

static class Snapshot
{
    // Everything Steez shows, worked out here so the numbers match the original Chest Tracker.
    public static object Build(LifetimeStats s, int? live)
    {
        var now = DateTime.UtcNow;
        // Stored times are UTC but come back from JSON without a kind; mark them so they're sent as UTC.
        static DateTime Utc(DateTime t) => DateTime.SpecifyKind(t, DateTimeKind.Utc);
        object Period(DateTime? since)
        {
            var p = s.Over(since);
            var recs = s.RecordsSince(since);
            return new { matches = p.Matches, chests = p.YourChests, avg = Math.Round(p.AvgYou, 2), best = recs.Count > 0 ? recs.Max(r => r.You) : 0 };
        }
        var ordered = s.Records.OrderByDescending(r => r.Time).ToList();
        object Prize(PrizeFind p) => new
        {
            id = p.PrizeId,
            name = Treasures.Name(p.PrizeId),
            by = Finder(p),
            mine = p.Mine,
            team = p.Team,
            gizmo = Treasures.IsGizmo(p.PrizeId),
            token = Treasures.IsToken(p.PrizeId),
        };

        var hour = TreasureCatalog.CurrentOrNext(now);
        bool hourLive = hour != null && TreasureCatalog.IsLive(hour, now);
        var week = TreasureCatalog.WeekAt(now);
        long seasonChests = s.Over(ChestCounterService.SeasonStartUtc).YourChests;
        var odds = TreasureCatalog.Odds.Select(o =>
        {
            double boost = hourLive && hour!.Boosts.TryGetValue(o.Kind, out var b) ? b : 1;
            string item = week != null && week.Prizes.TryGetValue(o.Kind, out var name) ? name
                : o.Kind == TreasureCatalog.Token ? "Unlocks the Pirate Shop"
                : o.Kind == TreasureCatalog.Gizmo ? "Relic Finder, Lucky Locator and friends"
                : "This week's item";
            return new { kind = o.Kind, label = o.Label, item, oneIn = (long)Math.Round(o.OneIn / boost), boosted = boost > 1, chance = TreasureCatalog.ChanceOfAtLeastOne(o.OneIn, seasonChests) };
        }).ToList();

        return new
        {
            live,
            last = ordered.Count > 0 ? ordered[0].You : (int?)null,
            periods = new
            {
                day = Period(now.AddDays(-1)),
                week = Period(now.AddDays(-7)),
                season = Period(ChestCounterService.SeasonStartUtc),
                all = Period(null),
            },
            // every match (time + count) so Steez can total "chests since a date" itself
            matches = s.Records.Select(r => new { t = Utc(r.Time), n = r.You }),
            recent = ordered.Take(40).Select(r => new
            {
                id = r.MatchId,
                time = Utc(r.Time),
                you = r.You,
                mates = r.Mates.Select(m => new { name = m.Name, chests = m.Chests }),
                prizes = r.Prizes.Select(Prize),
            }),
            mates = new
            {
                season = s.TopMates(ChestCounterService.SeasonStartUtc, 6).Select(t => new { name = t.Name, matches = t.Matches, chests = t.Chests }),
                all = s.TopMates(null, 6).Select(t => new { name = t.Name, matches = t.Matches, chests = t.Chests }),
            },
            prizes = ordered.SelectMany(r => r.Prizes.Select(p => new { time = Utc(r.Time), prize = Prize(p) })).Take(30),
            treasure = new
            {
                seasonChests,
                seasonStart = ChestCounterService.SeasonStartUtc,
                week = week == null ? null : new { number = week.Number, title = week.Title, start = week.StartUtc, end = week.EndUtc },
                hour = hour == null ? null : new { start = hour.StartUtc, end = hour.EndUtc, live = hourLive, boosts = hour.Boosts.Select(b => new { kind = b.Key, label = TreasureCatalog.Odds.First(o => o.Kind == b.Key).Label, times = b.Value }) },
                odds,
            },
        };
    }

    private static string Finder(PrizeFind p)
    {
        // A gizmo goes to the whole squad; By is whose chest it came out of.
        if (Treasures.IsGizmo(p.PrizeId))
            return p.By switch { "" => "your squad", "you" => "your squad, from your chest", _ => $"your squad, from {p.By}'s chest" };
        return p.Mine ? "you"
            : p.Team ? (string.IsNullOrEmpty(p.By) ? "your squad" : $"{p.By} (squad)")
            : string.IsNullOrEmpty(p.By) ? "a player nearby" : p.By;
    }
}
