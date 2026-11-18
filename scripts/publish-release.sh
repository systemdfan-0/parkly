#!/usr/bin/env bash
# Публикация новой версии Parkly без своего сервера:
#   1) собирает APK (версия — из release.config.json),
#   2) выкладывает его в GitHub Releases (тег vX.Y),
#   3) пишет public/manifest.json со ссылкой и sha256 и пушит в main —
#      GitHub Actions пересобирает сайт, и приложения на телефонах видят обновление.
# Перед запуском: поднять versionCode/versionName в release.config.json и описать изменения в RELEASE_NOTES.md.
#   npm run release
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
CODE=$(node -p "require('./release.config.json').versionCode")
NAME=$(node -p "require('./release.config.json').versionName")
TAG="v$NAME"
APK="release/Parkly-$NAME.apk"
NOTES=RELEASE_NOTES.md

if gh release view "$TAG" >/dev/null 2>&1; then echo "Релиз $TAG уже есть — поднимите versionCode/versionName"; exit 1; fi
npm test
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug -q)
mkdir -p release
cp android/app/build/outputs/apk/debug/app-debug.apk "$APK"
cp "$APK" Parkly.apk
SHA=$(sha256sum "$APK" | cut -d' ' -f1); SIZE=$(stat -c%s "$APK")

gh release create "$TAG" "$APK" --title "Parkly $NAME" --notes-file "$NOTES"

# список изменений для экрана обновления — пункты «- …» из RELEASE_NOTES.md
node -e '
const fs = require("fs");
const changes = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => /^[-*] /.test(l)).map((l) => l.slice(2).trim()).slice(0, 8);
const m = { versionCode: +process.argv[2], versionName: process.argv[3], publishedAt: new Date().toISOString().slice(0, 10), changes,
  apkUrl: process.argv[4], sha256: process.argv[5], size: +process.argv[6] };
fs.writeFileSync("public/manifest.json", JSON.stringify(m, null, 2) + "\n");
' "$NOTES" "$CODE" "$NAME" "https://github.com/$REPO/releases/download/$TAG/Parkly-$NAME.apk" "$SHA" "$SIZE"

git add public/manifest.json release.config.json "$NOTES"
git commit -m "Релиз $NAME: манифест обновления" || true
git push origin main
echo "Готово: $TAG, $APK (sha256 $SHA). Сайт и manifest.json обновятся через 1–2 минуты."
