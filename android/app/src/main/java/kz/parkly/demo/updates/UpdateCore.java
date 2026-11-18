package kz.parkly.demo.updates;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import kz.parkly.demo.BuildConfig;
import kz.parkly.demo.MainActivity;
import kz.parkly.demo.R;

/**
 * Общая логика обновлений: загрузка и проверка манифеста релиза, сравнение versionCode,
 * уведомление «один раз для версии». Используется и плагином (при запуске / по кнопке), и WorkManager.
 */
public final class UpdateCore {
    public static final String PREFS = "parkly_updates";
    public static final String K_URL = "manifest_url";
    public static final String K_NOTIFIED = "notified_code";
    public static final String K_PENDING = "pending_inapp_code";
    public static final String K_LAST_CHECK = "last_check_ms";
    public static final String K_LAST_RESULT = "last_result";
    public static final String K_LAST_SOURCE = "last_source";
    public static final String EXTRA_OPEN = "parkly_open_update";
    public static final String CHANNEL = "updates";
    private static final int NOTIFICATION_ID = 4101;
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;

    private UpdateCore() {}

    public static final class Manifest {
        public int versionCode;
        public String versionName;
        public List<String> changes = new ArrayList<>();
        public String apkUrl;
        public String sha256;
        public long size;
        public String publishedAt;
        public String manifestUrl;

        public JSONObject toJson() throws Exception {
            JSONObject o = new JSONObject();
            o.put("versionCode", versionCode).put("versionName", versionName).put("apkUrl", apkUrl)
                .put("sha256", sha256 == null ? JSONObject.NULL : sha256).put("size", size)
                .put("publishedAt", publishedAt == null ? JSONObject.NULL : publishedAt).put("manifestUrl", manifestUrl);
            o.put("changes", new JSONArray(changes));
            return o;
        }
    }

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static long installedCode(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return BuildConfig.VERSION_CODE;
        }
    }

    public static String installedName(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return BuildConfig.VERSION_NAME;
        }
    }

    /** Адрес считается допустимым: HTTPS; в отладочной сборке ещё и тестовый сервер на компьютере (10.0.2.2 / localhost). */
    public static boolean isAllowedUrl(String url, String extraTrustedHost) {
        try {
            Uri u = Uri.parse(url);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            boolean testHost = BuildConfig.DEBUG && "http".equals(u.getScheme())
                && (host.equals("10.0.2.2") || host.equals("localhost") || host.equals("127.0.0.1"))
                && u.getPort() == BuildConfig.TEST_SERVER_PORT;
            if (testHost) return true;
            if (!"https".equals(u.getScheme())) return false;
            if (extraTrustedHost != null && host.equals(extraTrustedHost.toLowerCase())) return true;
            for (String h : Arrays.asList(BuildConfig.TRUSTED_HOSTS.split(","))) {
                String t = h.trim().toLowerCase();
                if (!t.isEmpty() && (host.equals(t) || host.endsWith("." + t))) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /** Загружает и проверяет манифест. Бросает исключение с понятным текстом при любой ошибке. */
    public static Manifest fetch(String manifestUrl) throws Exception {
        if (manifestUrl == null || manifestUrl.isEmpty()) throw new IllegalStateException("not-configured");
        Uri mu = Uri.parse(manifestUrl);
        boolean testHost = BuildConfig.DEBUG && "http".equals(mu.getScheme()) && isAllowedUrl(manifestUrl, null);
        if (!"https".equals(mu.getScheme()) && !testHost) throw new SecurityException("Манифест должен загружаться по HTTPS");
        HttpURLConnection con = (HttpURLConnection) new URL(manifestUrl).openConnection();
        con.setConnectTimeout(8000);
        con.setReadTimeout(8000);
        con.setUseCaches(false);
        con.setRequestProperty("Accept", "application/json");
        con.setRequestProperty("Cache-Control", "no-cache");
        try {
            int code = con.getResponseCode();
            if (code != 200) throw new IllegalStateException("Сервер обновлений ответил " + code);
            String body;
            try (InputStream in = con.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n, total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_MANIFEST_BYTES) throw new IllegalStateException("Манифест слишком большой");
                    out.write(buf, 0, n);
                }
                body = out.toString(StandardCharsets.UTF_8.name());
            }
            return parse(body, manifestUrl);
        } finally {
            con.disconnect();
        }
    }

    public static Manifest parse(String body, String manifestUrl) throws Exception {
        JSONObject o = new JSONObject(body);
        Manifest m = new Manifest();
        m.manifestUrl = manifestUrl;
        m.versionCode = o.getInt("versionCode");
        m.versionName = o.getString("versionName");
        m.apkUrl = o.getString("apkUrl");
        m.sha256 = o.optString("sha256", null);
        m.size = o.optLong("size", 0);
        m.publishedAt = o.optString("publishedAt", null);
        JSONArray ch = o.optJSONArray("changes");
        if (ch == null || ch.length() == 0) throw new IllegalArgumentException("В манифесте нет списка изменений");
        for (int i = 0; i < ch.length() && i < 20; i++) m.changes.add(ch.getString(i));
        if (m.versionCode <= 0 || m.versionName.isEmpty()) throw new IllegalArgumentException("Неверная версия в манифесте");
        if (m.sha256 != null && !m.sha256.matches("^[0-9a-fA-F]{64}$")) throw new IllegalArgumentException("Неверная контрольная сумма sha256");
        String manifestHost = Uri.parse(manifestUrl).getHost();
        if (!isAllowedUrl(m.apkUrl, manifestHost)) throw new SecurityException("Ссылка на APK не из доверенного источника");
        return m;
    }

    public static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Обновления Parkly", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Сообщает о новой версии приложения");
            c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    public static boolean notificationsEnabled(Context c) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (!nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
            if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    /**
     * Есть новая версия: показать системное уведомление один раз для этого versionCode.
     * Если уведомления выключены — запомнить, чтобы приложение показало обновление при следующем запуске.
     * @return "current" | "shown" | "already" | "disabled"
     */
    public static String handle(Context c, Manifest m, String source) {
        SharedPreferences p = prefs(c);
        p.edit().putLong(K_LAST_CHECK, System.currentTimeMillis()).putString(K_LAST_SOURCE, source).apply();
        if (m.versionCode <= installedCode(c)) {
            p.edit().putString(K_LAST_RESULT, "current").remove(K_PENDING).apply();
            return "current";
        }
        if (p.getInt(K_NOTIFIED, 0) >= m.versionCode) {
            p.edit().putString(K_LAST_RESULT, "already").apply();
            return "already";
        }
        ensureChannel(c);
        if (!notificationsEnabled(c)) {
            p.edit().putInt(K_PENDING, m.versionCode).putString(K_LAST_RESULT, "disabled").apply();
            return "disabled";
        }
        Intent open = new Intent(c, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN, m.versionCode);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(c, m.versionCode, open, flags);
        String text = m.changes.isEmpty() ? "Нажмите, чтобы посмотреть изменения" : m.changes.get(0);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_update)
            .setContentTitle("Вышла Parkly " + m.versionName)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(android.text.TextUtils.join("\n• ", prepend(m.changes))))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            p.edit().putInt(K_PENDING, m.versionCode).putString(K_LAST_RESULT, "disabled").apply();
            return "disabled";
        }
        p.edit().putInt(K_NOTIFIED, m.versionCode).remove(K_PENDING).putString(K_LAST_RESULT, "shown").apply();
        return "shown";
    }

    private static List<String> prepend(List<String> changes) {
        List<String> l = new ArrayList<>();
        l.add("Что нового:");
        l.addAll(changes);
        return l;
    }
}
