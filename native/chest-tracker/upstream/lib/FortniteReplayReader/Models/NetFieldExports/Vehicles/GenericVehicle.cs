using Unreal.Core.Attributes;
using Unreal.Core.Contracts;
using Unreal.Core.Models;
using Unreal.Core.Models.Enums;

namespace FortniteReplayReader.Models.NetFieldExports.Vehicles;

/// <summary>
/// ChestCounter patch: any drivable vehicle (cars, SUVs, carriages...). Vehicle blueprints are aliased onto this group
/// through <see cref="Unreal.Core.NetFieldParser.AliasResolver"/>. A seated player no longer replicates its own
/// movement: the vehicle's movement is the player's (see <see cref="SeatComponent"/> for who sits in it).
/// </summary>
[NetFieldExportGroup(GenericVehicle.GroupPath, minimalParseMode: ParseMode.Minimal)]
public class GenericVehicle : INetFieldExportGroup
{
    public const string GroupPath = "__ChestCounter.GenericVehicle";

    [NetFieldExport("ReplicatedMovement", RepLayoutCmdType.RepMovement)]
    [RepMovement(
        locationQuantizationLevel: VectorQuantization.RoundTwoDecimals,
        rotationQuantizationLevel: RotatorQuantization.ShortComponents,
        velocityQuantizationLevel: VectorQuantization.RoundTwoDecimals)]
    public FRepMovement? ReplicatedMovement { get; set; }
}
