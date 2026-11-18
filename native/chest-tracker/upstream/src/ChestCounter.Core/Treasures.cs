namespace ChestCounter;

// Treasure-hunt prize ids as they appear in replays. Unknown ids (a new week's prizes) still
// show up, just without a friendly name.
public static class Treasures
{
    public const string PirateShopToken = "9f73f94d-2e61-4523-97d7-d61235d3365e";

    private static readonly Dictionary<string, string> Names = new(StringComparer.OrdinalIgnoreCase)
    {
        [PirateShopToken] = "Pirate Shop Access token",
        ["DelilahPrize:dpid_item1"] = "Solid Gold A$AP Rocky (outfit)",
        ["DelilahPrize:dpid_item2"] = "Solid Gold A$AP Rocky's Gauntlets",
        ["DelilahPrize:dpid_item3"] = "No Trespassing (jam track)",
        ["DelilahPrize:dpid_item4"] = "Plunder in Paradise (loading screen)",
        ["DelilahPrize:dpid_item5"] = "Gold Mercedes-AMG G 63 Decal",
        ["DelilahPrize:dpid_item14"] = "Solid Gold Lil Uzi Vert (outfit)",
        ["DelilahPrize:dpid_item15"] = "Diamond and Gold (back bling)",
        ["DelilahPrize:dpid_item16"] = "London (jam track)",
        ["DelilahPrize:dpid_item17"] = "So Kawaii (loading screen)",
        ["DelilahPrize:dpid_item18"] = "Gold Cadillac CT5-V Decal",
    };

    // Gizmos carry no prize id in the replay; we tag them "gizmo:<item>" (item may be empty).
    public const string GizmoPrefix = "gizmo:";

    public static bool IsGizmo(string prizeId) => prizeId.StartsWith(GizmoPrefix, StringComparison.Ordinal);

    public static bool IsToken(string prizeId) =>
        string.Equals(prizeId, PirateShopToken, StringComparison.OrdinalIgnoreCase);

    public static string Name(string prizeId)
    {
        if (IsGizmo(prizeId))
        {
            var item = prizeId[GizmoPrefix.Length..];
            if (item.Length == 0) return "Gizmo";
            item = item.Replace("WID_", "").Replace("_Gizmo", "").Replace("_Consumable_S43", "");
            item = System.Text.RegularExpressions.Regex.Replace(item, "(?<=[a-z])(?=[A-Z])", " ");
            return "Gizmo: " + item;
        }
        return Names.TryGetValue(prizeId, out var name) ? name : $"Treasure ({prizeId})";
    }
}
