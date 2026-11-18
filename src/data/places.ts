// Демонстрационные данные Parkly.
// Ориентиры и парковки стоят на реальных объектах OpenStreetMap (anchors.json, catalog/anchor_demo.py).
// Ёмкость, тарифы и загрузка демо-парковок — СИМУЛЯЦИЯ для демо.
import anchorsJson from './anchors.json';

const ANCHORS = (anchorsJson as unknown as { anchors: Record<string, [number, number, string | null, string]> }).anchors;

export type LotType =
  | 'mall' | 'office' | 'market' | 'street' | 'theatre'
  | 'station' | 'residential' | 'park' | 'university' | 'stadium';

export type LotKind = 'underground' | 'surface' | 'street' | 'multilevel';

export interface Tariff {
  perHour: number;          // ₸ за час
  freeMin?: number;         // первые N минут бесплатно
  paidFrom?: number;        // час начала платного периода (улицы)
  paidTo?: number;          // час окончания платного периода
  dailyMax?: number;        // максимум за сутки
}

export interface Lot {
  id: string;
  name: string;
  short: string;            // короткое имя для сравнений
  lat: number;
  lon: number;
  type: LotType;
  kind: LotKind;
  capacity: number;
  factor: number;           // насколько этот объект загружен относительно профиля типа
  tariff: Tariff;
  bookable: boolean;
  hours?: [number, number]; // часы работы [открытие, закрытие] в часах, напр. [7, 19]
  closedReason?: string;    // временно недоступна
  walkM?: number;           // фиксированное расстояние до входа (подземный паркинг в здании)
  maxMin?: number;          // ограничение стоянки
  features: string[];
  osm?: string;             // id объекта OSM, на котором стоит демо-парковка (w123, n456)
}

export interface Destination {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  aliases: string[];
  radius?: number;          // радиус поиска парковок, м
  blurb: string;
}

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  kind: 'landmark' | 'street' | 'address' | 'point' | 'city';
  radius?: number;
}

const M_PER_DEG_LAT = 111_320;
function off(lat: number, lon: number, dx: number, dy: number): [number, number] {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return [+(lat + dy / M_PER_DEG_LAT).toFixed(6), +(lon + dx / mPerDegLon).toFixed(6)];
}

export const DESTINATIONS: Destination[] = [
  { id: 'dostyk-plaza', name: 'Dostyk Plaza', address: 'мкр. Самал-2, ул. Жолдасбекова, 111', lat: 43.2334, lon: 76.9567,
    aliases: ['достык плаза', 'dostyk plaza', 'достык', 'дп', 'самал', 'жолдасбекова', 'трц достык'], blurb: 'ТРЦ' },
  { id: 'esentai', name: 'Esentai Mall', address: 'пр. Аль-Фараби, 77/8', lat: 43.2187, lon: 76.9281,
    aliases: ['есентай', 'esentai', 'эсентай', 'есентай молл', 'аль-фараби 77'], blurb: 'ТРЦ' },
  { id: 'mega', name: 'MEGA Alma-Ata', address: 'ул. Розыбакиева, 247А', lat: 43.2024, lon: 76.8922,
    aliases: ['мега', 'mega', 'мега алма-ата', 'mega alma-ata', 'розыбакиева 247'], blurb: 'ТРЦ' },
  { id: 'green-bazaar', name: 'Зелёный базар', address: 'ул. Жибек Жолы, 53', lat: 43.2623, lon: 76.9532,
    aliases: ['зеленый базар', 'зелёный базар', 'кок базар', 'көк базар', 'green bazaar', 'базар', 'рынок'], blurb: 'Рынок' },
  { id: 'arbat', name: 'Арбат и ЦУМ', address: 'ул. Жибек Жолы / пр. Абылай хана', lat: 43.2617, lon: 76.9430,
    aliases: ['арбат', 'цум', 'жибек жолы', 'пешеходная улица'], blurb: 'Пешеходная улица' },
  { id: 'opera', name: 'Театр оперы и балета им. Абая', address: 'ул. Кабанбай батыра, 110', lat: 43.2503, lon: 76.9466,
    aliases: ['гатоб', 'опера', 'театр абая', 'оперный театр', 'театр оперы', 'балет'], blurb: 'Спектакль в 19:00' },
  { id: 'republic', name: 'Площадь Республики', address: 'пр. Назарбаева / ул. Сатпаева', lat: 43.2381, lon: 76.9452,
    aliases: ['площадь республики', 'республики', 'монумент независимости', 'старая площадь'], blurb: 'Площадь' },
  { id: 'stadium', name: 'Центральный стадион', address: 'ул. Сатпаева, 29/3', lat: 43.2369, lon: 76.9201,
    aliases: ['центральный стадион', 'стадион', 'сатпаева 29'], blurb: 'Стадион' },
  { id: 'almaty2', name: 'Вокзал Алматы-2', address: 'пр. Абылай хана, 1', lat: 43.2719, lon: 76.9409,
    aliases: ['алматы 2', 'алматы-2', 'вокзал', 'жд вокзал', 'вокзал алматы'], blurb: 'Вокзал' },
  { id: 'medeu', name: 'Медеу', address: 'ул. Горная, 465', lat: 43.1574, lon: 77.0587, radius: 1300,
    aliases: ['медеу', 'каток медеу', 'medeu', 'каток'], blurb: 'Каток в горах' },
  { id: 'kbtu', name: 'КБТУ', address: 'ул. Толе би, 59', lat: 43.2556, lon: 76.9438,
    aliases: ['кбту', 'kbtu', 'британский университет', 'толе би 59'], blurb: 'Университет' },
  { id: 'gorky-park', name: 'Центральный парк', address: 'ул. Гоголя, 1', lat: 43.2622, lon: 76.9705,
    aliases: ['парк горького', 'центральный парк', 'парк', 'гоголя 1'], blurb: 'Парк' },
];

// Улицы — для поиска по адресу без интернета (точка в центральной части улицы).
export const STREETS: Place[] = [
  ['пр. Абая', 43.2402, 76.9300], ['пр. Аль-Фараби', 43.2190, 76.9200], ['пр. Достык', 43.2470, 76.9575],
  ['пр. Назарбаева', 43.2480, 76.9490], ['ул. Толе би', 43.2555, 76.9300], ['пр. Райымбека', 43.2660, 76.9300],
  ['ул. Сатпаева', 43.2365, 76.9150], ['ул. Жибек Жолы', 43.2618, 76.9480], ['пр. Абылай хана', 43.2560, 76.9420],
  ['ул. Розыбакиева', 43.2200, 76.8930], ['ул. Кабанбай батыра', 43.2500, 76.9300], ['ул. Панфилова', 43.2550, 76.9480],
  ['ул. Жолдасбекова', 43.2330, 76.9540], ['ул. Гоголя', 43.2610, 76.9450], ['ул. Байтурсынова', 43.2420, 76.9260],
].map(([name, lat, lon]) => ({
  id: 'street:' + name, name: name as string, address: 'Улица, Алматы',
  lat: lat as number, lon: lon as number, kind: 'street' as const, radius: 900,
}));

type LotSeed = Omit<Lot, 'lat' | 'lon'> & { at: string; dx: number; dy: number };

const S = (perHour: number) => ({ perHour, paidFrom: 8, paidTo: 20 }); // уличная платная зона

const SEEDS: LotSeed[] = [
  // ── Dostyk Plaza: близко vs дёшево vs надёжно
  { id: 'dp-under', at: 'dostyk-plaza', dx: -95, dy: 70, name: 'Подземный паркинг Dostyk Plaza', short: 'Подземный ТРЦ',
    type: 'mall', kind: 'underground', capacity: 450, factor: 1.06, tariff: { perHour: 400, freeMin: 30 }, bookable: true,
    walkM: 70, hours: [8, 24], features: ['Лифт прямо в ТРЦ', 'Крытый'] },
  { id: 'dp-surface', at: 'dostyk-plaza', dx: 110, dy: -120, name: 'Наземная парковка у главного входа', short: 'У главного входа',
    type: 'mall', kind: 'surface', capacity: 120, factor: 0.985, tariff: { perHour: 500, freeMin: 15 }, bookable: true,
    features: ['Охрана'] },
  { id: 'dp-office', at: 'dostyk-plaza', dx: -215, dy: 150, name: 'Гостевая парковка БЦ, ул. Мендикулова', short: 'Парковка БЦ',
    type: 'office', kind: 'surface', capacity: 70, factor: 1.2, tariff: { perHour: 300 }, bookable: true,
    features: ['Шлагбаум', 'После 18:00 места освобождаются'] },
  { id: 'dp-street', at: 'dostyk-plaza', dx: -420, dy: -40, name: 'Платная зона, ул. Жолдасбекова', short: 'Улица Жолдасбекова',
    type: 'street', kind: 'street', capacity: 40, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'dp-res', at: 'dostyk-plaza', dx: 120, dy: 610, name: 'Гостевые места ЖК, пр. Достык', short: 'ЖК на Достык',
    type: 'residential', kind: 'surface', capacity: 60, factor: 1.0, tariff: { perHour: 250 }, bookable: true,
    features: ['Видеонаблюдение'] },

  // ── Esentai Mall: одна парковка закрыта
  { id: 'es-under', at: 'esentai', dx: 10, dy: -20, name: 'Подземный паркинг Esentai Mall', short: 'Подземный Esentai',
    type: 'mall', kind: 'underground', capacity: 600, factor: 1.0, tariff: { perHour: 500 }, bookable: true, walkM: 80,
    features: ['Лифт в ТРЦ', 'Зарядка для электромобилей'] },
  { id: 'es-p2', at: 'esentai', dx: -60, dy: 170, name: 'Парковка P2 (северная)', short: 'P2 северная',
    type: 'mall', kind: 'surface', capacity: 150, factor: 0.9, tariff: { perHour: 300 }, bookable: true,
    closedReason: 'Временно закрыта: обновляют разметку', features: [] },
  { id: 'es-tower', at: 'esentai', dx: 190, dy: 90, name: 'Паркинг офисной башни', short: 'Офисная башня',
    type: 'office', kind: 'multilevel', capacity: 200, factor: 1.12, tariff: { perHour: 400 }, bookable: true,
    features: ['Крытый', 'После 18:00 места освобождаются'] },
  { id: 'es-street', at: 'esentai', dx: 470, dy: 130, name: 'Платная зона, пр. Аль-Фараби', short: 'Улица Аль-Фараби',
    type: 'street', kind: 'street', capacity: 30, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },

  // ── MEGA: бесплатно и много мест
  { id: 'mega-under', at: 'mega', dx: 0, dy: 20, name: 'Подземный паркинг MEGA', short: 'Подземный MEGA',
    type: 'mall', kind: 'underground', capacity: 900, factor: 0.93, tariff: { perHour: 0 }, bookable: true, walkM: 60,
    features: ['Бесплатно', 'Крытый'] },
  { id: 'mega-main', at: 'mega', dx: 40, dy: -170, name: 'Наземная парковка MEGA (главная)', short: 'Главная наземная',
    type: 'mall', kind: 'surface', capacity: 2000, factor: 0.75, tariff: { perHour: 0 }, bookable: true,
    features: ['Бесплатно'] },
  { id: 'mega-north', at: 'mega', dx: -130, dy: 210, name: 'Парковка у кинотеатра (север)', short: 'У кинотеатра',
    type: 'mall', kind: 'surface', capacity: 300, factor: 1.05, tariff: { perHour: 0 }, bookable: true,
    features: ['Бесплатно'] },

  // ── Зелёный базар: рынок закрывается в 19:00
  { id: 'gb-main', at: 'green-bazaar', dx: 60, dy: -60, name: 'Парковка рынка, ул. Жибек Жолы', short: 'Парковка рынка',
    type: 'market', kind: 'surface', capacity: 180, factor: 1.0, tariff: { perHour: 300 }, bookable: true, hours: [7, 19],
    features: ['Работает 7:00–19:00'] },
  { id: 'gb-multi', at: 'green-bazaar', dx: 240, dy: 160, name: 'Многоуровневый паркинг, ул. Пушкина', short: 'Паркинг на Пушкина',
    type: 'mall', kind: 'multilevel', capacity: 250, factor: 0.9, tariff: { perHour: 300 }, bookable: true,
    features: ['Круглосуточно', 'Крытый'] },
  { id: 'gb-street', at: 'green-bazaar', dx: 330, dy: -160, name: 'Платная зона, ул. Зенкова', short: 'Улица Зенкова',
    type: 'street', kind: 'street', capacity: 50, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'gb-park', at: 'green-bazaar', dx: 420, dy: -380, name: 'Парковка у парка 28 панфиловцев', short: 'У парка Панфиловцев',
    type: 'park', kind: 'surface', capacity: 90, factor: 1.0, tariff: { perHour: 200 }, bookable: true,
    features: [] },

  // ── Театр Абая: перед спектаклем всё заполняется
  { id: 'op-front', at: 'opera', dx: 70, dy: -75, name: 'Парковка у театра, ул. Кабанбай батыра', short: 'У театра',
    type: 'theatre', kind: 'surface', capacity: 60, factor: 1.2, tariff: { perHour: 300 }, bookable: true, walkM: 70,
    features: ['Ко входу 1 минута'] },
  { id: 'op-street', at: 'opera', dx: 250, dy: 80, name: 'Платная зона, ул. Панфилова', short: 'Улица Панфилова',
    type: 'street', kind: 'street', capacity: 45, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'op-multi', at: 'opera', dx: -430, dy: 190, name: 'Паркинг ТЦ, ул. Желтоксан', short: 'Паркинг ТЦ',
    type: 'mall', kind: 'multilevel', capacity: 220, factor: 0.8, tariff: { perHour: 350 }, bookable: true,
    features: ['Крытый', 'Круглосуточно'] },

  // ── Арбат и ЦУМ
  { id: 'ar-tsum', at: 'arbat', dx: -60, dy: -40, name: 'Паркинг ЦУМ', short: 'Паркинг ЦУМ',
    type: 'mall', kind: 'multilevel', capacity: 300, factor: 0.97, tariff: { perHour: 400 }, bookable: true,
    features: ['Крытый'] },
  { id: 'ar-street', at: 'arbat', dx: -30, dy: -260, name: 'Платная зона, пр. Абылай хана', short: 'Улица Абылай хана',
    type: 'street', kind: 'street', capacity: 60, factor: 1.0, tariff: S(200), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'ar-hotel', at: 'arbat', dx: 300, dy: 40, name: 'Парковка гостиницы, ул. Жибек Жолы', short: 'У гостиницы',
    type: 'office', kind: 'surface', capacity: 40, factor: 1.0, tariff: { perHour: 300 }, bookable: true,
    features: [] },

  // ── Площадь Республики
  { id: 'rs-under', at: 'republic', dx: -80, dy: 60, name: 'Подземный паркинг у площади', short: 'Подземный у площади',
    type: 'office', kind: 'underground', capacity: 250, factor: 1.0, tariff: { perHour: 300 }, bookable: true,
    features: ['Крытый'] },
  { id: 'rs-street', at: 'republic', dx: 210, dy: -90, name: 'Платная зона, ул. Сатпаева', short: 'Улица Сатпаева',
    type: 'street', kind: 'street', capacity: 50, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'rs-res', at: 'republic', dx: -380, dy: 160, name: 'Парковка во дворе, ул. Желтоксан', short: 'Двор на Желтоксан',
    type: 'residential', kind: 'surface', capacity: 70, factor: 1.0, tariff: { perHour: 200 }, bookable: true,
    features: [] },

  // ── Центральный стадион
  { id: 'st-main', at: 'stadium', dx: 0, dy: -160, name: 'Парковка Центрального стадиона', short: 'Парковка стадиона',
    type: 'stadium', kind: 'surface', capacity: 400, factor: 1.0, tariff: { perHour: 200 }, bookable: true,
    features: ['В дни матчей заполняется за час'] },
  { id: 'st-street', at: 'stadium', dx: 350, dy: 50, name: 'Платная зона, ул. Байтурсынова', short: 'Улица Байтурсынова',
    type: 'street', kind: 'street', capacity: 40, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
  { id: 'st-office', at: 'stadium', dx: -220, dy: 300, name: 'Паркинг БЦ, пр. Абая', short: 'Паркинг БЦ на Абая',
    type: 'office', kind: 'multilevel', capacity: 150, factor: 1.05, tariff: { perHour: 350 }, bookable: true,
    features: ['Крытый'] },

  // ── Вокзал Алматы-2
  { id: 'a2-short', at: 'almaty2', dx: 40, dy: -60, name: 'Короткая стоянка у вокзала', short: 'Короткая стоянка',
    type: 'station', kind: 'surface', capacity: 80, factor: 1.0, tariff: { perHour: 600, freeMin: 15 }, bookable: true,
    maxMin: 60, features: ['Не дольше 1 часа'] },
  { id: 'a2-long', at: 'almaty2', dx: -250, dy: -120, name: 'Долговременная парковка вокзала', short: 'Долговременная',
    type: 'station', kind: 'surface', capacity: 300, factor: 0.85, tariff: { perHour: 250, dailyMax: 2500 }, bookable: true,
    features: ['Максимум 2 500 ₸ в сутки', 'Круглосуточно'] },
  { id: 'a2-street', at: 'almaty2', dx: 0, dy: -430, name: 'Платная зона, пр. Абылай хана (север)', short: 'Абылай хана, север',
    type: 'street', kind: 'street', capacity: 40, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },

  // ── Медеу
  { id: 'md-main', at: 'medeu', dx: -120, dy: -80, name: 'Парковка у катка Медеу', short: 'У катка',
    type: 'park', kind: 'surface', capacity: 350, factor: 1.0, tariff: { perHour: 500 }, bookable: true,
    features: ['Ко входу 2 минуты'] },
  { id: 'md-hotel', at: 'medeu', dx: 160, dy: 70, name: 'Парковка гостиницы у Медеу', short: 'У гостиницы',
    type: 'park', kind: 'surface', capacity: 60, factor: 0.9, tariff: { perHour: 700 }, bookable: true,
    features: [] },
  { id: 'md-lower', at: 'medeu', dx: -680, dy: -620, name: 'Нижняя парковка (трансфер к катку)', short: 'Нижняя парковка',
    type: 'park', kind: 'surface', capacity: 500, factor: 0.8, tariff: { perHour: 200 }, bookable: true,
    features: ['Бесплатный трансфер'] },

  // ── КБТУ
  { id: 'kb-yard', at: 'kbtu', dx: 30, dy: -60, name: 'Гостевая парковка КБТУ', short: 'Парковка КБТУ',
    type: 'university', kind: 'surface', capacity: 80, factor: 1.0, tariff: { perHour: 300 }, bookable: true, hours: [7, 22],
    features: ['Работает 7:00–22:00'] },
  { id: 'kb-street', at: 'kbtu', dx: -260, dy: 10, name: 'Платная зона, ул. Толе би', short: 'Улица Толе би',
    type: 'street', kind: 'street', capacity: 60, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },

  // ── Центральный парк
  { id: 'gp-main', at: 'gorky-park', dx: -80, dy: -100, name: 'Парковка у главного входа в парк', short: 'Вход в парк',
    type: 'park', kind: 'surface', capacity: 250, factor: 1.0, tariff: { perHour: 300 }, bookable: true,
    features: [] },
  { id: 'gp-street', at: 'gorky-park', dx: -380, dy: -60, name: 'Платная зона, ул. Гоголя (восток)', short: 'Улица Гоголя',
    type: 'street', kind: 'street', capacity: 50, factor: 1.0, tariff: S(150), bookable: false,
    features: ['Оплата на месте', 'Бесплатно с 20:00 до 8:00'] },
];

// ориентиры — на настоящие координаты OSM
for (const d of DESTINATIONS) { const a = ANCHORS[d.id]; if (a) { d.lat = a[0]; d.lon = a[1]; } }
const destById = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));

export const LOTS: Lot[] = SEEDS.map(({ at, dx, dy, ...rest }) => {
  const a = ANCHORS[rest.id];
  if (a) return { ...rest, lat: a[0], lon: a[1], osm: a[3].startsWith('osm-') && a[2] ? a[2] : undefined };
  const d = destById[at];
  const [lat, lon] = off(d.lat, d.lon, dx, dy);
  return { ...rest, lat, lon };
});
/** OSM-объекты, которые уже показаны как демо-парковки (чтобы не рисовать их дважды). */
export const DEMO_OSM = new Set(LOTS.map((l) => l.osm).filter(Boolean) as string[]);

export const LOT_BY_ID: Record<string, Lot> = Object.fromEntries(LOTS.map((l) => [l.id, l]));

export const ORIGINS: Place[] = [
  { id: 'o-satpayev', name: 'Сатпаева / Сейфуллина', address: 'Демо-точка отправления', lat: 43.2345, lon: 76.9310, kind: 'point' },
  { id: 'o-orbita', name: 'мкр. Орбита', address: 'Демо-точка отправления', lat: 43.2045, lon: 76.8770, kind: 'point' },
  { id: 'o-raiymbek', name: 'Райымбека / Сейфуллина', address: 'Демо-точка отправления', lat: 43.2660, lon: 76.9350, kind: 'point' },
];

export const ALMATY_CENTER: [number, number] = [43.2310, 76.9420];
export const ALMATY_BOUNDS = { south: 43.10, north: 43.40, west: 76.75, east: 77.15 };

export function destToPlace(d: Destination): Place {
  return { id: d.id, name: d.name, address: d.address, lat: d.lat, lon: d.lon, kind: 'landmark', radius: d.radius };
}

export const TYPE_LABEL: Record<LotType, string> = {
  mall: 'ТРЦ', office: 'Бизнес-центр', market: 'Рынок', street: 'Улица', theatre: 'Театр',
  station: 'Вокзал', residential: 'Жилой комплекс', park: 'Зона отдыха', university: 'Университет', stadium: 'Стадион',
};

export const KIND_LABEL: Record<LotKind, string> = {
  underground: 'Подземная', surface: 'Открытая', street: 'Уличная', multilevel: 'Многоуровневая',
};
