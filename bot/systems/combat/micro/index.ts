import type { Point2D, ResourceManager, Units } from '@sc-bot/core';
import { MARINE } from '@sc-bot/core/constants/unit-type';
import { BasicMicro } from './basic.ts';
import { MarineMicro } from './marine.ts';
import type { MicroIntent } from './types.ts';

const basic = new BasicMicro();

const micro: Record<number, BasicMicro> = {
    [MARINE]: new MarineMicro(),
};

export const runMicro = async ({
    resources,
    group,
    target,
    intent,
}: {
    resources: ResourceManager;
    group: Units;
    target: Point2D;
    intent: MicroIntent;
}) => {
    const unitTypes = new Set(group.map((unit) => unit.unitType));
    for (const unitType of unitTypes) {
        await (micro[unitType] ?? basic).run({ resources, units: group.ofType(unitType), group, target }, intent);
    }
};
