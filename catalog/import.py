#!/usr/bin/env python3
"""
Импорт парковок Казахстана из выгрузки OpenStreetMap от Geofabrik.

    npm run catalog:setup     # один раз: venv с pyosmium и shapely
    npm run catalog           # скачать свежую выгрузку (если её нет) и пересобрать каталог
    npm run catalog -- --refresh   # принудительно скачать новую выгрузку

Что делает:
  1. Скачивает https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf в catalog/raw/
     и сверяет MD5 с файлом .md5 на Geofabrik.
  2. Читает дату данных из заголовка PBF (osmosis_replication_timestamp).
  3. Берёт amenity=parking (точки и полигоны), населённые пункты (place=city/town/village),
     области (boundary=administrative, admin_level=4) и именованные ориентиры для поиска.
  4. Пишет public/catalog/: index.json (источник, дата, покрытие по городам и областям, сетка),
     cells/<ячейка>.json (парковки по квадратам 0,25°) и places.json (ориентиры для поиска).

Неизвестные значения не придумываем: нет тега — в данных null, в приложении «Нет данных».
Результат детерминирован для одного и того же PBF (сортировка по OSM id).
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import sys
import urllib.request
from collections import Counter, defaultdict

import osmium
import shapely
from shapely import wkb
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(ROOT, 'public', 'catalog')
URL = 'https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf'
CELL = 0.25  # градусы; ~28 км по широте

# ---------- справочники тегов ----------
KIND = {  # parking=* → код вида
    'surface': 'surface', 'multi-storey': 'multilevel', 'underground': 'underground',
    'street_side': 'street', 'lane': 'street', 'on_kerb': 'street', 'half_on_kerb': 'street', 'layby': 'street',
    'rooftop': 'multilevel', 'carports': 'surface', 'sheds': 'surface',
}
EXCLUDE_PARKING = {'garage_boxes', 'garages', 'garage'}  # гаражные кооперативы — не парковка для гостей
ACCESS = {
    'yes': 'public', 'public': 'public', 'permissive': 'public',
    'customers': 'customers', 'destination': 'customers', 'visitors': 'customers', 'guests': 'customers',
    'private': 'private', 'no': 'private', 'permit': 'private', 'residents': 'private',
    'employees': 'private', 'staff': 'private', 'military': 'private', 'delivery': 'private',
}
# Ориентиры для поиска: (ключ, значение) → категория
POI = {
    ('shop', 'mall'): 'mall', ('shop', 'department_store'): 'mall', ('shop', 'supermarket'): 'shop',
    ('amenity', 'marketplace'): 'market', ('amenity', 'theatre'): 'theatre', ('amenity', 'cinema'): 'cinema',
    ('amenity', 'arts_centre'): 'culture', ('amenity', 'concert_hall'): 'culture', ('amenity', 'library'): 'culture',
    ('amenity', 'university'): 'university', ('amenity', 'college'): 'university',
    ('amenity', 'hospital'): 'hospital', ('amenity', 'bus_station'): 'station', ('amenity', 'townhall'): 'gov',
    ('amenity', 'place_of_worship'): 'worship', ('amenity', 'exhibition_centre'): 'culture',
    ('tourism', 'museum'): 'museum', ('tourism', 'attraction'): 'attraction', ('tourism', 'zoo'): 'attraction',
    ('tourism', 'theme_park'): 'attraction', ('tourism', 'hotel'): 'hotel',
    ('leisure', 'stadium'): 'stadium', ('leisure', 'sports_centre'): 'sport', ('leisure', 'water_park'): 'sport',
    ('leisure', 'ice_rink'): 'sport', ('leisure', 'park'): 'park',
    ('railway', 'station'): 'station', ('aeroway', 'aerodrome'): 'airport',
    ('building', 'commercial'): 'business', ('building', 'office'): 'business', ('building', 'retail'): 'mall',
    ('office', 'government'): 'gov',
}
PLACE_R = {'city': 22_000, 'town': 8_000, 'village': 3_000}  # радиус «принадлежности» к населённому пункту
NAME_KEYS = ('name:ru', 'name', 'name:kk', 'name:en', 'alt_name', 'old_name', 'short_name', 'alt_name:ru', 'old_name:ru', 'name:kk-Latn')


def names(tags):
    ru = tags.get('name:ru') or tags.get('name') or tags.get('name:kk') or ''
    kk = tags.get('name:kk') or ''
    en = tags.get('name:en') or ''
    alt = []
    for k in NAME_KEYS:
        for v in (tags.get(k) or '').split(';'):
            v = v.strip()
            if v and v not in (ru, kk, en) and v not in alt:
                alt.append(v)
    return ru.strip(), kk.strip() if kk.strip() != ru.strip() else '', en.strip(), alt


def to_int(v):
    if not v:
        return None
    m = re.match(r'^\s*(\d{1,5})\s*$', v)
    return int(m.group(1)) if m else None


def fee_of(tags):
    v = (tags.get('fee') or tags.get('parking:fee') or '').lower()
    if v in ('no', 'free', 'нет'):
        return 0
    if v in ('yes', 'paid', 'да') or tags.get('charge'):
        return 1
    if v:  # «interval», «Mo-Fr 09:00-18:00» и т.п. — платно в часть времени
        return 1
    return None


def m_dist(lat1, lon1, lat2, lon2):
    k = math.pi / 180
    x = (lon2 - lon1) * k * math.cos((lat1 + lat2) / 2 * k)
    y = (lat2 - lat1) * k
    return 6_371_000 * math.hypot(x, y)


# ---------- загрузка ----------
def download(dst, refresh):
    if os.path.exists(dst) and not refresh:
        return
    os.makedirs(RAW, exist_ok=True)
    tmp = dst + '.part'
    print(f'Скачиваю {URL} …', flush=True)
    with urllib.request.urlopen(URL, timeout=60) as r, open(tmp, 'wb') as f:
        shutil.copyfileobj(r, f, 1 << 20)
    os.replace(tmp, dst)


def md5_of(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def remote_md5():
    try:
        with urllib.request.urlopen(URL + '.md5', timeout=20) as r:
            return r.read().decode().split()[0]
    except Exception as e:  # офлайн — сверка пропускается, это пишем в index.json
        print(f'  MD5 с Geofabrik не получен: {e}')
        return None


# ---------- разбор ----------
def parse(pbf):
    wkbf = osmium.geom.WKBFactory()
    lots, places, pois, regions = [], [], [], []
    excluded = Counter()

    fp = (osmium.FileProcessor(pbf)
          .with_locations()
          .with_areas()
          .with_filter(osmium.filter.KeyFilter('amenity', 'place', 'boundary', 'shop', 'tourism', 'leisure',
                                               'railway', 'aeroway', 'building', 'office')))
    for o in fp:
        tags = o.tags
        if o.is_node():
            loc = o.location
            if not loc.valid():
                continue
            lat, lon, oid, area_m2 = loc.lat, loc.lon, f'n{o.id}', 0
        elif o.is_area():
            # полигоны: из замкнутой линии или мультиполигона
            if tags.get('boundary') == 'administrative' and tags.get('admin_level') == '4':
                try:
                    g = wkb.loads(wkbf.create_multipolygon(o), hex=True)
                except Exception:
                    continue
                ru, kk, en, alt = names(tags)
                regions.append({'osm': ('w' if o.from_way() else 'r') + str(o.orig_id()), 'ru': ru, 'kk': kk, 'en': en,
                                'geom': g.simplify(0.002)})
                continue
            if not (tags.get('amenity') == 'parking' or any((k, tags.get(k)) in POI for k, _ in POI)):
                continue
            try:
                g = wkb.loads(wkbf.create_multipolygon(o), hex=True)
            except Exception:
                continue
            p = g.representative_point()
            lat, lon = p.y, p.x
            # площадь в м² (локальная проекция)
            c = math.cos(math.radians(lat))
            area_m2 = abs(shapely.area(g)) * (111_320 ** 2) * c
            oid = ('w' if o.from_way() else 'r') + str(o.orig_id())
        else:
            continue

        amenity = tags.get('amenity')
        if amenity == 'parking':
            pk = tags.get('parking', '')
            if pk in EXCLUDE_PARKING:
                excluded['garage_boxes'] += 1
                continue
            ru, kk, en, alt = names(tags)
            acc_raw = (tags.get('access') or '').lower()
            lots.append({
                'id': oid, 'lat': round(lat, 5), 'lon': round(lon, 5),
                'name': ru, 'kk': kk,
                'kind': KIND.get(pk) if pk else None,
                'cap': to_int(tags.get('capacity')),
                'fee': fee_of(tags),
                'access': ACCESS.get(acc_raw) if acc_raw else None,
                'hours': (tags.get('opening_hours') or '')[:60],
                'op': (tags.get('operator') or '')[:60],
                'charge': (tags.get('charge') or '')[:40],
                'area': int(area_m2) if area_m2 else 0,
            })
            continue

        if o.is_node() and tags.get('place') in PLACE_R and tags.get('name'):
            ru, kk, en, alt = names(tags)
            places.append({'osm': oid, 'ru': ru, 'kk': kk, 'en': en, 'alt': alt, 'lat': round(lat, 5), 'lon': round(lon, 5),
                           'place': tags['place'], 'pop': to_int((tags.get('population') or '').replace(' ', ''))})
            continue

        cat = None
        for k in ('shop', 'amenity', 'tourism', 'leisure', 'railway', 'aeroway', 'office', 'building'):
            v = tags.get(k)
            if v and (k, v) in POI:
                cat = POI[(k, v)]
                break
        if cat and tags.get('name'):
            if cat == 'airport' and not (tags.get('iata') or 'аэропорт' in tags.get('name', '').lower() or 'airport' in (tags.get('name:en') or '').lower()):
                continue
            ru, kk, en, alt = names(tags)
            pois.append({'id': oid, 'ru': ru, 'kk': kk, 'en': en, 'alt': alt[:3], 'lat': round(lat, 5), 'lon': round(lon, 5), 'cat': cat})
    return lots, places, pois, regions, excluded


def build(lots, places, pois, regions, excluded, meta):
    places.sort(key=lambda p: p['osm'])
    regions.sort(key=lambda r: r['osm'])
    lots.sort(key=lambda l: l['id'])
    pois.sort(key=lambda p: p['id'])

    # области: точка-в-полигоне
    tree = STRtree([r['geom'] for r in regions])

    def region_of(lat, lon):
        pt = shapely.Point(lon, lat)
        for i in tree.query(pt, predicate='intersects'):
            return int(i)
        return -1

    # населённые пункты: ближайший с учётом «радиуса» типа; сетка 0,1° для скорости
    grid = defaultdict(list)
    for i, p in enumerate(places):
        grid[(int(p['lat'] * 10), int(p['lon'] * 10))].append(i)

    def settlement_of(lat, lon):
        best, bs = -1, 1.0
        gy, gx = int(lat * 10), int(lon * 10)
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                for i in grid.get((gy + dy, gx + dx), ()):
                    p = places[i]
                    s = m_dist(lat, lon, p['lat'], p['lon']) / PLACE_R[p['place']]
                    if s < bs:
                        best, bs = i, s
        return best

    for p in places:
        p['region'] = region_of(p['lat'], p['lon'])
    for l in lots:
        l['city'] = settlement_of(l['lat'], l['lon'])
        l['region'] = places[l['city']]['region'] if l['city'] >= 0 else region_of(l['lat'], l['lon'])
    for p in pois:
        p['city'] = settlement_of(p['lat'], p['lon'])

    # только населённые пункты, к которым что-то относится (иначе индекс раздувается деревнями)
    used = Counter(l['city'] for l in lots if l['city'] >= 0)
    used_poi = Counter(p['city'] for p in pois if p['city'] >= 0)
    keep = [i for i, p in enumerate(places) if p['place'] in ('city', 'town') or used[i] or used_poi[i]]
    remap = {old: new for new, old in enumerate(keep)}
    cities = []
    for old in keep:
        p = places[old]
        cities.append({'ru': p['ru'], 'kk': p['kk'], 'en': p['en'], 'alt': p['alt'][:6], 'lat': p['lat'], 'lon': p['lon'],
                       'place': p['place'], 'pop': p['pop'], 'region': p['region'], 'lots': used[old], 'poi': used_poi[old]})
    for l in lots:
        l['city'] = remap.get(l['city'], -1)
    for p in pois:
        p['city'] = remap.get(p['city'], -1)

    reg_lots = Counter(l['region'] for l in lots)
    reg_out = []
    for i, r in enumerate(regions):
        reg_out.append({'ru': r['ru'], 'kk': r['kk'], 'en': r['en'], 'lots': reg_lots[i],
                        'cities': sum(1 for c in cities if c['region'] == i and c['lots'] > 0)})

    # сетка
    cells = defaultdict(list)
    for l in lots:
        cells[(math.floor(l['lat'] / CELL), math.floor(l['lon'] / CELL))].append(l)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'cells'))
    cell_index = []
    for (cy, cx), arr in sorted(cells.items()):
        key = f'{cy}_{cx}'
        rows = [[l['id'], l['lat'], l['lon'], l['name'], l['kk'], l['kind'], l['cap'], l['fee'], l['access'],
                 l['hours'], l['op'], l['charge'], l['area'], l['city']] for l in arr]
        with open(os.path.join(OUT, 'cells', key + '.json'), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        cell_index.append([key, len(arr), round(sum(l['lat'] for l in arr) / len(arr), 4), round(sum(l['lon'] for l in arr) / len(arr), 4)])

    with open(os.path.join(OUT, 'places.json'), 'w', encoding='utf-8') as f:
        json.dump([[p['ru'], p['kk'], p['en'], p['alt'], p['lat'], p['lon'], p['cat'], p['city']] for p in pois],
                  f, ensure_ascii=False, separators=(',', ':'))

    n = len(lots)
    stats = {
        'lots': n,
        'points': sum(1 for l in lots if l['id'][0] == 'n'),
        'polygons': sum(1 for l in lots if l['id'][0] != 'n'),
        'named': sum(1 for l in lots if l['name']),
        'capacity': sum(1 for l in lots if l['cap'] is not None),
        'fee_known': sum(1 for l in lots if l['fee'] is not None),
        'fee_free': sum(1 for l in lots if l['fee'] == 0),
        'fee_paid': sum(1 for l in lots if l['fee'] == 1),
        'access': dict(Counter(l['access'] or 'unknown' for l in lots)),
        'kind': dict(Counter(l['kind'] or 'unknown' for l in lots)),
        'hours': sum(1 for l in lots if l['hours']),
        'no_city': sum(1 for l in lots if l['city'] < 0),
        'excluded_garage_boxes': excluded['garage_boxes'],
        'places': len(pois),
        'cities': len(cities),
    }
    index = {'source': meta, 'cellSize': CELL, 'stats': stats, 'regions': reg_out,
             'cities': cities, 'cells': cell_index}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    return index


def coverage_md(index):
    s, src = index['stats'], index['source']
    regs = sorted(index['regions'], key=lambda r: -r['lots'])
    top = sorted([c for c in index['cities'] if c['lots']], key=lambda c: -c['lots'])
    pct = lambda a: f"{100 * a / max(1, s['lots']):.0f}%"
    L = [
        '# Покрытие каталога парковок',
        '',
        f"Источник: {src['name']}, файл `{src['file']}`, данные OSM на **{src['extractDate']}** (UTC).",
        f"MD5: `{src['md5']}`{' (сверено с Geofabrik)' if src['md5Verified'] else ' (сверка не выполнена)'}. Лицензия: {src['license']}.",
        f"Импорт: {src['importedAt']}. Пересобрать: `npm run catalog`.",
        '',
        f"Всего парковок: **{s['lots']}** (точек {s['points']}, полигонов {s['polygons']}). "
        f"Гаражные кооперативы исключены: {s['excluded_garage_boxes']}.",
        '',
        '| Что известно из OSM | Парковок | Доля |', '|---|---:|---:|',
        f"| Название | {s['named']} | {pct(s['named'])} |",
        f"| Вместимость (capacity) | {s['capacity']} | {pct(s['capacity'])} |",
        f"| Платность (fee) | {s['fee_known']} | {pct(s['fee_known'])} |",
        f"|   из них бесплатно | {s['fee_free']} | {pct(s['fee_free'])} |",
        f"| Доступ (access) | {s['lots'] - s['access'].get('unknown', 0)} | {pct(s['lots'] - s['access'].get('unknown', 0))} |",
        f"|   из них частные | {s['access'].get('private', 0)} | {pct(s['access'].get('private', 0))} |",
        f"|   только для клиентов | {s['access'].get('customers', 0)} | {pct(s['access'].get('customers', 0))} |",
        f"| Часы работы | {s['hours']} | {pct(s['hours'])} |",
        '| Занятость в реальном времени | 0 | 0% |',
        '',
        'Остальное в приложении показано как «Нет данных». Цены в тенге в OSM почти не указаны.',
        '',
        '## По областям и городам республиканского значения', '',
        '| Регион | Парковок | Населённых пунктов с парковками |', '|---|---:|---:|',
    ]
    for r in regs:
        L.append(f"| {r['ru']} | {r['lots']} | {r['cities']} |")
    L += ['', '## Населённые пункты (топ-30)', '', '| Город | Регион | Парковок |', '|---|---|---:|']
    for c in top[:30]:
        reg = index['regions'][c['region']]['ru'] if c['region'] >= 0 else '—'
        L.append(f"| {c['ru']} | {reg} | {c['lots']} |")
    L += ['', f"Ещё {max(0, len(top) - 30)} населённых пунктов с 1+ парковкой; без привязки к населённому пункту: {s['no_city']}."]
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', default=os.path.join(RAW, 'kazakhstan-latest.osm.pbf'))
    ap.add_argument('--refresh', action='store_true', help='скачать выгрузку заново')
    a = ap.parse_args()
    download(a.pbf, a.refresh)
    md5 = md5_of(a.pbf)
    rmd5 = remote_md5()
    if rmd5 and rmd5 != md5:
        print(f'ВНИМАНИЕ: MD5 не совпадает с Geofabrik ({md5} ≠ {rmd5}). На сервере новее выгрузка? Запустите с --refresh.')
    r = osmium.io.Reader(a.pbf, osmium.osm.osm_entity_bits.NOTHING)
    ts = r.header().get('osmosis_replication_timestamp') or ''
    r.close()
    meta = {
        'name': 'OpenStreetMap, выгрузка Geofabrik «Kazakhstan»',
        'url': URL, 'file': os.path.basename(a.pbf), 'md5': md5, 'md5Verified': bool(rmd5 and rmd5 == md5),
        'extractDate': ts.replace('T', ' ').replace('Z', ''), 'license': 'ODbL 1.0, © участники OpenStreetMap',
        'importedAt': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
    }
    print(f'Разбираю {a.pbf} (данные на {meta["extractDate"]}) …', flush=True)
    lots, places, pois, regions, excluded = parse(a.pbf)
    print(f'  парковок {len(lots)}, населённых пунктов {len(places)}, ориентиров {len(pois)}, регионов {len(regions)}')
    index = build(lots, places, pois, regions, excluded, meta)
    with open(os.path.join(HERE, 'COVERAGE.md'), 'w', encoding='utf-8') as f:
        f.write(coverage_md(index))
    size = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(OUT) for fn in fns)
    print(f'Готово: public/catalog ({size / 1e6:.1f} МБ, ячеек {len(index["cells"])}), catalog/COVERAGE.md')


if __name__ == '__main__':
    sys.exit(main())
