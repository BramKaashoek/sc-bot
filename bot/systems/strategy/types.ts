type UnitTypeId = number;
type UpgradeId = number;

export type Strategy = {
    name: string;
    production: { unitType: UnitTypeId; count: number; reactors?: number; techLabs?: number }[];
    army: Record<UnitTypeId, number>;
    upgrades: UpgradeId[];
};
