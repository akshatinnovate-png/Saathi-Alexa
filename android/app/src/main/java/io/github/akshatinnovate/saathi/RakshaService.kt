package io.github.akshatinnovate.saathi

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.concurrent.Executors

class RakshaService : Service(), SensorEventListener {

    private val detector = FallDetector()
    private val main = Handler(Looper.getMainLooper())
    private val network = Executors.newSingleThreadExecutor()
    private var sensors: SensorManager? = null
    private var watching = false
    private var stillness = false
    private var stillHours = 3
    private var fromMinute = 8 * 60
    private var toMinute = 20 * 60
    private var stillReportedAt = -1L
    private var lastFall = 0L

    private val tick = object : Runnable {
        override fun run() {
            checkStillness()
            main.postDelayed(this, TICK_MILLIS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannels()
        startWatchingNotice()
        if (intent?.action == ACTION_FINE) {
            notifications().cancel(ASK_ID)
            val id = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_CHECK, null)
            if (id != null) post("/api/raksha/$id/answer", JSONObject().put("fine", true)) {}
        }
        if (!watching) {
            watching = true
            loadSettings()
        }
        return START_STICKY
    }

    private fun origin(): String? =
        getSharedPreferences(MAIN_PREFS, MODE_PRIVATE).getString(KEY_START, null)?.let { SaathiAddress.from(it)?.origin }

    private fun notifications(): NotificationManager = getSystemService(NotificationManager::class.java)

    private fun createChannels() {
        notifications().createNotificationChannel(NotificationChannel(CHANNEL_WATCH, getString(R.string.raksha_watch_channel), NotificationManager.IMPORTANCE_MIN))
        notifications().createNotificationChannel(
            NotificationChannel(CHANNEL_ASK, getString(R.string.raksha_ask_channel), NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) },
        )
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_RAKSHA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun startWatchingNotice() {
        val notice = Notification.Builder(this, CHANNEL_WATCH)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(getString(R.string.raksha_watching))
            .setContentIntent(openApp())
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(WATCH_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
            } else {
                startForeground(WATCH_ID, notice)
            }
        } catch (_: Exception) {
            stopSelf()
        }
    }

    private fun loadSettings() {
        val base = origin() ?: return stopSelf()
        network.execute {
            val settings = try {
                request("$base/api/raksha", "GET", null)?.optJSONObject("settings")
            } catch (_: Exception) {
                null
            }
            main.post {
                if (settings == null || !settings.optBoolean("enabled")) {
                    stopSelf()
                } else {
                    stillness = settings.optBoolean("stillness")
                    stillHours = settings.optInt("stillHours", 3).coerceIn(1, 8)
                    fromMinute = minutes(settings.optString("from"), 8 * 60)
                    toMinute = minutes(settings.optString("to"), 20 * 60)
                    listen()
                }
            }
        }
    }

    private fun minutes(text: String, fallback: Int): Int {
        val parts = text.split(":")
        if (parts.size != 2) return fallback
        val h = parts[0].toIntOrNull() ?: return fallback
        val m = parts[1].toIntOrNull() ?: return fallback
        return if (h in 0..23 && m in 0..59) h * 60 + m else fallback
    }

    private fun listen() {
        if (sensors != null) return
        val manager = getSystemService(SensorManager::class.java) ?: return stopSelf()
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return stopSelf()
        manager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME, main)
        sensors = manager
        main.removeCallbacks(tick)
        main.postDelayed(tick, TICK_MILLIS)
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.elapsedRealtime()
        if (detector.feed(event.values[0], event.values[1], event.values[2], now) && now - lastFall > FALL_GAP_MILLIS) {
            lastFall = now
            report("fall")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun checkStillness() {
        if (!stillness) return
        val calendar = Calendar.getInstance()
        val minute = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
        if (minute !in fromMinute until toMinute) return
        val moved = detector.lastMovement
        if (moved == 0L || stillReportedAt == moved) return
        if (SystemClock.elapsedRealtime() - moved >= stillHours * HOUR_MILLIS) {
            stillReportedAt = moved
            report("still")
        }
    }

    private fun report(kind: String) {
        post("/api/raksha/check", JSONObject().put("kind", kind).put("source", "android")) { out ->
            val id = out?.optString("id")?.takeIf { it.startsWith("raksha-") } ?: return@post
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_CHECK, id).apply()
            ask()
        }
    }

    private fun ask() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val fine = PendingIntent.getService(
            this,
            1,
            Intent(this, RakshaService::class.java).setAction(ACTION_FINE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notice = Notification.Builder(this, CHANNEL_ASK)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(getString(R.string.raksha_ask_title))
            .setContentText(getString(R.string.raksha_ask_text))
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, getString(R.string.raksha_fine), fine).build())
            .build()
        notifications().notify(ASK_ID, notice)
        try {
            startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_RAKSHA).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
    }

    private fun post(path: String, body: JSONObject, done: (JSONObject?) -> Unit) {
        val base = origin() ?: return
        network.execute {
            val out = try {
                request("$base$path", "POST", body)
            } catch (_: Exception) {
                null
            }
            main.post { done(out) }
        }
    }

    private fun request(url: String, method: String, body: JSONObject?): JSONObject? {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MILLIS
            connection.readTimeout = TIMEOUT_MILLIS
            connection.instanceFollowRedirects = false
            CookieManager.getInstance().getCookie(url)?.let { connection.setRequestProperty("Cookie", it) }
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            if (connection.responseCode !in 200..299) return null
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    override fun onDestroy() {
        main.removeCallbacks(tick)
        sensors?.unregisterListener(this)
        sensors = null
        watching = false
        network.shutdown()
        super.onDestroy()
    }

    companion object {
        const val ACTION_FINE = "io.github.akshatinnovate.saathi.RAKSHA_FINE"
        const val MAIN_PREFS = "saathi"
        const val KEY_START = "start"
        private const val PREFS = "raksha"
        private const val KEY_CHECK = "check"
        private const val CHANNEL_WATCH = "raksha-watch"
        private const val CHANNEL_ASK = "raksha-ask"
        private const val WATCH_ID = 41
        private const val ASK_ID = 42
        private const val TICK_MILLIS = 60_000L
        private const val HOUR_MILLIS = 3_600_000L
        private const val FALL_GAP_MILLIS = 60_000L
        private const val TIMEOUT_MILLIS = 15_000

        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, RakshaService::class.java))
            } catch (_: Exception) {
            }
        }
    }
}
