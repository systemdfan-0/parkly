#!/usr/bin/env bash
# Иконки Parkly из art/*.svg: адаптивная иконка Android (вектор + монохром), PNG для старых лаунчеров,
# сплэш-экраны и иконки PWA. Нужен ImageMagick с rsvg.  Запуск: bash scripts/make-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RES=android/app/src/main/res
render() { magick -background none -density 600 "$1" -resize "$2x$2" "$3"; }

declare -A DP=([mdpi]=1 [hdpi]=1.5 [xhdpi]=2 [xxhdpi]=3 [xxxhdpi]=4)
for d in "${!DP[@]}"; do
  s=$(python3 -c "print(round(48*${DP[$d]}))"); f=$(python3 -c "print(round(108*${DP[$d]}))")
  render art/icon-legacy.svg "$s" "$RES/mipmap-$d/ic_launcher.png"
  render art/icon-round.svg "$s" "$RES/mipmap-$d/ic_launcher_round.png"
  render art/icon-foreground.svg "$f" "$RES/mipmap-$d/ic_launcher_foreground.png"
done

# сплэш: графитовый фон, метка по центру
TMP=$(mktemp --suffix .png)
for f in "$RES"/drawable*/splash.png; do
  wh=$(magick identify -format "%w %h" "$f"); w=${wh% *}; h=${wh#* }
  m=$(( (w < h ? w : h) * 32 / 100 ))
  render art/icon-foreground.svg $(( m * 108 / 54 )) "$TMP"
  magick -size "${w}x${h}" xc:'#262B33' "$TMP" -gravity center -composite "$f"
done
rm -f "$TMP"

# PWA
render art/icon-legacy.svg 192 public/icon-192.png
render art/icon-legacy.svg 512 public/icon-512.png
render art/icon-maskable.svg 512 public/icon-maskable-512.png
magick -background '#262B33' -density 600 art/icon-maskable.svg -resize 180x180 public/apple-touch-icon.png
cp art/icon-legacy.svg public/icon.svg
echo "Иконки обновлены"
