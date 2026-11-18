package kz.parkly.demo.updates;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kz.parkly.demo.BuildConfig;

@CapacitorPlugin(name = "ParklyUpdates", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class UpdatesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean openedFromNotification = false;

    @Override
    public void load() {
        UpdateCore.ensureChannel(getContext());
        Intent i = getActivity().getIntent();
        if (i != null && i.hasExtra(UpdateCore.EXTRA_OPEN)) openedFromNotification = true;
        SharedPreferences p = UpdateCore.prefs(getContext());
        if (!p.contains(UpdateCore.K_URL)) p.edit().putString(UpdateCore.K_URL, BuildConfig.MANIFEST_URL).apply();
        UpdateCheckWorker.schedulePeriodic(getContext());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.hasExtra(UpdateCore.EXTRA_OPEN)) {
            JSObject o = new JSObject();
            o.put("versionCode", intent.getIntExtra(UpdateCore.EXTRA_OPEN, 0));
            notifyListeners("openUpdate", o, true);
        }
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        Context c = getContext();
        SharedPreferences p = UpdateCore.prefs(c);
        JSObject o = new JSObject();
        o.put("platform", "android");
        o.put("versionCode", UpdateCore.installedCode(c));
        o.put("versionName", UpdateCore.installedName(c));
        o.put("debug", BuildConfig.DEBUG);
        o.put("configuredUrl", BuildConfig.MANIFEST_URL);
        o.put("manifestUrl", p.getString(UpdateCore.K_URL, BuildConfig.MANIFEST_URL));
        o.put("trustedHosts", BuildConfig.TRUSTED_HOSTS);
        o.put("testServerPort", BuildConfig.TEST_SERVER_PORT);
        o.put("notificationsEnabled", UpdateCore.notificationsEnabled(c));
        o.put("notifiedCode", p.getInt(UpdateCore.K_NOTIFIED, 0));
        o.put("lastCheck", p.getLong(UpdateCore.K_LAST_CHECK, 0));
        o.put("lastResult", p.getString(UpdateCore.K_LAST_RESULT, ""));
        o.put("lastSource", p.getString(UpdateCore.K_LAST_SOURCE, ""));
        call.resolve(o);
    }

    /** Адрес манифеста (из настроек сборки или тестовый канал) — его же читает фоновый воркер. */
    @PluginMethod
    public void configure(PluginCall call) {
        String url = call.getString("manifestUrl", BuildConfig.MANIFEST_URL);
        UpdateCore.prefs(getContext()).edit().putString(UpdateCore.K_URL, url).apply();
        UpdateCheckWorker.schedulePeriodic(getContext());
        call.resolve();
    }

    /** Проверка сейчас (при запуске или по кнопке): тот же код, что у воркера. */
    @PluginMethod
    public void check(PluginCall call) {
        final String url = UpdateCore.prefs(getContext()).getString(UpdateCore.K_URL, BuildConfig.MANIFEST_URL);
        final boolean notify = Boolean.TRUE.equals(call.getBoolean("notify", true));
        io.execute(() -> {
            JSObject o = new JSObject();
            o.put("installedCode", UpdateCore.installedCode(getContext()));
            try {
                UpdateCore.Manifest m = UpdateCore.fetch(url);
                o.put("manifest", JSObject.fromJSONObject(m.toJson()));
                o.put("result", notify ? UpdateCore.handle(getContext(), m, "app")
                    : (m.versionCode > UpdateCore.installedCode(getContext()) ? "update" : "current"));
                o.put("status", m.versionCode > UpdateCore.installedCode(getContext()) ? "update" : "current");
            } catch (IllegalStateException e) {
                o.put("status", "not-configured".equals(e.getMessage()) ? "not-configured" : "error");
                o.put("error", e.getMessage());
            } catch (java.io.IOException e) {
                o.put("status", "offline");
                o.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (Exception e) {
                o.put("status", "error");
                o.put("error", e.getMessage());
            }
            call.resolve(o);
        });
    }

    /** Отметка «уже показали» сбрасывает только этот метод — для повторной демонстрации. */
    @PluginMethod
    public void resetNotified(PluginCall call) {
        UpdateCore.prefs(getContext()).edit().remove(UpdateCore.K_NOTIFIED).remove(UpdateCore.K_PENDING).apply();
        call.resolve();
    }

    @PluginMethod
    public void runWorkerNow(PluginCall call) {
        UpdateCheckWorker.runNow(getContext());
        call.resolve();
    }

    /** Отложенное обновление (воркер нашёл, но уведомления выключены) и открытие из уведомления. */
    @PluginMethod
    public void takePending(PluginCall call) {
        SharedPreferences p = UpdateCore.prefs(getContext());
        JSObject o = new JSObject();
        o.put("pendingCode", p.getInt(UpdateCore.K_PENDING, 0));
        o.put("openedFromNotification", openedFromNotification);
        openedFromNotification = false;
        p.edit().remove(UpdateCore.K_PENDING).apply();
        call.resolve(o);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            notifState(call);
        } else {
            requestPermissionForAlias("notifications", call, "notifPermCallback");
        }
    }

    @PermissionCallback
    private void notifPermCallback(PluginCall call) {
        notifState(call);
    }

    private void notifState(PluginCall call) {
        JSObject o = new JSObject();
        o.put("notificationsEnabled", UpdateCore.notificationsEnabled(getContext()));
        call.resolve(o);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /**
     * Скачивает APK из доверенного источника, сверяет sha256 и открывает стандартный установщик Android.
     * Установку подтверждает пользователь в системном окне.
     */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("apkUrl");
        final String sha = call.getString("sha256");
        final String manifestUrl = call.getString("manifestUrl", "");
        final String name = call.getString("versionName", "new");
        if (url == null || !UpdateCore.isAllowedUrl(url, Uri.parse(manifestUrl).getHost())) {
            call.reject("Ссылка на APK не из доверенного источника");
            return;
        }
        io.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Нет доступа к памяти");
                File out = new File(dir, "Parkly-" + name.replaceAll("[^0-9A-Za-z.]", "") + ".apk");
                HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(10000);
                con.setReadTimeout(20000);
                con.setInstanceFollowRedirects(true);
                int code = con.getResponseCode();
                if (code != 200) throw new IllegalStateException("Сервер вернул " + code);
                long total = con.getContentLengthLong();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = con.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0, lastEmit = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        done += n;
                        if (done - lastEmit > 256 * 1024) {
                            lastEmit = done;
                            JSObject pr = new JSObject();
                            pr.put("done", done);
                            pr.put("total", total);
                            notifyListeners("downloadProgress", pr);
                        }
                    }
                } finally {
                    con.disconnect();
                }
                String got = hex(md.digest());
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(got)) {
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    throw new SecurityException("Контрольная сумма APK не совпала — файл удалён");
                }
                JSObject o = new JSObject();
                o.put("sha256", got);
                o.put("bytes", out.length());
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(s);
                    o.put("status", "needs-permission");
                    call.resolve(o);
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);
                o.put("status", "installer");
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        });
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
