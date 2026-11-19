// «По факту занято»: свежая отметка водителя снижает шанс парковки в подборе; старая (45+ мин) не действует.
// ♿: места для людей с инвалидностью из OSM (capacity:disabled) попадают в каталог.
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { useStore } from '../src/store';
import { DESTINATIONS, destToPlace, ORIGINS } from '../src/data/places';
import { recommend } from '../src/engine/recommend';
import { useReports, REPORT_TTL_MIN } from '../src/engine/reports';
import { setCatalogReader, loadIndex, catalogNear } from '../src/catalog/data';

test('отметка «по факту занято» снижает шанс и даёт предупреждение', () => {
  useStore.getState().pinDemo();
  const s = useStore.getState();
  const place = destToPlace(DESTINATIONS.find((d) => /Абая/.test(d.name))!);
  const run = () => recommend(place, ORIGINS[0], s.sim.now, 120, 'balanced', s.sim.occ, [], { hist: s.sim.hist, arriveIn: 10 });
  const before = run();
  const top = before.options[0];
  useReports.getState().report(top.lot.id, 'full', s.sim.now);
  const after = run();
  const same = after.options.find((o) => o.lot.id === top.lot.id)!;
  expect(same.fc.pFree).toBeLessThan(top.fc.pFree * 0.5);
  expect(same.warning).toMatch(/Водитель отметил/);
  expect(same.reported?.text).toBe('по факту мест нет');
  // старая отметка больше не действует
  useReports.getState().report(top.lot.id, 'full', s.sim.now - (REPORT_TTL_MIN + 5) * 60_000);
  expect(run().options.find((o) => o.lot.id === top.lot.id)!.reported).toBeUndefined();
  useReports.getState().clear(top.lot.id);
});

test('♿ из OSM: у части парковок каталога отмечены места для людей с инвалидностью', async () => {
  setCatalogReader(async (p) => JSON.parse(readFileSync(`public/catalog/${p}`, 'utf8')));
  const ix = await loadIndex();
  expect((ix.stats as Record<string, unknown>).disabled).toBeGreaterThan(100);
  const near = await catalogNear(51.1325, 71.40386, 3000); // Астана, центр
  expect(near.every((l) => typeof l.dis === 'number')).toBe(true);
});
