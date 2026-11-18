namespace ChestCounter;

public sealed record TreasureOdds(string Kind, string Label, int OneIn);

public sealed record TreasureWeek(int Number, DateTime StartUtc, DateTime EndUtc, string Title, IReadOnlyDictionary<string, string> Prizes);

public sealed record TreasureHour(DateTime StartUtc, DateTime EndUtc, IReadOnlyDictionary<string, double> Boosts);

// Treasure-hunt odds, weekly prizes and Treasure Hours for the Chapter 7 pirate season. The odds
// are the per-chest rates Epic published; Treasure Hours follow the pattern Epic has run so far
// (Saturday 19:00 UTC and Sunday 02:00 UTC, two hours each) and may change — Epic announces them.
public static class TreasureCatalog
{
    public const string Outfit = "outfit", Token = "token", Car = "car", Pickaxe = "pickaxe",
        Jam = "jam", Loading = "loading", Gizmo = "gizmo";

    public static readonly IReadOnlyList<TreasureOdds> Odds =
    [
        new(Outfit, "Gold outfit", 1_562_500),
        new(Token, "Pirate Shop token", 137_500),
        new(Car, "Vehicle decal", 7_813),
        new(Pickaxe, "Pickaxe / back bling", 568),
        new(Jam, "Jam track", 391),
        new(Loading, "Loading screen", 272),
        new(Gizmo, "Gizmo", 127),
    ];

    private static DateTime Utc(int month, int day, int hour) => new(2026, month, day, hour, 0, 0, DateTimeKind.Utc);

    public static readonly IReadOnlyList<TreasureWeek> Weeks =
    [
        new(1, Utc(11, 1, 14), Utc(11, 8, 14), "A$AP Arrives", new Dictionary<string, string>
        {
            [Outfit] = "Solid Gold A$AP Rocky", [Pickaxe] = "Solid Gold A$AP Rocky's Gauntlets",
            [Car] = "Gold Mercedes-AMG G 63 Decal", [Jam] = "No Trespassing", [Loading] = "Plunder in Paradise",
        }),
        new(2, Utc(11, 8, 14), Utc(11, 15, 14), "Lil Uzi Arrives", new Dictionary<string, string>
        {
            [Outfit] = "Solid Gold Lil Uzi Vert", [Pickaxe] = "Diamond and Gold",
            [Car] = "Gold Cadillac CT5-V Decal", [Jam] = "London", [Loading] = "So Kawaii",
        }),
        new(3, Utc(11, 15, 14), Utc(11, 22, 14), "Miku & Teto Arrive", new Dictionary<string, string>()),
        new(4, Utc(11, 22, 14), Utc(11, 29, 14), "Oscar Arrives", new Dictionary<string, string>()),
        new(5, Utc(11, 29, 14), Utc(12, 5, 14), "The Final Hunt", new Dictionary<string, string>()),
    ];

    private static readonly IReadOnlyDictionary<string, double> UsualBoosts =
        new Dictionary<string, double> { [Outfit] = 7.5, [Token] = 1.5, [Car] = 10 };

    public static DateTime SeasonEndUtc => Weeks[^1].EndUtc;

    public static TreasureWeek? WeekAt(DateTime utc) => Weeks.FirstOrDefault(w => utc >= w.StartUtc && utc < w.EndUtc);

    // The Treasure Hour running at `utc`, or the next one. Null once the season is over.
    public static TreasureHour? CurrentOrNext(DateTime utc)
    {
        for (var day = utc.Date.AddDays(-1); day < SeasonEndUtc; day = day.AddDays(1))
        {
            int hour = day.DayOfWeek switch { DayOfWeek.Saturday => 19, DayOfWeek.Sunday => 2, _ => -1 };
            if (hour < 0) continue;
            var start = DateTime.SpecifyKind(day.AddHours(hour), DateTimeKind.Utc);
            var end = start.AddHours(2);
            if (end > utc && start < SeasonEndUtc) return new TreasureHour(start, end, UsualBoosts);
        }
        return null;
    }

    public static bool IsLive(TreasureHour hour, DateTime utc) => utc >= hour.StartUtc && utc < hour.EndUtc;

    // Chance of at least one pull in `chests` chests at the base rate.
    public static double ChanceOfAtLeastOne(int oneIn, long chests) =>
        chests <= 0 ? 0 : 1 - Math.Pow(1 - 1.0 / oneIn, chests);
}
