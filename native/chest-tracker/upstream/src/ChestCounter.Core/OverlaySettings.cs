using System.Text.Json;

namespace ChestCounter;

// Streamer-editable overlay branding. Saved next to the stats; read live by the overlay.
public sealed class OverlaySettings
{
    public const string DefaultAccent = "#F3F1EC";

    public string Accent { get; set; } = DefaultAccent;       // brand/accent color (hex)
    public string Title { get; set; } = "Chest Tracker";  // header text
}

public static class OverlayConfig
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string Path => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ChestCounter", "overlay.json");

    public static OverlaySettings Load()
    {
        try
        {
            if (File.Exists(Path))
            {
                var s = JsonSerializer.Deserialize<OverlaySettings>(File.ReadAllText(Path)) ?? new();
                // The old brass defaults move to the current default; a colour you picked stays.
                if (s.Accent is "#F5C147" or "#E7B23C") s.Accent = OverlaySettings.DefaultAccent;
                if (s.Title == "Chest Counter") s.Title = "Chest Tracker";
                return s;
            }
        }
        catch { }
        return new();
    }

    public static void Save(OverlaySettings s)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        File.WriteAllText(Path, JsonSerializer.Serialize(s, Options));
    }

    // Branding as JSON for the overlay's /config.json endpoint (read fresh each request).
    public static string Json()
    {
        var s = Load();
        return JsonSerializer.Serialize(new
        {
            accent = s.Accent,
            title = string.IsNullOrWhiteSpace(s.Title) ? "Chest Tracker" : s.Title,
            domain = ChestCounterService.Domain,
        });
    }
}
