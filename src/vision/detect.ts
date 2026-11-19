// Нейросеть в телефоне: COCO-SSD (SSDLite MobileNet v2, TensorFlow.js) находит машины на фото парковки.
// Модель лежит в приложении (public/models), грузится только при первом открытии камеры; фото никуда не отправляется.
import { mergeBoxes, tiles, type Box } from './merge';

type Detector = { detect: (img: any, max?: number, min?: number) => Promise<{ bbox: [number, number, number, number]; class: string; score: number }[]> };
let modelP: Promise<{ tf: typeof import('@tensorflow/tfjs'); model: Detector; backend: string }> | null = null;

export function loadDetector() {
  modelP ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    const coco = await import('@tensorflow-models/coco-ssd');
    try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
    await tf.ready();
    const model = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: './models/ssdlite_mobilenet_v2/model.json' });
    return { tf, model: model as unknown as Detector, backend: tf.getBackend() };
  })();
  modelP.catch(() => { modelP = null; });
  return modelP;
}

export interface CountResult { boxes: Box[]; ms: number; backend: string; W: number; H: number }

/** Считает машины: весь кадр + куски 2×2 и 3×2 (дальние машины мелкие), дубли склеиваются. */
export async function countCars(src: HTMLImageElement | HTMLCanvasElement, onStep?: (done: number, total: number) => void): Promise<CountResult> {
  const { tf, model, backend } = await loadDetector();
  const t0 = performance.now();
  // кадр не больше 1280 px по длинной стороне
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width, sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const k = Math.min(1, 1280 / Math.max(sw, sh));
  const W = Math.round(sw * k), H = Math.round(sh * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d')!.drawImage(src, 0, 0, W, H);
  const img = tf.browser.fromPixels(c);
  const parts = [{ x: 0, y: 0, w: W, h: H }, ...tiles(W, H, 2, 2), ...tiles(W, H, 3, 2)];
  const raw: Box[] = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i];
      const crop = i === 0 ? img : img.slice([t.y, t.x, 0], [Math.min(t.h, H - t.y), Math.min(t.w, W - t.x), 3]);
      const r = await model.detect(crop, 100, 0.2);
      for (const d of r) raw.push({ x: d.bbox[0] + t.x, y: d.bbox[1] + t.y, w: d.bbox[2], h: d.bbox[3], score: d.score, cls: d.class });
      if (i) crop.dispose();
      onStep?.(i + 1, parts.length);
      await new Promise((r) => setTimeout(r, 0)); // дать экрану перерисоваться
    }
  } finally { img.dispose(); }
  return { boxes: mergeBoxes(raw, 0.3), ms: Math.round(performance.now() - t0), backend, W, H };
}
