// «Камера считает машины»: фото парковки → нейросеть в телефоне обводит машины → свободно ≈ вместимость − машины.
import { useEffect, useRef, useState } from 'react';
import { countCars, loadDetector, type CountResult } from '../vision/detect';
import { useStore } from '../store';
import { Modal } from './Modal';
import { Icon } from './Icon';

interface Props { onClose: () => void; lot?: { id: string; name: string; capacity: number; demo: boolean } }

export function VisionCount({ onClose, lot }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'counting' | 'done' | 'error'>('idle');
  const [step, setStep] = useState<[number, number]>([0, 0]);
  const [res, setRes] = useState<CountResult | null>(null);
  const [cap, setCap] = useState<number>(lot?.capacity ?? 0);
  const [applied, setApplied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const sample = !lot || cap === 0;

  useEffect(() => { void loadDetector().catch(() => {}); }, []); // прогреваем модель, пока выбирают фото

  const run = async (im: HTMLImageElement) => {
    setImg(im); setRes(null); setApplied(false); setState('loading');
    try {
      await loadDetector();
      setState('counting');
      const r = await countCars(im, (d, t) => setStep([d, t]));
      setRes(r); setState('done');
    } catch { setState('error'); }
  };
  const open = (url: string) => { const im = new Image(); im.onload = () => void run(im); im.onerror = () => setState('error'); im.src = url; };
  const onFile = (f?: File | null) => { if (f) open(URL.createObjectURL(f)); };

  // рисуем фото и рамки
  useEffect(() => {
    const c = canvas.current; if (!c || !img) return;
    const W = res?.W ?? Math.min(1280, img.naturalWidth), H = res?.H ?? Math.round(img.naturalHeight * (W / img.naturalWidth));
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, W, H);
    if (!res) return;
    g.lineWidth = Math.max(3, W / 300); g.font = `700 ${Math.max(18, W / 45)}px Onest, sans-serif`;
    res.boxes.forEach((b, i) => {
      g.strokeStyle = '#3DDBB0'; g.strokeRect(b.x, b.y, b.w, b.h);
      const label = `${i + 1}`; const tw = g.measureText(label).width + 12;
      g.fillStyle = '#3DDBB0'; g.fillRect(b.x, b.y - Math.max(24, W / 36), tw, Math.max(24, W / 36));
      g.fillStyle = '#1E2229'; g.fillText(label, b.x + 6, b.y - 6);
    });
  }, [img, res]);

  const cars = res?.boxes.length ?? 0;
  const free = cap > 0 ? Math.max(0, cap - cars) : null;
  const apply = () => {
    if (!lot?.demo || !res) return;
    const occ = Math.min(lot.capacity, cars);
    useStore.setState((s) => ({ sim: { ...s.sim, occ: { ...s.sim.occ, [lot.id]: occ } } }));
    setApplied(true);
  };

  return (
    <Modal onClose={onClose} label="Камера считает машины" wide>
      <div className="vis">
        <h2 className="modal__title"><Icon name="flask" size={18} /> Камера считает машины</h2>
        <p className="muted small">Нейросеть COCO-SSD работает прямо в телефоне: находит машины на фото и считает, сколько мест занято. Фото никуда не отправляется.</p>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="row">
          <button className="btn btn--primary btn--sm" onClick={() => file.current?.click()}><Icon name="map" size={16} /> Сфотографировать парковку</button>
          <button className="btn btn--ghost btn--sm" onClick={() => open('./samples/parking-cc0.jpg')}>Пример фото</button>
        </div>
        {img && <canvas ref={canvas} className="vis__canvas" aria-label="Фото с найденными машинами" />}
        {state === 'loading' && <p className="small">Загружаю нейросеть (один раз, ≈18 МБ из приложения)…</p>}
        {state === 'counting' && <p className="small">Ищу машины… {step[0]}/{step[1]} частей кадра</p>}
        {state === 'error' && <p className="small">Не получилось обработать фото. Попробуйте другое.</p>}
        {state === 'done' && res && (
          <div className="vis__res">
            <p className="vis__big"><b>{cars}</b> {cars % 10 === 1 && cars % 100 !== 11 ? 'машина' : cars % 10 >= 2 && cars % 10 <= 4 && (cars % 100 < 12 || cars % 100 > 14) ? 'машины' : 'машин'} на фото</p>
            <label className="small vis__cap">Мест на парковке:
              <input type="number" min={0} max={5000} value={cap || ''} placeholder="вместимость" onChange={(e) => setCap(Math.max(0, +e.target.value || 0))} />
            </label>
            {free != null && <p>Свободно ≈ <b className="ok">{free}</b> из {cap}</p>}
            <p className="muted small">{res.ms} мс · {res.backend === 'webgl' ? 'видеоядро телефона (WebGL)' : 'процессор'} · уверенность ≥ 30%, дубли с частей кадра склеены.
              Машины, закрытые другими, нейросеть может не увидеть — число скорее занижено.</p>
            {lot?.demo && !applied && <button className="btn btn--dark btn--sm" onClick={apply}>Учесть в прогнозе «{lot.name}»</button>}
            {applied && <p className="small ok">Готово: занятость «{lot?.name}» = {Math.min(cars, lot!.capacity)}, прогноз пересчитан от этого замера.</p>}
          </div>
        )}
        {sample && <p className="muted small">Пример фото: wordpress.org/photos, лицензия CC0.</p>}
      </div>
    </Modal>
  );
}
