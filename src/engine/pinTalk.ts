// «Разговорная» часть Пина: вопросы не про подбор, а про парковку из прошлого ответа, про приложение,
// про данные каталога, приветствия и вопросы не по теме. Всё локально, правила + шаблоны.
// Ответ — не больше двух предложений; факты только из каталога, симуляции и описания приложения.
import { LOTS, LOT_BY_ID, KIND_LABEL, type Lot } from '../data/places';
import type { CatalogIndex, CatalogLot } from '../catalog/data';
import { catalogLot, distM, isCatalogId } from '../catalog/data';
import { CAT_KIND_LABEL, NO_DATA, accessText, feeText } from '../catalog/rank';
import { matchCities } from '../catalog/geo';
import { fold, tokens } from '../catalog/text';
import { freeNow, isOpenAt } from './model';
import { tariffLabel } from './pricing';
import { fmtDist, WALK_DETOUR, WALK_M_PER_MIN } from './geo';
import { fmtTime } from './time';
import { plural, spots } from '../format';
import type { PinCtx } from './pinText';
import type { SimInput } from './pinReply';
import { classify, type IntentModel } from './intent';
import intentModel from './intent-model.json';

export type Talk =
  | { kind: 'say'; text: string; suggest?: string[]; showLot?: string }
  | { kind: 'near' };

export interface TalkInput {
  text: string;
  ctx: PinCtx;
  lastLot: string | null;
  ix: CatalogIndex;
  sim: SimInput;
}

const EXAMPLES = ['Рядом со мной', 'У Хан Шатыра, до 500 тенге в час', 'Что ты умеешь?'];

/** Фразы-шаблоны пишем обычным русским, сравниваем после fold() — так «ё/й/ь», регистр и казахские буквы не мешают. */
function pat(...phrases: string[]) {
  // «слово$» — только целое слово (иначе «ку» совпало бы с «куда», «пока» — с «покажи»).
  // Между словами фразы допускаем до двух слов: «сколько там мест», «можно ли её забронировать».
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const res = phrases.map((p) => {
    const whole = p.endsWith('$');
    const ws = fold(whole ? p.slice(0, -1) : p).split(' ').map(esc);
    return new RegExp(`(?:^| )${ws.join('(?: \\S+){0,2} ')}${whole ? '(?= |$)' : ''}`);
  });
  return (t: string) => res.some((r) => r.test(t));
}
const only = (t: string, test: (t: string) => boolean, maxWords: number) => test(t) && t.split(' ').length <= maxWords;

// ---- про парковку из прошлого ответа
const Q_PRICE = pat('сколько стоит', 'сколько стоить', 'цена', 'цену', 'стоимост', 'тариф', 'почем', 'сколько платить', 'сколько за час', 'сколько денег', 'платная', 'платно ли', 'бағасы', 'канша турады');
const Q_CAP = pat('сколько мест', 'сколько машин', 'вместимост', 'свободных мест', 'свободно ли', 'есть ли места', 'есть места', 'занята', 'заняты', 'много мест', 'бос орын');
const Q_HOURS = pat('круглосуточ', 'до скольки', 'часы работы', 'режим работы', 'когда закрыва', 'когда открыва', 'работает ли', 'ночью', 'во сколько');
const Q_ACCESS = pat('частная', 'частн', 'для всех', 'всем можно', 'можно ли всем', 'пропуск', 'шлагбаум', 'для клиентов', 'кто может', 'кого пускают', 'пустят');
const Q_WALK = pat('далеко', 'сколько идти', 'идти пешком', 'пешком', 'сколько метров', 'расстояни', 'как далеко');
const Q_KIND = pat('крыт', 'подземн', 'под землей', 'многоуровн', 'на улице', 'открытая', 'под крышей');
const Q_BOOK = pat('заброни', 'бронь', 'брони', 'бронир', 'резерв');
const Q_ROUTE = pat('как доехать', 'как проехать', 'маршрут', 'навигатор', '2гис', 'дубльгис', 'яндекс карт', 'google', 'гугл');
const Q_WHICH = pat('какая парковка', 'что за парковк', 'какую посоветовал', 'название парковки', 'где она', 'где это', 'адрес');

// ---- про приложение и данные
const Q_HELP = pat('что умеешь', 'что ты умеешь', 'что можешь', 'что ты можешь', 'как пользоваться', 'как тобой пользоваться', 'что спросить', 'что тебе писать', 'команды', 'help$', 'инструкц');
const Q_WHO = pat('кто ты', 'ты кто', 'ты бот', 'ты робот', 'ты ии', 'ты нейросет', 'нейросет', 'chatgpt', 'gpt$', 'как тебя зовут', 'твое имя', 'почему пингвин', 'ты пингвин', 'сен кимсин');
const Q_ML = pat('прогноз', 'ml$', 'мл модел', 'модель', 'машинн', 'как считаешь', 'откуда знаешь', 'как ты знаешь', 'точност', 'насколько точ', 'шанс', 'вероятност', 'искусственн');
const Q_SOURCE = pat('откуда данные', 'источник', 'откуда парковки', 'откуда база', 'osm$', 'openstreetmap', 'опенстрит', 'геофабрик', 'актуальн', 'свежие данные', 'дата данных', 'когда обновл');
const Q_COUNT = pat('сколько парков', 'сколько всего парков', 'сколько стоянок', 'покрыти', 'какие города', 'в каких городах', 'где больше всего', 'сколько городов', 'база парков', 'каталог');
const Q_DEMO = pat('демо', 'настоящ', 'реальн', 'это правда', 'фейк', 'выдуман', 'симуляц');
const Q_PAY = pat('оплат', 'оплачив', 'картои$', 'по карте$', 'kaspi', 'каспи', 'наличн', 'деньги спиш', 'списыва', 'смс');
const Q_CANCEL = pat('отменить', 'отмена', 'отмени');
const Q_OFFLINE = pat('без интернета', 'офлаин', 'оффлаин', 'нет интернета', 'нет сети', 'без сети');
const Q_GEO = pat('геолокац', 'местоположен', 'gps', 'джипиэс', 'следишь', 'слежк', 'мои данные', 'данные обо мне', 'приватн', 'конфиденц');
const Q_COLORS = pat('цвет', 'зелен', 'желт', 'красн', 'серая', 'серые', 'что значат метки', 'что значит метка', 'точка на метке', 'цифра на метке', 'что за цифр');
const Q_UPDATE = pat('обновлени', 'новая версия', 'обновить приложение', 'версия');
const Q_TIME = pat('который час', 'сколько времени', 'сколько время', 'время сейчас', 'какое время', 'сагат канша');
const Q_EV = pat('зарядк', 'электромоб', 'электрокар', 'tesla', 'тесла', 'зарядная');
const Q_RULES = pat('штраф', 'эвакуат', 'штрафстоянк', 'правила парков', 'пдд', 'запрещ', 'знак');
const Q_DISABLED = pat('инвалид', 'маломобил', 'для людей с инвалид');
const Q_NEAR = pat('рядом со мной', 'возле меня', 'около меня', 'вокруг меня', 'поблизости', 'где я', 'ближаишая ко мне', 'ближаишую ко мне', 'ко мне ближе', 'от меня', 'тут рядом', 'здесь рядом', 'рядом здесь', 'рядом тут', 'мен турган', 'жанымда', 'касымда');

const Q_HELP_SHORT = pat('помоги$', 'помощь$', 'help$', 'хелп$', 'инфо$');
const Q_COLORS_STRONG = pat('что значат', 'что значит', 'цвета мет', 'цвет мет', 'цвета точ', 'цвет точ');
const Q_SHOW = pat('покажи на карте', 'показать на карте', 'на карте покажи', 'где на карте', 'открой на карте', 'покажи ее', 'покажи его');

// ---- разговор
const Q_HI = pat('привет', 'здравств', 'салем', 'салам', 'сэлем', 'добрый день', 'добрый вечер', 'доброе утро', 'хаи$', 'хеллоу', 'hello', 'hi$', 'ку$', 'здорово$', 'кайырлы');
const Q_THANKS = pat('спасибо', 'спс', 'благодар', 'рахмет', 'сяп', 'thanks', 'thank you', 'пасиб');
const Q_HOW = pat('как дела', 'как ты', 'как жизнь', 'как настроени', 'калаисын', 'кал калаи', 'кандаисын');
const Q_BYE = pat('пока$', 'до свидания', 'до встречи', 'сау бол', 'бывай');
const Q_RUDE = pat('тупои', 'тупая', 'дурак', 'глуп', 'бесполезн', 'не понимаешь', 'ничего не понима', 'плохо работаешь', 'бред');
const Q_JOKE = pat('шутк', 'пошути', 'анекдот', 'рассмеши', 'смешн');
const Q_OK = pat('ок$', 'океи$', 'понял$', 'поняла$', 'ясно$', 'хорошо$', 'отлично$', 'супер$', 'класс$', 'круто$', 'норм$', 'жаксы$', 'да$', 'нет$');

// ---- не по теме
const Q_OFFTOPIC = pat('погод', 'курс доллар', 'курс валют', 'доллар', 'евро$', 'новост', 'политик', 'напиши код', 'напиши программ', 'рецепт', 'песн', 'фильм', 'кино посмотреть',
  'такси', 'пробк', 'бензин', 'где поесть', 'стихи', 'стих$', 'домашк', 'реши задачу', 'математик', 'перевед');

/** Вопрос про парковку из прошлого ответа (цена, места, часы…). Без прошлого ответа — просим назвать место. */
function lotQuestion(t: string, inp: TalkInput): Talk | null {
  const tests: [string, (t: string) => boolean][] = [
    ['book', Q_BOOK], ['route', Q_ROUTE], ['price', Q_PRICE], ['cap', Q_CAP], ['hours', Q_HOURS], ['access', Q_ACCESS],
    ['walk', Q_WALK], ['kind', Q_KIND], ['which', Q_WHICH],
  ];
  const asked = tests.filter(([, f]) => f(t)).map(([k]) => k);
  if (!asked.length) return null;
  const id = inp.lastLot;
  if (!id) {
    if (inp.ctx.place) return say(`У «${inp.ctx.place.name}» я пока не нашёл подходящую парковку — измените условие, и я отвечу про неё.`);
    if (asked.includes('book')) return say('Бронь есть у демо-парковок Алматы: спросите меня про место, откройте парковку и нажмите «Забронировать». Бронь демонстрационная, деньги не списываются.', ['Dostyk Plaza через 15 минут']);
    if (asked.includes('route')) return say('Сначала скажите, куда едете: я подберу парковку, а в её карточке будет кнопка «Маршрут».', EXAMPLES);
    return say('Сначала скажите, куда едете, — потом отвечу про цену, места и часы работы парковки.', EXAMPLES);
  }
  const demo = LOT_BY_ID[id];
  const cat = isCatalogId(id) ? catalogLot(id) : null;
  if (!demo && !cat) return null;
  const parts = asked.slice(0, 2).map((k) => (demo ? demoFact(k, demo, inp) : catFact(k, cat!, inp))).filter(Boolean) as string[];
  if (!parts.length) return null;
  return { kind: 'say', text: parts.join(' '), showLot: id };
}

const name = (l: Lot | CatalogLot) => ('short' in l ? `«${l.name}»` : l.name ? `«${l.name}»` : 'Эта парковка');
const walkOf = (lat: number, lon: number, ctx: PinCtx) => {
  if (!ctx.place) return null;
  const d = distM(lat, lon, ctx.place.lat, ctx.place.lon);
  return { d, min: Math.max(1, Math.round((d * WALK_DETOUR) / WALK_M_PER_MIN)) };
};

function demoFact(k: string, l: Lot, inp: TalkInput): string | null {
  const { now, occ, bookings } = inp.sim;
  const open = isOpenAt(l, now);
  const f = freeNow(l, occ[l.id] ?? 0, now, bookings);
  switch (k) {
    case 'price': return `${name(l)}: ${tariffLabel(l.tariff)} (демо-тариф).`;
    case 'cap': return open ? `В ${name(l)} ${spots(l.capacity)}, свободно сейчас ${f} — по демо-симуляции.` : `${name(l)} сейчас закрыта; всего ${spots(l.capacity)} (демо).`;
    case 'hours': return l.hours ? `${name(l)} работает с ${l.hours[0]}:00 до ${l.hours[1] === 24 ? '24:00' : l.hours[1] + ':00'} (демо).` : l.features.includes('Круглосуточно') || l.kind === 'street' ? `${name(l)} доступна круглосуточно (демо).` : `${name(l)}: часы работы в демо не ограничены.`;
    case 'access': return l.bookable ? `${name(l)} открыта для всех, можно взять демо-бронь.` : `${name(l)} — уличная зона для всех, без брони.`;
    case 'walk': { const w = l.walkM != null ? { d: l.walkM, min: Math.max(1, Math.round(l.walkM / WALK_M_PER_MIN)) } : walkOf(l.lat, l.lon, inp.ctx); return w ? `До места ${fmtDist(w.d)}, около ${w.min} мин пешком.` : null; }
    case 'kind': return `${name(l)} — ${KIND_LABEL[l.kind].toLowerCase()}${l.features.includes('Крытый') ? ', крытая' : ''}.`;
    case 'book': return l.bookable ? `${name(l)} можно забронировать: «Показать на карте» → «Забронировать». Бронь демонстрационная, деньги не списываются.` : `${name(l)} — уличная зона, бронь там не работает.`;
    case 'route': return 'Откройте парковку кнопкой «Показать на карте» — в карточке есть «Маршрут».';
    case 'which': return `Я советовал ${name(l)} — демо-парковку на реальном объекте OSM.`;
  }
  return null;
}

function catFact(k: string, l: CatalogLot, inp: TalkInput): string | null {
  const nm = name(l);
  switch (k) {
    case 'price': { const f = feeText(l); return f === NO_DATA ? `${nm}: цена в OSM не указана — нет данных.` : `${nm}: ${f.replace(' (OSM)', '').toLowerCase()} по данным OSM.`; }
    case 'cap': return `${nm}: ${l.cap != null ? `${spots(l.cap)} по OSM` : 'число мест — нет данных'}; занятость — нет данных, датчиков нет.`;
    case 'hours': return l.hours ? `Часы работы по OSM: ${l.hours}.` : `${nm}: часы работы в OSM не указаны — нет данных.`;
    case 'access': { const a = accessText(l); return a === NO_DATA ? `${nm}: доступ в OSM не указан — нет данных.` : `${nm}: ${a.toLowerCase()} (OSM).`; }
    case 'walk': { const w = walkOf(l.lat, l.lon, inp.ctx); return w ? `До места ${fmtDist(w.d)}, около ${w.min} мин пешком.` : null; }
    case 'kind': return l.kind ? `${nm}: ${CAT_KIND_LABEL[l.kind].toLowerCase()} (OSM).` : `${nm}: тип парковки в OSM не указан — нет данных.`;
    case 'book': return 'Бронь есть только у демо-парковок Алматы; у парковок из каталога OSM её нет.';
    case 'route': return 'Откройте парковку кнопкой «Показать на карте» — в карточке есть «Маршрут».';
    case 'which': return `Я советовал ${nm === 'Эта парковка' ? 'парковку без названия в OSM' : nm}${l.op ? `, оператор: ${l.op}` : ''}.`;
  }
  return null;
}

const say = (text: string, suggest?: string[]): Talk => ({ kind: 'say', text, suggest });
const n = (v: number) => v.toLocaleString('ru-RU').replace(/,/g, ' ');

function catalogStats(t: string, inp: TalkInput): Talk {
  const { ix } = inp;
  const explicit = matchCities(ix, tokens(t), new Set())[0]?.city ?? null;
  const city = explicit ?? (/всего|казахстан|стране|городах|городов|больше всего|покрыти/.test(t) ? null : inp.ctx.city);
  const s = ix.stats;
  if (city) {
    const rank = [...ix.cities].sort((a, b) => b.lots - a.lots).findIndex((c) => c.i === city.i) + 1;
    return say(`В каталоге OSM у города ${city.ru} ${n(city.lots)} ${plural(city.lots, ['парковка', 'парковки', 'парковок'])} — ${rank}-е место в стране. Занятость у них неизвестна; цена указана примерно у ${Math.round((s.fee_known / s.lots) * 100)}% парковок по стране.`, [`${city.ru}, центр`]);
  }
  const top = [...ix.cities].sort((a, b) => b.lots - a.lots).slice(0, 3);
  return say(`В каталоге ${n(s.lots)} ${plural(s.lots, ['парковка', 'парковки', 'парковок'])} в ${n(s.cities)} населённых пунктах; больше всего — ${top.map((c) => `${c.ru} (${n(c.lots)})`).join(', ')}. Полная таблица — на главном экране, «Покрытие каталога».`);
}

/**
 * Разбираем фразу, которую не понял подбор (или уточнение без нового места).
 * Возвращает ответ, «ищи рядом со мной» или null (тогда работает обычный подбор / «не нашёл»).
 */
export function talk(inp: TalkInput, strongOnly = false): Talk | null {
  const t = fold(inp.text);
  if (!t) return null;
  const words = t.split(' ').length;
  if (strongOnly) return strong(t, inp);

  if (Q_NEAR(t)) return { kind: 'near' };
  if (Q_CANCEL(t)) return say('Брони — во вкладке «Поездки», там у каждой есть кнопка «Отменить». Брони демонстрационные, деньги не списываются.');
  if (Q_SHOW(t)) {
    if (inp.lastLot) return { kind: 'say', text: 'Вот она — кнопка ниже откроет парковку на карте.', showLot: inp.lastLot };
    return say('Сначала скажите, куда едете, — подберу парковку и покажу её на карте.', EXAMPLES);
  }
  const lq = lotQuestion(t, inp);
  if (lq) return lq;
  if (only(t, Q_HELP_SHORT, 2)) return say('Подбираю парковку по всему Казахстану: напишите место, когда приедете и бюджет — «Хан Шатыр через 15 минут до 500». Потом можно спросить про цену, места, часы работы или «а поближе?».', EXAMPLES);

  if (Q_HELP(t)) return say('Подбираю парковку по всему Казахстану: напишите место, когда приедете и бюджет — «Хан Шатыр через 15 минут до 500». Потом можно спросить про цену, места, часы работы или «а поближе?».', EXAMPLES);
  if (Q_WHO(t)) return say('Я Пин, помощник Parkly. Понимаю фразы правилами и обученной моделью намерений (точность ≈90% на отложенных фразах), слышу голос, а места прогнозирует ML-модель — всё прямо на телефоне. Я не большая нейросеть вроде ChatGPT, поэтому лучше всего отвечаю про парковки.', EXAMPLES);
  if (Q_EV(t)) {
    const ev = LOTS.filter((l) => l.features.some((f) => /электромоб/i.test(f)));
    return say(ev.length ? `Зарядка есть у демо-парковки ${ev.map((l) => `«${l.name}»`).join(', ')}. В каталоге OSM зарядки для электромобилей я не учитываю — нет данных.` : 'Про зарядки для электромобилей данных у меня нет.', ev.length ? ['Esentai Mall'] : undefined);
  }
  if (Q_DISABLED(t)) return say(`Места для людей с инвалидностью отмечены в OSM у ${n((inp.ix.stats as { disabled?: number }).disabled ?? 0)} парковок — в списке у них значок ♿, в карточке число мест. У остальных — нет данных, смотрите знаки на месте; могу подобрать ближайшую к входу.`, ['Dostyk Plaza, поближе']);
  if (Q_RULES(t)) return say('Правил, штрафов и эвакуации в моих данных нет, поэтому не буду гадать. Ориентируйтесь на знаки на месте и сайт акимата вашего города.');
  if (Q_ML(t)) return say('В Алматы свободные места демо-парковок прогнозирует ML-модель прямо на телефоне — на 5–15 минут вперёд по часу, дню недели и тому, как менялась занятость за 15 минут; в карточке есть «Почему ИИ так решил». Камера с нейросетью считает машины по фото. Подробно — «Как работает ИИ» на главном экране.', ['Как работает ИИ']);
  if (Q_SOURCE(t)) return say(`Парковки — из OpenStreetMap, выгрузка Geofabrik на ${new Date(inp.ix.source.extractDate).toLocaleDateString('ru-RU')}. Цены, брони и занятость в Алматы — демо-данные, остальное «нет данных», если в OSM пусто.`);
  if (Q_COUNT(t) && /сколко|покрыти|город|больше всего|каталог|база/.test(t)) return catalogStats(t, inp);
  if (Q_PAY(t)) return say('Бронь у демо-парковок Алматы можно оплатить через Kaspi или на месте — это демо-оплата, деньги не списываются. В рабочей версии подключим Kaspi Pay. У парковок из каталога OSM способ оплаты почти нигде не указан — смотрите табличку на месте.');
  if (Q_DEMO(t)) return say(`Демо — это ${LOTS.length} парковок Алматы с симулированной занятостью, тарифами и бронью, они стоят на реальных объектах OSM. Остальные ${n(inp.ix.stats.lots)} — настоящие парковки из OSM, но без занятости.`);
  if (Q_OFFLINE(t)) return say('Без интернета работают каталог, поиск по названиям, Пин и прогноз. Не грузятся только новые куски подложки карты и поиск по точному адресу.');
  if (Q_GEO(t)) return say('Геопозицию я беру только после кнопки «Где я» или просьбы «рядом со мной», и она остаётся на телефоне. Разговор со мной тоже никуда не отправляется.', ['Рядом со мной']);
  if (Q_COLORS(t)) return say('Квадрат «P» — парковка: мятная рамка — из каталога OSM, цветная точка — демо-парковка Алматы (зелёная — места есть, жёлтая — мало, красная — нет, серая — закрыта). Круг с числом — сколько парковок в этой группе: нажмите, чтобы приблизить.');
  if (Q_UPDATE(t)) return say('Parkly сам проверяет обновления при запуске и показывает уведомление, когда выходит новая версия. Текущую версию и кнопку «Проверить обновления» найдёте во вкладке «Избранное», раздел «Приложение».');
  if (Q_TIME(t)) return say(`По часам приложения сейчас ${fmtTime(inp.sim.now)}. В демо время можно сдвинуть — от него зависит прогноз.`);
  if (Q_OFFTOPIC(t)) return say('Тут я не помощник — у меня есть только данные о парковках. Спросите, где встать, сколько стоит или будет ли место.', EXAMPLES);
  if (Q_JOKE(t)) return say('Водитель сделал три круга у ТРЦ, а на четвёртом спросил Пина. Анекдот короткий, потому что место нашлось быстро.', EXAMPLES);
  if (Q_RUDE(t)) return say('Понимаю, бывает досадно. Я лучше всего понимаю место, время и бюджет — например «Хан Шатыр до 500» или «рядом со мной».', EXAMPLES);
  if (Q_THANKS(t) && words <= 5) return say('Пожалуйста! Удачной парковки.');
  if (Q_HOW(t)) return say('Всё спокойно, считаю свободные места. Куда едем?', EXAMPLES);
  if (Q_HI(t) && words <= 4) return say('Привет! Куда едем? Напишите место, а если хотите — время и бюджет.', EXAMPLES);
  if (Q_BYE(t) && words <= 4) return say('До встречи! Если что — я тут.');
  if (only(t, Q_OK, 2)) return say(inp.lastLot ? 'Хорошо. Если нужно, спросите про цену, места или «а поближе?».' : 'Хорошо. Куда едем?', inp.lastLot ? ['А сколько стоит?', 'А поближе?'] : EXAMPLES);
  return byModel(inp);
}

/** Каноническая фраза, которую правила точно понимают, — для каждого намерения модели. */
export const CANON: Record<string, string> = {
  help: 'что ты умеешь', who: 'кто ты', pay: 'оплата', cancel: 'отменить бронь', disabled: 'места для инвалидов', ev: 'зарядка для электромобиля',
  rules: 'штраф', ml: 'как работает прогноз', source: 'откуда данные', offline: 'работает без интернета', geo: 'мои данные', colors: 'что значат цвета',
  update: 'новая версия', time: 'который час', offtopic: 'погода', joke: 'анекдот', rude: 'ты тупой', thanks: 'спасибо', hi: 'привет', bye: 'пока',
  how: 'как дела', ok: 'ок', price: 'а сколько стоит', cap: 'а сколько там мест', hours: 'а до скольки работает', book: 'можно забронировать',
};
export const INTENT_MODEL = intentModel as IntentModel;
export const INTENT_MIN_P = 0.6;
/** Порог, при котором модель важнее найденного «места». */
export const STRONG_P = 0.85;
const META = new Set(['help', 'who', 'pay', 'cancel', 'disabled', 'ev', 'rules', 'ml', 'source', 'offline', 'geo', 'colors', 'update', 'time', 'offtopic', 'joke', 'rude', 'thanks', 'hi', 'bye', 'how']);
let inModel = false;
/** Правила не поняли — спрашиваем модель намерений; уверена ≥ 60% — отвечаем как на каноническую фразу. */
function byModel(inp: TalkInput, minP = INTENT_MIN_P): Talk | null {
  if (inModel || !INTENT_MODEL.labels.length) return null;
  const top = classify(INTENT_MODEL, inp.text)[0];
  if (!top || top.p < minP || top.label === 'query') return null;
  if (minP >= STRONG_P && !META.has(top.label)) return null; // до поиска места — только «мета»-вопросы
  if (top.label === 'near') return { kind: 'near' };
  if (['price', 'cap', 'hours', 'book'].includes(top.label) && !inp.lastLot) return null;
  const canon = CANON[top.label];
  if (!canon) return null;
  inModel = true;
  try { return talk({ ...inp, text: canon }); } finally { inModel = false; }
}

/**
 * Вопросы, которые важнее найденного «места»: в «в каких городах больше всего парковок» или «погода в Астане»
 * подбор нашёл бы город или ориентир, но человек спрашивает о другом.
 */
function strong(t: string, inp: TalkInput): Talk | null {
  // «сколько парковок у Меги» — это подбор у места, а не статистика каталога
  if (Q_COUNT(t) && /сколко|покрыти|каких город|больше всего|каталог|база/.test(t) && !/(^| )(у|возле|около|рядом|близ)( |$)/.test(t)) return catalogStats(t, inp);
  if (Q_OFFTOPIC(t)) return say('Тут я не помощник — у меня есть только данные о парковках. Спросите, где встать, сколько стоит или будет ли место.', EXAMPLES);
  if (Q_RULES(t)) return say('Правил, штрафов и эвакуации в моих данных нет, поэтому не буду гадать. Ориентируйтесь на знаки на месте и сайт акимата вашего города.');
  if (Q_HELP(t) || only(t, Q_HELP_SHORT, 2) || Q_WHO(t) || Q_SOURCE(t) || Q_RUDE(t) || Q_JOKE(t) || Q_CANCEL(t) || Q_UPDATE(t) || Q_COLORS_STRONG(t)) return talk(inp);
  // короткие «спасибо», «рахмет», «сәлем», «пока» — не город Спасск и не кафе «Сәлем»
  const words = t.split(' ').length;
  if (words <= 3 && (Q_HI(t) || Q_THANKS(t) || Q_BYE(t) || Q_HOW(t) || Q_OK(t))) return talk(inp);
  if (words <= 4 && Q_SHOW(t)) return talk(inp);
  // модель очень уверена, что это вопрос, а не место («чё по каспи» — не отделение Kaspi Bank)
  return byModel(inp, STRONG_P);
}

/** Ответ, когда совсем не понял: коротко и с подсказками. */
export function dunno(text: string, hasCity: boolean): Talk {
  return say(`Не нашёл «${text}» среди мест и не понял вопрос. Напишите название места или адрес${hasCity ? '' : ' с городом, например «… в Астане»'}, или спросите «что ты умеешь?».`, EXAMPLES);
}
