#!/usr/bin/env python3
"""
Привязка демо-парковок Алматы к реальным объектам OpenStreetMap.

Раньше демо-парковки стояли «на глаз»: приблизительная точка ориентира + сдвиг в метрах,
поэтому на карте они оказывались на крышах, во дворах и посреди дороги.
Этот скрипт берёт ту же выгрузку Geofabrik, что и import.py, и для каждого демо-объекта находит:

  * ориентир (Dostyk Plaza, театр Абая, …) — объект OSM с таким названием рядом с прежней точкой;
  * парковку — настоящую amenity=parking рядом с ориентиром (вид: подземная / многоуровневая / открытая);
  * уличную платную зону — точку на оси названной улицы (или уличную парковку OSM на ней).

Результат: src/data/anchors.json  ({id: [lat, lon, osm_id|null, метод]}).
Тарифы, вместимость и загрузка демо-парковок по-прежнему симуляция — меняются только координаты.

    catalog/.venv/bin/python catalog/anchor_demo.py
"""
import json
import math
import os
import re
import subprocess
import sys

import osmium
from shapely import wkb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PBF = os.path.join(HERE, 'raw', 'kazakhstan-latest.osm.pbf')
OUT = os.path.join(ROOT, 'src', 'data', 'anchors.json')
BBOX = (43.10, 76.75, 43.40, 77.15)  # s, w, n, e — Алматы

# ориентир → поисковые шаблоны названия (регулярки по name / name:ru / name:en)
DEST = {
    'dostyk-plaza': [r'dostyk plaza', r'достык плаза'],
    'esentai': [r'esentai mall', r'есентай молл', r'^esentai$'],
    'mega': [r'^mega(?! silk| park| center park)', r'^мега(?! силк)', r'mega alma'],
    'green-bazaar': [r'зел[её]ный базар', r'көк базар', r'green bazaar'],
    'arbat': [r'(^|[ |])цум', r'центральный универ', r'tsum'],
    'opera': [r'театр оперы и балета', r'opera and ballet'],
    'republic': [r'площадь республики', r'республика алаңы', r'republic square'],
    'stadium': [r'центральный стадион', r'central stadium', r'орталық стадион'],
    'almaty2': [r'алматы[- ]?2', r'almaty[- ]?2', r'алматы[- ]?ii'],
    'medeu': [r'^медеу$', r'^medeu$', r'высокогорный каток', r'медеу.*каток', r'каток.*медеу'],
    'kbtu': [r'британск', r'kbtu', r'кбту'],
    'gorky-park': [r'центральный парк культуры', r'парк имени горького', r'central park', r'орталық мәдениет'],
}
# куда смотреть, если ориентир — большой полигон (стадион, парк): берём точку полигона
STREET = {  # уличная зона → шаблон названия улицы в OSM
    'dp-street': r'жолдасбеков', 'es-street': r'аль-фараби|әл-фараби|al-farabi', 'gb-street': r'зенков', 'op-street': r'панфилов',
    'ar-street': r'абылай хан', 'rs-street': r'сатпаев', 'st-street': r'байтурсын', 'a2-street': r'абылай хан',
    'kb-street': r'толе би', 'gp-street': r'гоголя',
}
# предпочитаемые парковки по названию (если в OSM подписаны)
NAME_HINT = {
    'dp-under': r'dostyk|достык', 'dp-surface': r'dostyk|достык', 'es-under': r'esentai|есентай', 'es-tower': r'esentai|есентай',
    'mega-under': r'mega|мега', 'mega-main': r'mega|мега', 'mega-north': r'mega|мега|кино', 'ar-tsum': r'цум|tsum',
    'a2-short': r'вокзал|алматы', 'a2-long': r'вокзал|алматы', 'md-main': r'медеу|medeu', 'st-main': r'стадион',
}
WANT_KIND = {'underground': {'underground'}, 'multilevel': {'multi-storey', 'rooftop'}, 'surface': {'surface', '', 'carports'}}
STREET_KIND = {'street_side', 'lane', 'on_kerb', 'half_on_kerb', 'layby'}


def inb(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def dist(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 111_320 * k)


def off(p, dx, dy):
    return (p[0] + dy / 111_320, p[1] + dx / (111_320 * math.cos(math.radians(p[0]))))


def seeds():
    """Демо-данные берём прямо из src/data/places.ts (одна правда)."""
    src = open(os.path.join(ROOT, 'src', 'data', 'places.ts'), encoding='utf-8').read()
    dests = {m[0]: (float(m[1]), float(m[2])) for m in re.findall(r"\{ id: '([\w-]+)', name: [^\n]*?lat: ([\d.]+), lon: ([\d.]+)", src)}
    lots = []
    for m in re.finditer(r"\{ id: '([\w-]+)', at: '([\w-]+)', dx: (-?\d+), dy: (-?\d+), name: '([^']+)'.*?kind: '(\w+)'", src, re.S):
        lots.append({'id': m[1], 'at': m[2], 'dx': int(m[3]), 'dy': int(m[4]), 'name': m[5], 'kind': m[6]})
    return dests, lots


def scan():
    parks, named, streets = [], [], []
    wkbf = osmium.geom.WKBFactory()
    fp = (osmium.FileProcessor(PBF).with_locations().with_areas()
          .with_filter(osmium.filter.KeyFilter('amenity', 'name', 'highway')))
    for o in fp:
        t = o.tags
        nm = ' | '.join(v for k, v in ((k, t.get(k)) for k in ('name', 'name:ru', 'name:en', 'name:kk', 'alt_name', 'official_name')) if v).lower()
        if o.is_node():
            if not o.location.valid() or not inb(o.location.lat, o.location.lon):
                continue
            p, oid = (o.location.lat, o.location.lon), f'n{o.id}'
        elif o.is_area():
            try:
                g = wkb.loads(wkbf.create_multipolygon(o), hex=True)
            except Exception:
                continue
            q = g.representative_point()
            if not inb(q.y, q.x):
                continue
            p, oid = (q.y, q.x), ('w' if o.from_way() else 'r') + str(o.orig_id())
        elif o.is_way():
            hw = t.get('highway')
            if not hw or not nm or hw in ('footway', 'path', 'steps', 'cycleway', 'service', 'track', 'pedestrian'):
                continue
            try:
                pts = [(n.lat, n.lon) for n in o.nodes]
            except Exception:
                continue
            if pts and inb(*pts[0]):
                streets.append({'id': f'w{o.id}', 'name': nm, 'pts': pts})
            continue
        else:
            continue
        if t.get('amenity') == 'parking':
            parks.append({'id': oid, 'p': p, 'pk': t.get('parking', ''), 'name': nm, 'access': t.get('access', '')})
        elif nm:
            named.append({'id': oid, 'p': p, 'name': nm, 'area': not o.is_node(),
                          'cls': next((f'{k}={t[k]}' for k in ('shop', 'amenity', 'railway', 'leisure', 'tourism', 'place', 'building') if k in t), '')})
    return parks, named, streets


def nearest_on(pts, q):
    best = (1e18, None)
    for a, b in zip(pts, pts[1:]):
        k = math.cos(math.radians(q[0]))
        ax, ay, bx, by, qx, qy = a[1] * k, a[0], b[1] * k, b[0], q[1] * k, q[0]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        u = 0 if L == 0 else max(0, min(1, ((qx - ax) * dx + (qy - ay) * dy) / L))
        p = (ay + u * dy, (ax + u * dx) / k)
        d = dist(p, q)
        if d < best[0]:
            best = (d, p)
    return best


def main():
    if not os.path.exists(PBF):
        sys.exit('Нет выгрузки: сначала npm run catalog')
    dests, lots = seeds()
    parks, named, streets = scan()
    print(f'Алматы: парковок {len(parks)}, именованных объектов {len(named)}, улиц {len(streets)}')
    out, report = {}, []

    real = {}
    for did, approx in dests.items():
        if did not in DEST:
            continue  # точки отправления (демо) — не ориентиры
        pats = DEST[did]
        cand = [n for n in named if any(re.search(p, n['name']) for p in pats) and dist(n['p'], approx) < 3000]
        # ближе к прежней точке и полигон лучше точки (точка часто стоит на входе или на соседнем доме)
        cand.sort(key=lambda n: dist(n['p'], approx) - (150 if n['area'] else 0))
        if cand:
            c = cand[0]
            real[did] = c['p']
            out[did] = [round(c['p'][0], 6), round(c['p'][1], 6), c['id'], 'osm-name']
            report.append((did, c['name'][:40], c['cls'], round(dist(c['p'], approx))))
        else:
            real[did] = approx
            report.append((did, '— не найден, оставлена прежняя точка', '', 0))

    used = set()
    for s in lots:
        d = real[s['at']]
        want = off(d, s['dx'], s['dy'])  # где задумывалась парковка относительно настоящего ориентира
        if s['kind'] == 'street':
            pat = STREET[s['id']]
            # точка на оси улицы примерно на задуманном расстоянии от ориентира (сценарий «улица дальше, чем площадка у входа»)
            target = math.hypot(s['dx'], s['dy'])
            best = (1e18, None, None)
            for w in streets:
                if not re.search(pat, w['name']):
                    continue
                for a, b in zip(w['pts'], w['pts'][1:]):
                    L = dist(a, b)
                    for i in range(max(1, int(L // 10)) + 1):
                        u = i / max(1, int(L // 10))
                        p = (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
                        sc = abs(dist(p, d) - target) + 0.3 * dist(p, want)
                        if sc < best[0]:
                            best = (sc, p, w['id'])
            sp = [k for k in parks if k['pk'] in STREET_KIND and k['id'] not in used and dist(k['p'], best[1]) < 120]
            if sp:
                k = min(sp, key=lambda k: dist(k['p'], best[1]))
                used.add(k['id'])
                out[s['id']] = [round(k['p'][0], 6), round(k['p'][1], 6), k['id'], 'osm-street-parking']
            else:
                out[s['id']] = [round(best[1][0], 6), round(best[1][1], 6), best[2], 'street-axis']
            dd = round(dist(tuple(out[s['id']][:2]), d))
            report.append((s['id'], s['name'][:40], out[s['id']][3] + (' ⚠ далеко' if dd > 600 else ''), dd))
            continue
        R = 2200 if s['at'] == 'medeu' else 750
        hint = NAME_HINT.get(s['id'])
        cands = []
        for k in parks:
            if k['id'] in used or k['pk'] in STREET_KIND or k['pk'] in ('garage_boxes', 'garages', 'garage'):
                continue
            dd = dist(k['p'], d)
            if dd > R:
                continue
            score = dist(k['p'], want)
            if k['pk'] not in WANT_KIND[s['kind']]:
                score += 220
            if hint and re.search(hint, k['name']):
                score -= 350
            if k['access'] in ('private', 'no', 'residents'):
                score += 400
            cands.append((score, k))
        if not cands:
            # подземный паркинг без отметки в OSM: под самим зданием ориентира
            out[s['id']] = [round(d[0], 6), round(d[1], 6), out.get(s['at'], [0, 0, None])[2], 'under-building']
            report.append((s['id'], s['name'][:40], 'под зданием', 0)); continue
        score, k = min(cands, key=lambda c: c[0])
        if s['kind'] == 'underground' and k['pk'] != 'underground':
            # нет подземной парковки в OSM рядом — ставим на здание ориентира, а не на чужую открытую площадку
            out[s['id']] = [round(d[0], 6), round(d[1], 6), out.get(s['at'], [0, 0, None])[2], 'under-building']
            report.append((s['id'], s['name'][:40], 'под зданием', 0)); continue
        used.add(k['id'])
        out[s['id']] = [round(k['p'][0], 6), round(k['p'][1], 6), k['id'], 'osm-parking:' + (k['pk'] or '?')]
        report.append((s['id'], s['name'][:40], out[s['id']][3] + (' «' + k['name'][:24] + '»' if k['name'] else ''), round(dist(k['p'], d))))

    for r in report:
        print(f'  {r[0]:<13} {r[1]:<42} {r[2]:<34} {r[3]} м')
    date = subprocess.run([sys.executable, '-c', f"import osmium;print(osmium.io.Reader({PBF!r}, osmium.osm.osm_entity_bits.NOTHING).header().get('osmosis_replication_timestamp'))"],
                          capture_output=True, text=True).stdout.strip()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'source': 'OpenStreetMap, Geofabrik Kazakhstan', 'osmDate': date, 'anchors': out}, f, ensure_ascii=False, indent=0)
    print('→', os.path.relpath(OUT, ROOT), len(out), 'точек')


if __name__ == '__main__':
    main()
