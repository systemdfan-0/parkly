// Подсчёт машин по фото: детектор (COCO-SSD) на всём кадре и на перекрывающихся кусках (мелкие дальние машины),
// затем склейка дублей (NMS по IoU). Чистые функции — проверяются тестом без нейросети.
export interface Box { x: number; y: number; w: number; h: number; score: number; cls: string }
export const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle']);

/** Куски кадра: сетка cols×rows с перекрытием overlap (доля). */
export function tiles(W: number, H: number, cols = 2, rows = 2, overlap = 0.25) {
  const tw = W / (cols - (cols - 1) * overlap), th = H / (rows - (rows - 1) * overlap);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: Math.round(c * tw * (1 - overlap)), y: Math.round(r * th * (1 - overlap)), w: Math.round(tw), h: Math.round(th) });
  return out;
}
const iou = (a: Box, b: Box) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i || 1);
};
/** Внутри одной: одна рамка почти целиком внутри другой (обрезок машины на краю куска). */
const inside = (a: Box, b: Box) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / Math.min(a.w * a.h, b.w * b.h) > 0.7;
};
/** Только транспорт, с порогом уверенности; дубли с разных кусков склеиваются. */
export function mergeBoxes(boxes: Box[], minScore = 0.3, iouMax = 0.4): Box[] {
  const v = boxes.filter((b) => VEHICLES.has(b.cls) && b.score >= minScore).sort((a, b) => b.score - a.score);
  const keep: Box[] = [];
  for (const b of v) if (!keep.some((k) => iou(k, b) > iouMax || inside(k, b))) keep.push(b);
  return keep;
}
