// Подсчёт машин: куски кадра покрывают всё фото, дубли с разных кусков склеиваются, люди и знаки не считаются.
import { expect, test } from 'vitest';
import { tiles, mergeBoxes, type Box } from '../src/vision/merge';

test('куски 2×2 и 3×2 покрывают кадр с перекрытием', () => {
  for (const [c, r] of [[2, 2], [3, 2]]) {
    const t = tiles(1280, 853, c, r);
    expect(t.length).toBe(c * r);
    expect(Math.max(...t.map((x) => x.x + x.w))).toBeGreaterThanOrEqual(1279);
    expect(Math.max(...t.map((x) => x.y + x.h))).toBeGreaterThanOrEqual(852);
  }
});

test('дубли и обрезки склеиваются, не-машины и слабые рамки отбрасываются', () => {
  const b = (x: number, y: number, w: number, h: number, score: number, cls = 'car'): Box => ({ x, y, w, h, score, cls });
  const out = mergeBoxes([
    b(100, 100, 200, 100, 0.95), b(105, 102, 195, 98, 0.8),   // та же машина с другого куска
    b(110, 105, 90, 90, 0.6),                                  // её обрезок на краю куска
    b(500, 100, 150, 90, 0.7), b(800, 100, 40, 100, 0.9, 'person'), b(900, 100, 100, 60, 0.2),
    b(1000, 300, 300, 200, 0.5, 'truck'),
  ]);
  expect(out.map((x) => x.cls)).toEqual(['car', 'car', 'truck']);
});
