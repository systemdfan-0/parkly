#!/usr/bin/env bash
# Собирает тестовый «следующий» релиз (versionCode+1) и манифесты в release-test/,
# затем возвращает release.config.json к текущей версии. Подпись — тот же отладочный ключ,
# поэтому Android установит его как обновление поверх текущего APK.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
cp release.config.json /tmp/parkly-release.config.bak
trap 'cp /tmp/parkly-release.config.bak release.config.json' EXIT
CUR_CODE=$(node -p "require('./release.config.json').versionCode")
CUR_NAME=$(node -p "require('./release.config.json').versionName")
NEXT_CODE=$((CUR_CODE + 1)); NEXT_NAME="1.$((CUR_CODE))"
PORT=$(node -p "require('./release.config.json').testServerPort")
node -e "const f='release.config.json',c=require('./'+f);c.versionCode=$NEXT_CODE;c.versionName='$NEXT_NAME';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
npm run build >/dev/null && npx cap sync android >/dev/null
(cd android && ./gradlew assembleDebug -q)
mkdir -p release-test
APK="release-test/Parkly-$NEXT_NAME-test.apk"
cp android/app/build/outputs/apk/debug/app-debug.apk "$APK"
SHA=$(sha256sum "$APK" | cut -d' ' -f1); SIZE=$(stat -c%s "$APK")
cat > release-test/manifest-new.json <<JSON
{
  "versionCode": $NEXT_CODE,
  "versionName": "$NEXT_NAME",
  "publishedAt": "$(date +%F)",
  "changes": [
    "Пин подсказывает запасную парковку",
    "Офлайн ML-прогноз точнее на горизонте 15 минут",
    "Тестовый релиз для проверки обновлений"
  ],
  "apkUrl": "http://10.0.2.2:$PORT/Parkly-$NEXT_NAME-test.apk",
  "sha256": "$SHA",
  "size": $SIZE
}
JSON
cat > release-test/manifest-current.json <<JSON
{
  "versionCode": $CUR_CODE,
  "versionName": "$CUR_NAME",
  "publishedAt": "$(date +%F)",
  "changes": ["Текущая версия"],
  "apkUrl": "http://10.0.2.2:$PORT/Parkly-$CUR_NAME.apk",
  "size": 0
}
JSON
echo "Готово: $APK (код $NEXT_CODE, sha256 $SHA)"
echo "Не забудьте пересобрать текущую версию: npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)"
