using System.Text.RegularExpressions;
using FortniteReplayReader;
using FortniteReplayReader.Models;
using FortniteReplayReader.Models.NetFieldExports;
using FortniteReplayReader.Models.NetFieldExports.Items;
using FortniteReplayReader.Models.NetFieldExports.Vehicles;
using Unreal.Core;
using Unreal.Core.Contracts;
using Unreal.Core.Models;
using Unreal.Core.Models.Enums;

namespace ChestCounter;

public sealed class MateCount
{
    public string Name { get; set; } = "";
    public int Chests { get; set; }
}

public sealed class PrizeFind
{
    public string PrizeId { get; set; } = "";
    public string By { get; set; } = "";
    public bool Mine { get; set; }
    public bool Team { get; set; }
}

public sealed class MatchChestCounts
{
    public string MatchId = "";
    public DateTime Time;
    public int You;
    public List<MateCount> Mates = new();
    public List<PrizeFind> Prizes = new();
}

// Reads a Fortnite replay and works out who opened which chest — you, your squad — and which
// treasure-hunt prizes were handed out. Built on the patched parser in /lib (see lib/PATCHES.md);
// the container, refill and ability-grant handling follows LED-N's Fortnite-ChestCounter.
public sealed partial class ChestScanReader : ReplayReader
{
    private sealed record Search(float Time, string Key, string Label, uint? Pawn);
    private sealed record Grant(float Time, uint PlayerState, int ElementId);
    private sealed record Prize(float Time, string Id, uint? Pawn);

    // A position at a given time (world units: centimetres).
    private readonly record struct Pt(float T, float X, float Y, float Z);
    // A closed chest destroyed with nobody named for it (its floor was broken, it fell...).
    private sealed record Orphan(float Time, string Key, string Label, uint Actor);
    // A player sitting in a vehicle: the vehicle's movement is then the player's.
    private sealed class SeatSpan(uint pawn, uint vehicle, float from)
    {
        public uint Pawn { get; } = pawn;
        public uint Vehicle { get; } = vehicle;
        public float From { get; } = from;
        public float To { get; set; } = float.MaxValue;
    }

    private sealed class PlayerInfo
    {
        public long? PlayerId;   // joins to FortniteReplay.PlayerData, which carries the name
        public string? Name;
        public int? Team;
    }

    // Only one replay is parsed at a time: the alias resolver and the raw probe are static hooks.
    public static readonly object ParseLock = new();

    private const string PrizeChestPath =
        "/DelilahTreasureHuntGameplay/Gameplay/Actors/BGA_DelilahTreasureHuntAnimatedChest.BGA_DelilahTreasureHuntAnimatedChest_C";

    static ChestScanReader()
    {
        // Any chest or container blueprint the parser does not know is read as a generic container;
        // what kind it is comes from its name (see IsChest).
        NetFieldParser.AliasResolver = path =>
        {
            if (path.Contains(':') || path.EndsWith("_ClassNetCache", StringComparison.Ordinal)) return null;
            var last = path[(path.LastIndexOf('/') + 1)..];
            if (last.StartsWith("BGA_DelilahTreasureHuntAnimatedChest", StringComparison.Ordinal)) return PrizeChestPath;
            // Cars, boats, carriages: a seated player moves with the vehicle.
            if (VehicleClass().IsMatch(last)) return GenericVehicle.GroupPath;
            return path.Contains("/Containers/", StringComparison.OrdinalIgnoreCase)
                   || last.Contains("Chest", StringComparison.OrdinalIgnoreCase)
                ? GenericContainer.GroupPath
                : null;
        };
    }

    private readonly Dictionary<uint, string> _channelKey = new();
    private readonly Dictionary<uint, string> _channelLabel = new();
    private readonly Dictionary<uint, float> _channelOpenAt = new();
    private readonly Dictionary<uint, bool> _channelSearched = new();
    private readonly Dictionary<uint, uint> _lastSearcher = new();
    private readonly HashSet<string> _searched = new();
    private readonly Dictionary<string, uint?> _lastOpener = new();
    private readonly List<Search> _searches = new();
    private readonly Dictionary<uint, int> _pendingOpener = new();   // channel -> search still waiting for its opener

    // Where everybody is, for chests that break without the server naming who did it.
    private readonly Dictionary<uint, List<Pt>> _pawnTrack = new();
    private readonly Dictionary<uint, List<Pt>> _vehicleTrack = new();
    private readonly List<SeatSpan> _seatSpans = new();
    private readonly Dictionary<(uint Vehicle, int Seat), SeatSpan> _seated = new();
    private readonly List<Orphan> _orphans = new();
    private readonly HashSet<uint> _orphanChannels = new();
    // Loot thrown out of a container: (time, where, the container that owns it).
    private readonly List<(float Time, Pt Loc, uint Owner)> _tosses = new();

    private readonly Dictionary<uint, uint> _pawnToState = new();
    private readonly Dictionary<uint, PlayerInfo> _players = new();   // playerstate actor -> player

    private readonly List<Prize> _prizes = new();
    private readonly HashSet<uint> _prizeChannels = new();

    // Every treasure a player receives grants a "GA_TreasureHandler_*" ability on their player state.
    private readonly Dictionary<uint, string> _handlerGuids = new();
    private readonly List<Grant> _grants = new();
    private readonly Dictionary<string, float> _gizmoItems = new();

    private static float Now => CurrentTime;

    public ChestScanReader() : base(null!, ParseMode.Normal)
    {
        // The ability system component is not decoded by the parser (its fields carry no names), so
        // its raw FastArray payloads are read here.
        RawProbe.Filter = path => path.Contains("FortAbilitySystemComponent", StringComparison.Ordinal);
        RawProbe.Sink = (channel, group, field, data, bits) =>
        {
            if (group.Contains("AbilitySystemComponent", StringComparison.Ordinal)
                && group.EndsWith("_ClassNetCache", StringComparison.Ordinal)
                && field is "?" or "ActivatableAbilities" && _handlerGuids.Count > 0)
                ReadAbilityGrants(channel, data, bits);
        };
    }

    private string PathOf(uint? guid) =>
        guid is null or 0 ? "" : _netGuidCache.TryGetPathName(guid.Value, out var path) ? path : "";

    [GeneratedRegex("_UAID_.*$")]
    private static partial Regex UaidSuffix();

    [GeneratedRegex(@"_Vehicle(_Static)?_C$|MeatballVehicle")]
    private static partial Regex VehicleClass();

    private static string CleanName(string path)
    {
        var name = path[(path.LastIndexOf('/') + 1)..];
        var dot = name.LastIndexOf('.');
        if (dot >= 0) name = name[(dot + 1)..];
        return UaidSuffix().Replace(name, "");
    }

    // Loot cannons, ammo and food boxes are containers but not chests.
    private static bool IsChest(string label)
    {
        var b = label.ToLowerInvariant();
        if (b.Contains("cannon") || b.Contains("ammo") || b.Contains("foodbox") || b.Contains("food_box")) return false;
        return b.Contains("chest");
    }

    // The same container must keep the same key all match: its level path if it is placed in the
    // map, its spawn point if it appeared during the match (buried and relic chests get a new guid
    // every time they come back into range).
    protected override void OnChannelOpened(uint channelIndex, NetworkGUID? actor)
    {
        base.OnChannelOpened(channelIndex, actor);

        var channel = Channels[channelIndex];
        var archetype = PathOf(channel?.ArchetypeId);
        var actorPath = PathOf(channel?.ActorId);
        var label = CleanName(!string.IsNullOrEmpty(archetype) ? archetype : actorPath);

        if (!string.IsNullOrEmpty(actorPath)) _channelKey[channelIndex] = actorPath;
        else if (channel?.Actor?.Location is { } loc && IsChest(label) && !label.StartsWith("Prop_", StringComparison.OrdinalIgnoreCase))
            _channelKey[channelIndex] = $"{label}@{loc.X:F0},{loc.Y:F0}";
        else _channelKey[channelIndex] = $"guid:{channel?.ActorId}";

        _channelLabel[channelIndex] = label;
        _channelOpenAt[channelIndex] = Now;
        _channelSearched.Remove(channelIndex);
        _lastSearcher.Remove(channelIndex);
        _pendingOpener.Remove(channelIndex);
        _prizeChannels.Remove(channelIndex);
        _orphanChannels.Remove(channelIndex);
    }

    private static bool StableKey(string key) =>
        !key.StartsWith("guid:", StringComparison.Ordinal) && !key.StartsWith("ch:", StringComparison.Ordinal);

    // The handler class is exported the first time a treasure is granted; from then on every grant
    // references it by guid. Gizmo items are exported the moment they are first handed out.
    protected override void OnNetGuidExported(uint netGuid, string pathName)
    {
        if (pathName.Contains("TreasureHandler", StringComparison.Ordinal))
            _handlerGuids[netGuid] = CleanName(pathName);
        else if (pathName.Contains("WID_", StringComparison.Ordinal) && GizmoItem().IsMatch(pathName))
            _gizmoItems.TryAdd(CleanName(pathName), Now);
    }

    protected override void OnExportRead(uint channelIndex, INetFieldExportGroup? exportGroup)
    {
        base.OnExportRead(channelIndex, exportGroup);

        switch (exportGroup)
        {
            case BaseContainer container:
                ReadContainer(channelIndex, container);
                break;

            case TreasureHuntChest prize:
                if (prize.bSuccess != false && ReadPrizeId(prize.PrizeTemplateId) is { } id && _prizeChannels.Add(channelIndex))
                    _prizes.Add(new Prize(Now, id, prize.OpeningPawn ?? prize.Instigator));
                break;

            case PlayerPawn pawn:
                if (Channels[channelIndex]?.ActorId is not { } pawnId) break;
                if (pawn.PlayerState is { } ps && ps != 0) _pawnToState[pawnId] = ps;
                if (pawn.ReplicatedMovement is { } move) Track(_pawnTrack, pawnId, move.Location, 0.5f);
                break;

            case GenericVehicle vehicle when vehicle.ReplicatedMovement is { } drive && Channels[channelIndex]?.ActorId is { } vehicleId:
                Track(_vehicleTrack, vehicleId, drive.Location, 0.25f);
                break;

            case SeatComponent seats when seats.PlayerSlots != null && Channels[channelIndex]?.ActorId is { } seatVehicle:
                // Only seats that changed carry a value: a pawn sat down, or 0 for a seat that was left.
                for (var seat = 0; seat < seats.PlayerSlots.Length; seat++)
                {
                    if (seats.PlayerSlots[seat]?.Player is not { } occupant) continue;
                    if (_seated.Remove((seatVehicle, seat), out var leaving)) leaving.To = Now;
                    if (occupant == 0) continue;
                    var span = new SeatSpan(occupant, seatVehicle, Now);
                    _seated[(seatVehicle, seat)] = span;
                    _seatSpans.Add(span);
                }
                break;

            case FortPickup pickup when pickup.bTossedFromContainer == true && pickup.Owner is { } container && container != 0:
                // The pickup spawns where its container stands, then flies to where it lands.
                if (Channels[channelIndex]?.Actor?.Location is { } spawn)
                    _tosses.Add((Now, new Pt(Now, (float)spawn.X, (float)spawn.Y, (float)spawn.Z), container));
                break;

            case FortPlayerState state:
                if (Channels[channelIndex]?.ActorId is not { } stateId) break;
                if (!_players.TryGetValue(stateId, out var player)) _players[stateId] = player = new PlayerInfo();
                if ((state.PlayerId is null ? state.PlayerID : (int?)state.PlayerId) is { } pid) player.PlayerId = pid;
                if (state.TeamIndex is { } team) player.Team = Convert.ToInt32(team);
                break;
        }
    }

    private void ReadContainer(uint channelIndex, BaseContainer container)
    {
        if (container.SearchingPawn is { } searcher && searcher != 0)
        {
            _lastSearcher[channelIndex] = searcher;
            // The opener can arrive in a later update than the "searched" flag: fill it in.
            if (_pendingOpener.Remove(channelIndex, out var index) && _searches[index].Pawn is null)
            {
                _searches[index] = _searches[index] with { Pawn = searcher };
                _lastOpener[_searches[index].Key] = searcher;
            }
        }

        var key = _channelKey.GetValueOrDefault(channelIndex, $"ch:{channelIndex}");
        var label = _channelLabel.GetValueOrDefault(channelIndex, "?");
        // State that arrives together with the channel is old news: the container was opened before
        // it came (back) into range.
        bool stale = Now - _channelOpenAt.GetValueOrDefault(channelIndex, float.MinValue) < 0.5f;

        if (container.bAlreadySearched == false)
        {
            // Refilled during the match: it can be opened, and counted, again.
            _channelSearched[channelIndex] = false;
        }
        else if (container.bAlreadySearched == true && !_channelSearched.GetValueOrDefault(channelIndex))
        {
            _channelSearched[channelIndex] = true;
            uint? openedBy = _lastSearcher.TryGetValue(channelIndex, out var s) ? s : null;
            // Stale and the same opener as last time means that old search seen again, not a new one.
            bool seenAgain = stale && (StableKey(key)
                ? _lastOpener.TryGetValue(key, out var previous) && previous == openedBy
                : _searched.Contains(key));
            if (!seenAgain)
            {
                _searched.Add(key);
                _lastOpener[key] = openedBy;
                if (!stale || StableKey(key))
                {
                    _searches.Add(new Search(Now, key, label, openedBy));
                    if (openedBy is null) _pendingOpener[channelIndex] = _searches.Count - 1;
                }
            }
        }
        else if (container.bDestroyed && container.SearchingPawn is { } destroyer && destroyer != 0
                 && (_searched.Add(key) || (_channelSearched.TryGetValue(channelIndex, out var was) && !was)))
        {
            // Broken open instead of searched: the server names whoever broke it.
            _channelSearched[channelIndex] = true;
            _lastOpener[key] = destroyer;
            if (!stale || StableKey(key)) _searches.Add(new Search(Now, key, label, destroyer));
        }
        else if (container.bDestroyed && container.SearchingPawn is null or 0 && !stale && StableKey(key)
                 && (!_searched.Contains(key) || (_channelSearched.TryGetValue(channelIndex, out var open) && !open))
                 && Channels[channelIndex]?.ActorId is { } orphanActor && _orphanChannels.Add(channelIndex))
        {
            // A closed chest destroyed with nobody named. Who did it is worked out at the end, from
            // where its loot spilled and who stood right there (ResolveOrphans).
            _orphans.Add(new Orphan(Now, key, label, orphanActor));
        }
    }

    private static void Track(Dictionary<uint, List<Pt>> tracks, uint id, FVector? location, float minInterval)
    {
        if (location == null) return;
        if (!tracks.TryGetValue(id, out var track)) tracks[id] = track = new List<Pt>();
        if (track.Count == 0 || Now - track[^1].T >= minInterval)
            track.Add(new Pt(Now, (float)location.X, (float)location.Y, (float)location.Z));
    }

    // Position on a track at a given time (interpolated), or null when nothing is close in time.
    private static Pt? At(List<Pt>? track, float t, float maxGap = 3f)
    {
        if (track == null || track.Count == 0) return null;
        int lo = 0, hi = track.Count - 1;
        while (lo < hi)
        {
            var mid = (lo + hi) / 2;
            if (track[mid].T < t) lo = mid + 1; else hi = mid;
        }
        var after = track[lo];
        if (lo == 0 || after.T <= t) return Math.Abs(after.T - t) <= maxGap ? after : null;
        var before = track[lo - 1];
        if (after.T - before.T <= maxGap)
        {
            var f = (t - before.T) / (after.T - before.T);
            return new Pt(t, before.X + (after.X - before.X) * f, before.Y + (after.Y - before.Y) * f, before.Z + (after.Z - before.Z) * f);
        }
        var nearest = t - before.T <= after.T - t ? before : after;
        return Math.Abs(nearest.T - t) <= maxGap ? nearest : null;
    }

    // Where a player's pawn is: in its vehicle while seated, on its own track otherwise.
    private Pt? PositionOf(uint pawn, float t)
    {
        foreach (var span in _seatSpans)
            if (span.Pawn == pawn && t >= span.From - 0.5f && t <= span.To + 0.5f
                && At(_vehicleTrack.GetValueOrDefault(span.Vehicle), t) is { } inVehicle)
                return inVehicle;
        return At(_pawnTrack.GetValueOrDefault(pawn), t);
    }

    private static float Distance(Pt a, Pt b) =>
        MathF.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y) + (a.Z - b.Z) * (a.Z - b.Z));

    // Gives each closed chest destroyed with nobody named to the player who stood right at it when
    // its loot spilled: within 4.5 m, nobody closer. The loot is the chest's own for certain, since
    // the server makes the container the owner of the pickups it throws out. (LED-N's method.)
    private void ResolveOrphans()
    {
        foreach (var orphan in _orphans)
        {
            var loot = _tosses.Where(x => x.Owner == orphan.Actor && Math.Abs(x.Time - orphan.Time) <= 2f).Select(x => x.Loc).ToList();
            if (loot.Count == 0) continue;

            uint nearest = 0;
            var nearestDistance = 450f;
            foreach (var pawn in _pawnToState.Keys)
            {
                if (PositionOf(pawn, orphan.Time) is not { } at) continue;
                var d = loot.Min(l => Distance(at, l));
                if (d < nearestDistance) { nearestDistance = d; nearest = pawn; }
            }
            if (nearest == 0) continue;

            if (_searched.Add(orphan.Key + "#orphan" + orphan.Time.ToString("F0")))
                _searches.Add(new Search(orphan.Time, orphan.Key, orphan.Label, nearest));
        }
        _orphans.Clear();
    }

    // Decodes a FastArray delta (ActivatableAbilities) without field names: header, then for each
    // changed element its id and properties. An element that references a treasure handler class
    // means a treasure was given to the owner of this ability system.
    private void ReadAbilityGrants(uint channel, byte[] data, int bits)
    {
        var pos = 1;   // bSupportsFastArrayDeltaStructSerialization
        int Bit() => pos < bits ? (data[pos >> 3] >> (pos & 7)) & 1 : throw new IndexOutOfRangeException();
        uint Read(int n) { uint v = 0; for (var k = 0; k < n; k++) { v |= (uint)Bit() << k; pos++; } return v; }
        uint ReadPacked()
        {
            uint v = 0;
            for (var shift = 0; shift < 35; shift += 7)
            {
                var b = Read(8);
                v |= (b >> 1) << shift;
                if ((b & 1) == 0) return v;
            }
            throw new InvalidDataException();
        }

        try
        {
            _ = Read(32); _ = Read(32);   // replication keys
            var deletes = Read(32);
            var changed = Read(32);
            if (deletes > 512 || changed > 512 || bits < 129) return;
            pos += (int)deletes * 32;

            for (var i = 0; i < changed; i++)
            {
                var elementId = (int)Read(32);
                while (true)
                {
                    var handle = ReadPacked();
                    if (handle == 0) break;
                    var numBits = (int)ReadPacked();
                    if (numBits < 0 || pos + numBits > bits) return;
                    if (numBits is not (8 or 16 or 24 or 32 or 40)) { pos += numBits; continue; }

                    var start = pos;
                    uint guid = 0;
                    for (var shift = 0; pos < start + numBits; shift += 7)
                    {
                        var b = Read(8);
                        guid |= (b >> 1) << shift;
                        if ((b & 1) == 0) break;
                    }
                    pos = start + numBits;

                    if (!_handlerGuids.ContainsKey(guid)) continue;
                    var owner = Channels[channel]?.ActorId ?? 0;
                    if (!_grants.Any(g => g.PlayerState == owner && g.ElementId == elementId))
                        _grants.Add(new Grant(Now, owner, elementId));
                }
            }
        }
        catch (Exception e) when (e is IndexOutOfRangeException or InvalidDataException)
        {
            // Not a FastArray delta, or another layout.
        }
    }

    public MatchChestCounts Classify(FortniteReplay replay)
    {
        var result = new MatchChestCounts
        {
            MatchId = MatchId(replay),
            Time = replay.GameData?.UtcTimeStartedMatch ?? DateTime.MinValue,
        };

        if (replay.GameData?.RecorderId is not { } me) return result;
        ResolveOrphans();

        // The playerstate export carries no readable name; the replay's player list does.
        var names = new Dictionary<long, string>();
        foreach (var p in replay.PlayerData ?? [])
            if (p.Id != null && !string.IsNullOrWhiteSpace(p.PlayerName)) names[Convert.ToInt64(p.Id)] = p.PlayerName.Trim();
        foreach (var p in _players.Values)
            if (p.PlayerId is { } pid && names.TryGetValue(pid, out var n)) p.Name = n;

        _players.TryGetValue(me, out var self);
        int? myTeam = self?.Team;

        uint? StateOf(uint? pawn) => pawn is { } p && _pawnToState.TryGetValue(p, out var s) ? s : null;
        bool IsMate(uint state) => state != me && myTeam != null && _players.TryGetValue(state, out var who) && who.Team == myTeam;

        var chestSearches = _searches.Where(s => IsChest(s.Label)).ToList();
        var perPlayer = new Dictionary<uint, int>();
        foreach (var s in chestSearches)
            if (StateOf(s.Pawn) is { } state) perPlayer[state] = perPlayer.GetValueOrDefault(state) + 1;
        result.You = perPlayer.GetValueOrDefault(me);

        // Squadmates: same team as the recorder. A player can own more than one playerstate
        // (reconnects), so fold by name.
        if (myTeam != null)
        {
            result.Mates = _players
                .Where(p => IsMate(p.Key) && p.Value.Name != null && p.Value.Name != self?.Name)
                .GroupBy(p => p.Value.Name!)
                .Select(g => new MateCount { Name = g.Key, Chests = g.Sum(p => perPlayer.GetValueOrDefault(p.Key)) })
                .OrderByDescending(m => m.Chests)
                .ToList();
        }

        // Golden chests: the prize id and the opener are both in the replay.
        foreach (var prize in _prizes)
        {
            var finder = StateOf(prize.Pawn);
            bool mine = finder == me;
            result.Prizes.Add(new PrizeFind
            {
                PrizeId = prize.Id,
                By = finder is { } f && _players.TryGetValue(f, out var who) ? who.Name ?? "" : "",
                Mine = mine,
                Team = !mine && finder is { } state && IsMate(state),
            });
        }

        // Gizmos: no golden chest, only the handler grant on the recording player. A gizmo goes to
        // everyone in the squad, so each grant is yours; the chest opened at that moment only says
        // whose chest it came out of.
        foreach (var grant in _grants.Where(g => g.PlayerState == me).OrderBy(g => g.Time))
        {
            if (_prizes.Any(p => Math.Abs(p.Time - grant.Time) <= 5)) continue;

            // A buried chest pays out when the dig completes, a few seconds before it reports "searched".
            var chest = _searches
                .Where(s => s.Time >= grant.Time - 3
                            && (s.Time <= grant.Time + 2 || (s.Time <= grant.Time + 4 && s.Label.Contains("Buried", StringComparison.OrdinalIgnoreCase)))
                            && StateOf(s.Pawn) is { } st && (st == me || IsMate(st)))
                .OrderBy(s => Math.Abs(s.Time - grant.Time))
                .FirstOrDefault();
            var opener = StateOf(chest?.Pawn);

            var item = _gizmoItems.Where(g => Math.Abs(g.Value - grant.Time) <= 1).Select(g => g.Key).FirstOrDefault();
            result.Prizes.Add(new PrizeFind
            {
                PrizeId = Treasures.GizmoPrefix + (item ?? ""),
                By = opener == me ? "you" : opener is { } o && _players.TryGetValue(o, out var mate) ? mate.Name ?? "" : "",
                Mine = true,
                Team = true,
            });
        }
        return result;
    }

    [GeneratedRegex("WID_(FlameCeleb|RelicFinder|LuckyLocator|SmugglerExtractionKey)|WID_RelicExtractor(?!_Consumable)")]
    private static partial Regex GizmoItem();

    // "DelilahPrize:dpid_item4", or a bare GUID for the Pirate Shop Access token.
    [GeneratedRegex(@"[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.\-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex PrizeIdPattern();

    private static string? ReadPrizeId(DebuggingObject? raw)
    {
        if (raw == null || raw.TotalBits == 0) return null;
        var ascii = new string(raw.Bytes.Select(b => b is >= 32 and < 127 ? (char)b : ' ').ToArray());
        var match = PrizeIdPattern().Match(ascii);
        return match.Success ? match.Value : null;
    }

    private static string MatchId(FortniteReplay replay)
    {
        var gd = replay.GameData;
        if (!string.IsNullOrEmpty(gd?.GameSessionId)) return gd!.GameSessionId;
        return $"{gd?.UtcTimeStartedMatch:O}|{gd?.RecorderId}";
    }
}
