namespace ChestCounter;

public sealed class RunReport
{
    public int Total;
    public int Parsed;
    public int Failed;
    public int NewMatches;
    public int AlreadyCounted;
    public int SkippedMode;   // parsed fine but not a counted playlist (ranked / reload / creative / …)
}

public sealed class ReplayScanner
{
    // Only public Battle Royale counts: normal Build (Playlist_Default*) and Zero Build
    // (Playlist_NoBuildBR_*). Everything else — Ranked, Reload, OG, Creative, LEGO, Festival,
    // LTMs — is deliberately left out. Exact names (not prefixes) so an oddly-named ranked or
    // reload playlist can't slip through.
    private static readonly HashSet<string> CountedPlaylists = new(StringComparer.OrdinalIgnoreCase)
    {
        "Playlist_DefaultSolo", "Playlist_DefaultDuo", "Playlist_DefaultTrio", "Playlist_DefaultSquad",
        "Playlist_NoBuildBR_Solo", "Playlist_NoBuildBR_Duo", "Playlist_NoBuildBR_Trio", "Playlist_NoBuildBR_Squad",
    };

    public static bool IsCountedPlaylist(string? playlist) =>
        playlist != null && CountedPlaylists.Contains(playlist);

    // Parse each replay, attribute its chests, and fold NEW matches into the lifetime stats.
    public RunReport Scan(IReadOnlyList<string> files, LifetimeStats stats,
        Action<int, int, string, string?>? onProgress = null)
    {
        var run = new RunReport { Total = files.Count };

        for (int i = 0; i < files.Count; i++)
        {
            string file = files[i];

            // Skip replays we've already parsed (keyed by name+size) — the big speedup on repeat scans.
            string key;
            try { key = Path.GetFileName(file) + "|" + new FileInfo(file).Length; }
            catch { key = Path.GetFileName(file); }
            if (stats.ScannedFiles.Contains(key))
            {
                run.AlreadyCounted++;
                onProgress?.Invoke(i + 1, files.Count, Path.GetFileName(file), null);
                continue;
            }

            string? error = null;
            // The parser's hooks are static, so a manual scan and the live watcher take turns.
            Monitor.Enter(ChestScanReader.ParseLock);
            try
            {
                var reader = new ChestScanReader();
                var replay = reader.ReadReplay(file);
                // The parser can read a replay that is still being written; those are not finished
                // matches, so leave the file to be read again once Fortnite has closed it.
                if (reader.IsPartialReplay || replay.Info?.IsLive == true)
                    throw new InvalidDataException("This match is still being recorded.");
                run.Parsed++;
                stats.ScannedFiles.Add(key);   // parsed OK -> never parse this file again

                if (!IsCountedPlaylist(replay.GameData?.CurrentPlaylist))
                {
                    run.SkippedMode++;   // e.g. ranked / reload / creative — not counted
                    onProgress?.Invoke(i + 1, files.Count, Path.GetFileName(file), null);
                    continue;
                }

                var counts = reader.Classify(replay);
                if (counts.Time == DateTime.MinValue) counts.Time = File.GetLastWriteTimeUtc(file);
                if (stats.AddMatch(counts)) run.NewMatches++;
                else run.AlreadyCounted++;
            }
            catch (Exception ex)
            {
                run.Failed++;
                error = ex.Message;
            }
            finally { Monitor.Exit(ChestScanReader.ParseLock); }

            onProgress?.Invoke(i + 1, files.Count, Path.GetFileName(file), error);
        }

        return run;
    }
}
