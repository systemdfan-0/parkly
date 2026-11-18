"""Parkly — обучение офлайн-прогноза свободных мест (дерево решений, CPU).

Запуск (из папки parkly):  ml/.venv/bin/python ml/train.py
Полный цикл с проверкой в TypeScript:  npm run ml

ДАННЫЕ СИНТЕТИЧЕСКИЕ. Реальных замеров с датчиков парковок Алматы нет, поэтому скрипт
генерирует 4 недели поминутной истории для 37 демо-парковок приложения (ml/meta.json).
Генератор намеренно отличается от эвристики приложения, иначе сравнение было бы нечестным:
  * у каждой парковки свой сдвиг суточного пика (±35 мин), амплитуда и длительность стоянки;
  * дневной уровень спроса «плавает», в дождливые дни ТРЦ заполняются сильнее, а парки пустеют;
  * в пятницу вечером ТРЦ, театры и парки загружены сильнее;
  * в ТРЦ каждые 2 часа заканчиваются киносеансы — короткий всплеск выездов;
  * на стадионе в будни бывают вечерние события;
  * иногда въезд частично перекрыт (ремонт, ДТП) — поток въезда падает до 30% на 45–90 минут;
  * датчик ошибается примерно на ±1 место.

Признаки — только то, что известно в момент прогноза: время суток, день недели, тип и
вместимость парковки, свободные места сейчас и 5/10/15 минут назад. Цель — свободные места
через 5, 10 и 15 минут (дерево учит изменение в долях вместимости). Обучение — первые 21 день,
проверка — последние 7 дней целиком (без перемешивания дней).
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
from sklearn.tree import DecisionTreeRegressor

ROOT = Path(__file__).resolve().parent
SEED = 20261005
DAYS, TRAIN_DAYS = 28, 21
HORIZONS = (5, 10, 15)
STEP = 5  # шаг выборки примеров, мин
QUANTILES = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
# 2026-10-05 00:00 по Алматы (UTC+5) — понедельник
START_MS = int((np.datetime64("2026-10-04T19:00:00") - np.datetime64("1970-01-01T00:00:00")) / np.timedelta64(1, "ms"))
MAX_DEPTH, MIN_LEAF = 8, 300


def load_meta():
    return json.loads((ROOT / "meta.json").read_text())


def profile_curve(meta, typ: str, weekend: bool) -> np.ndarray:
    """Поминутный профиль типа объекта (линейная интерполяция часовых значений, как в приложении)."""
    p = np.array(meta["profiles"][typ]["weekend" if weekend else "weekday"], dtype=float)
    x = np.arange(1440) / 60.0
    i = np.floor(x).astype(int) % 24
    f = x - np.floor(x)
    return p[i] * (1 - f) + p[(i + 1) % 24] * f


def generate(meta, rng: np.random.Generator):
    lots = meta["lots"]
    n, T = len(lots), DAYS * 1440
    cap = np.array([l["capacity"] for l in lots], dtype=float)
    types = [l["type"] for l in lots]
    stay = np.array([meta["avgStay"][t] for t in types], dtype=float) * rng.uniform(0.75, 1.3, n)
    tau = rng.uniform(10, 20, n)
    shift = rng.integers(-35, 36, n)
    amp = rng.uniform(0.88, 1.12, n) * np.array([l["factor"] for l in lots])
    film_offset = rng.integers(0, 120, n)

    open_ = np.ones((n, T), dtype=bool)
    demand = np.zeros((n, T))
    in_mult = np.ones((n, T))
    burst = np.zeros((n, T))
    rain_days = rng.random(DAYS) < 0.25
    rain_mult = {"mall": 1.10, "park": 0.55, "street": 1.05, "residential": 1.05}

    curves = {(t, w): profile_curve(meta, t, w) for t in set(types) for w in (False, True)}
    minute = np.arange(1440)
    for d in range(DAYS):
        dow = d % 7
        weekend = dow >= 5
        sl = slice(d * 1440, (d + 1) * 1440)
        for k, l in enumerate(lots):
            t = types[k]
            c = np.roll(curves[(t, weekend)], int(shift[k]))
            mult = amp[k] * rng.normal(1.0, 0.05)
            if rain_days[d]:
                mult *= rain_mult.get(t, 1.0)
            c = c * mult
            if dow == 4 and t in ("mall", "theatre", "park"):
                c = np.where((minute >= 17 * 60) & (minute < 23 * 60), c * 1.1, c)
            if t == "stadium" and not weekend and rng.random() < 0.15:
                ev = np.clip(1 - np.abs(minute - 19 * 60) / 150, 0, 1)
                c = np.maximum(c, 0.95 * ev)
            demand[k, sl] = cap[k] * np.clip(c, 0, 1.3)
            if rng.random() < 0.04:
                s0 = int(rng.integers(8 * 60, 20 * 60)); dur = int(rng.integers(45, 91))
                in_mult[k, d * 1440 + s0: d * 1440 + s0 + dur] = 0.3
            if t == "mall":
                for end in range(12 * 60 + int(film_offset[k]), 23 * 60, 120):
                    burst[k, d * 1440 + end: d * 1440 + end + 5] += 0.04 * cap[k] / 5
            if l["hours"]:
                o, cl = l["hours"]
                open_[k, sl] = (minute >= o * 60) & (minute < cl * 60)

    occ = np.clip(demand[:, 0], 0, cap)
    obs = np.zeros((n, T), dtype=np.int16)
    for m in range(T):
        dem = demand[:, m]
        slope = (demand[:, m + 1] if m + 1 < T else dem) - dem
        base = occ / stay
        net = slope + (dem - occ) / tau
        lam_in = (base + np.maximum(0, net)) * in_mult[:, m]
        lam_out = base + np.maximum(0, -net) + burst[:, m]
        closed = ~open_[:, m]
        lam_in = np.where(closed, 0, lam_in)
        lam_out = np.where(closed, occ / 15, lam_out)
        dep = np.minimum(occ, rng.poisson(lam_out))
        occ = occ - dep
        arr = np.minimum(cap - occ, rng.poisson(lam_in))
        occ = occ + arr
        noise = np.rint(rng.normal(0, 0.6, n))
        obs[:, m] = np.clip(cap - occ + noise, 0, cap)
    return lots, cap, types, open_, obs, rain_days


def features(meta, lots, cap, types, obs, open_):
    """Примеры каждые STEP минут; признаки только из прошлого, цели — будущее через 5/10/15 мин."""
    rows, targets, meta_rows = [], {h: [] for h in HORIZONS}, []
    order = meta["typeOrder"]
    for d in range(DAYS):
        dow = d % 7
        for mm in range(15, 1440 - max(HORIZONS), STEP):
            m = d * 1440 + mm
            for k in range(len(lots)):
                if not (open_[k, m] and all(open_[k, m + h] for h in HORIZONS)):
                    continue
                c = cap[k]
                fn, f5, f10, f15 = (int(obs[k, m - j]) for j in (0, 5, 10, 15))
                rows.append([mm / 60, dow, 1 if dow >= 5 else 0, c, fn / c, fn,
                             (fn - f5) / c, (fn - f10) / c, (fn - f15) / c,
                             *[1 if types[k] == t else 0 for t in order]])
                for h in HORIZONS:
                    targets[h].append(int(obs[k, m + h]))
                meta_rows.append((d, k, m, fn, f5, f10, f15))
    return np.array(rows), {h: np.array(v) for h, v in targets.items()}, meta_rows


def to_free(X, delta_frac):
    # округление «половина вверх», как Math.round в приложении (np.rint округлял бы 0,5 к чётному)
    return np.floor(np.clip(X[:, 5] + delta_frac * X[:, 3], 0, X[:, 3]) + 0.5)


def export_tree(model: DecisionTreeRegressor, X, y_delta) -> dict:
    t = model.tree_
    leaves = model.apply(X)
    q = [None] * t.node_count
    v = [None] * t.node_count
    for leaf in np.unique(leaves):
        v[int(leaf)] = float(t.value[int(leaf)].ravel()[0])
        q[int(leaf)] = [round(float(v), 5) for v in np.quantile(y_delta[leaves == leaf], QUANTILES)]
    return {
        "left": t.children_left.tolist(), "right": t.children_right.tolist(),
        "feature": t.feature.tolist(), "threshold": [float(v) for v in t.threshold],
        "q": q, "v": v,
    }


def main():
    t0 = time.time()
    meta = load_meta()
    rng = np.random.default_rng(SEED)
    lots, cap, types, open_, obs, rain_days = generate(meta, rng)
    X, Y, info = features(meta, lots, cap, types, obs, open_)
    day = np.array([r[0] for r in info])
    tr, te = day < TRAIN_DAYS, day >= TRAIN_DAYS
    feat_names = ["hour", "dow", "weekend", "capacity", "free_frac", "free", "d5_frac", "d10_frac", "d15_frac",
                  *[f"type_{t}" for t in meta["typeOrder"]]]
    print(f"история: {len(lots)} парковок × {DAYS} дней, примеров {len(X)} (обучение {tr.sum()}, проверка {te.sum()})")

    out = {"version": 1, "trainedAt": time.strftime("%Y-%m-%d"), "seed": SEED,
           "data": "синтетическая история (ml/train.py), 4 недели, 37 демо-парковок",
           "features": feat_names, "quantiles": QUANTILES, "horizons": {}, "metrics": {}}
    preds = {}
    for h in HORIZONS:
        y_delta = (Y[h] - X[:, 5]) / X[:, 3]
        model = DecisionTreeRegressor(max_depth=MAX_DEPTH, min_samples_leaf=MIN_LEAF, random_state=0)
        model.fit(X[tr], y_delta[tr])
        pred_free = to_free(X[te], model.predict(X[te]))
        mae = float(np.mean(np.abs(pred_free - Y[h][te])))
        mae_persist = float(np.mean(np.abs(X[te][:, 5] - Y[h][te])))
        out["horizons"][str(h)] = export_tree(model, X[tr], y_delta[tr])
        imp = sorted(zip(feat_names, model.feature_importances_), key=lambda x: -x[1])[:5]
        out["metrics"][str(h)] = {"mae_tree": round(mae, 3), "mae_persistence": round(mae_persist, 3),
                                  "leaves": int(model.get_n_leaves()), "depth": int(model.get_depth()),
                                  "top_features": [[n, round(float(v), 3)] for n, v in imp]}
        preds[h] = pred_free
        print(f"+{h:>2} мин: MAE дерево {mae:.2f} мест, «как сейчас» {mae_persist:.2f}; листьев {model.get_n_leaves()}")

    (ROOT.parent / "src" / "ml" / "model.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    # тестовые дни для сравнения с эвристикой приложения (ml/compare.task.ts); каждый 3-й пример — ради скорости
    te_idx = np.where(te)[0]
    with open(ROOT / "test_days.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lot_id", "ms", "free_now", "free_m5", "free_m10", "free_m15", "horizon", "target", "py_pred"])
        for j, i in enumerate(te_idx):
            if j % 3:
                continue
            d, k, m, fn, f5, f10, f15 = info[i]
            for h in HORIZONS:
                w.writerow([lots[k]["id"], START_MS + m * 60_000, fn, f5, f10, f15, h, int(Y[h][i]), int(preds[h][j])])
    (ROOT / "train_metrics.json").write_text(json.dumps({
        "samples": int(len(X)), "train": int(tr.sum()), "test": int(te.sum()), "train_days": TRAIN_DAYS, "days": DAYS,
        "rain_days": [int(d) for d in np.where(rain_days)[0]], "metrics": out["metrics"],
        "seconds": round(time.time() - t0, 1), "python": sys.version.split()[0],
    }, ensure_ascii=False, indent=1))
    print(f"готово за {time.time() - t0:.1f} с: src/ml/model.json, ml/test_days.csv")


if __name__ == "__main__":
    main()
