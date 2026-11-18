package kz.parkly.demo.updates;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

import kz.parkly.demo.BuildConfig;

/** Фоновая проверка обновлений через WorkManager (раз в CHECK_EVERY_HOURS, только при наличии сети). */
public class UpdateCheckWorker extends Worker {
    public static final String PERIODIC = "parkly-update-check";
    public static final String ONE_TIME = "parkly-update-check-now";
    private static final String TAG = "ParklyUpdates";

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        String url = UpdateCore.prefs(c).getString(UpdateCore.K_URL, BuildConfig.MANIFEST_URL);
        if (url == null || url.isEmpty()) {
            Log.i(TAG, "worker: адрес манифеста не настроен");
            UpdateCore.prefs(c).edit().putString(UpdateCore.K_LAST_RESULT, "not-configured").putLong(UpdateCore.K_LAST_CHECK, System.currentTimeMillis()).apply();
            return Result.success();
        }
        try {
            UpdateCore.Manifest m = UpdateCore.fetch(url);
            String r = UpdateCore.handle(c, m, "worker");
            Log.i(TAG, "worker: манифест " + m.versionCode + " (" + m.versionName + "), установлено " + UpdateCore.installedCode(c) + " → " + r);
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "worker: ошибка проверки: " + e.getMessage());
            UpdateCore.prefs(c).edit().putString(UpdateCore.K_LAST_RESULT, "error: " + e.getMessage())
                .putString(UpdateCore.K_LAST_SOURCE, "worker").putLong(UpdateCore.K_LAST_CHECK, System.currentTimeMillis()).apply();
            // сеть пропала посреди проверки — пусть WorkManager повторит позже с бэкоффом
            return e instanceof java.io.IOException ? Result.retry() : Result.success();
        }
    }

    public static void schedulePeriodic(Context c) {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UpdateCheckWorker.class, Math.max(1, BuildConfig.CHECK_EVERY_HOURS), TimeUnit.HOURS)
            .setConstraints(net).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    /** Разовый запуск того же воркера — для проверки фонового сценария на защите и в тестах. */
    public static void runNow(Context c) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class).build();
        WorkManager.getInstance(c).enqueueUniqueWork(ONE_TIME, ExistingWorkPolicy.REPLACE, req);
    }
}
