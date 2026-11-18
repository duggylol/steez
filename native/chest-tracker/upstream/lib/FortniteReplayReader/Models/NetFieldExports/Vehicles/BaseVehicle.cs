using Unreal.Core.Attributes;
using Unreal.Core.Contracts;
using Unreal.Core.Models;
using Unreal.Core.Models.Enums;

namespace FortniteReplayReader.Models.NetFieldExports.Vehicles;

/// <summary>
/// ChestCounter patch: who sits in a vehicle. <see cref="PlayerSlots"/> has one element per seat (0 = driver), each
/// with the pawn in <see cref="Player"/> (0 when the seat is empty); only the seats that changed are sent.
/// </summary>
[NetFieldExportGroup("/Script/FortniteGame.FortVehicleSeatComponent", minimalParseMode: ParseMode.Minimal)]
public class SeatComponent : INetFieldExportGroup
{
    [NetFieldExport("PlayerSlots", RepLayoutCmdType.DynamicArray)]
    public SeatComponent[] PlayerSlots { get; set; }

    [NetFieldExport("player", RepLayoutCmdType.PropertyObject)]
    public uint? Player { get; set; }
}

[NetFieldExportGroup("/Script/FortniteGame.FortVehicleSeatWeaponComponent", minimalParseMode: ParseMode.Ignore)]
public class WeaponSeatComponent : INetFieldExportGroup
{
    [NetFieldExport("bWeaponEquipped", RepLayoutCmdType.PropertyBool)]
    public bool bWeaponEquipped { get; set; }

    [NetFieldExport("AmmoInClip", RepLayoutCmdType.Property)]
    public DebuggingObject AmmoInClip { get; set; }

    [NetFieldExport("LastFireTime", RepLayoutCmdType.PropertyFloat)]
    public float LastFireTime { get; set; }

    [NetFieldExport("bHasPrevious", RepLayoutCmdType.PropertyBool)]
    public bool bHasPrevious { get; set; }
}
