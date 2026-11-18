// Выгружает параметры парковок и суточные профили из кода приложения в ml/meta.json,
// чтобы Python-генератор истории и обучение использовали те же объекты, что и APK.
import { test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LOTS } from '../src/data/places';
import { PROFILES, AVG_STAY } from '../src/engine/profiles';
import { TYPE_ORDER } from '../src/ml/features';

test('export meta', () => {
  const lots = LOTS.filter((l) => !l.closedReason).map((l) => ({
    id: l.id, type: l.type, capacity: l.capacity, factor: l.factor, hours: l.hours ?? null,
  }));
  writeFileSync('ml/meta.json', JSON.stringify({ lots, profiles: PROFILES, avgStay: AVG_STAY, typeOrder: TYPE_ORDER }, null, 1));
});
