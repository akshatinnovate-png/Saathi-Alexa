package io.github.akshatinnovate.saathi.shield

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.SystemClock
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import io.github.akshatinnovate.saathi.MainActivity
import io.github.akshatinnovate.saathi.R
import java.util.Locale
import java.util.concurrent.Executors

class ScamShieldService : NotificationListenerService() {

    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var models: ModelStore
    private lateinit var gemma: GemmaScamClassifier
    private var config: ShieldConfig? = null
    private var configAt = 0L
    private val seen = LinkedHashMap<String, Long>()

    override fun onListenerConnected() {
        models = ModelStore(applicationContext)
        gemma = GemmaScamClassifier(applicationContext)
        worker.execute { refresh(force = true) }
    }

    override fun onListenerDisconnected() {
        if (::gemma.isInitialized) worker.execute { gemma.close() }
    }

    override fun onDestroy() {
        if (::gemma.isInitialized) worker.execute { gemma.close() }
        worker.shutdown()
        super.onDestroy()
    }

    private fun refresh(force: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - configAt < REFRESH_MILLIS) return
        configAt = now
        val fresh = try {
            ShieldConfig.parse(SaathiApi.call(applicationContext, "/api/scam-shield", "GET", null))
        } catch (_: Exception) {
            null
        }
        if (fresh != null) config = fresh
        val current = config ?: return
        if (!current.enabled) {
            gemma.close()
            return
        }
        val model = models.ready(current.modelSha256) ?: models.download(current)
        if (model != null && models.deviceCanRun()) gemma.load(model)
    }

    private fun channelOf(packageName: String): String? {
        if (packageName == "com.whatsapp" || packageName == "com.whatsapp.w4b") return "whatsapp"
        if (packageName in SMS_APPS) return "sms"
        val defaultSms = try {
            Telephony.Sms.getDefaultSmsPackage(applicationContext)
        } catch (_: Exception) {
            null
        }
        return if (packageName == defaultSms) "sms" else null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!::models.isInitialized) return
        val channel = channelOf(sbn.packageName) ?: return
        val notification = sbn.notification ?: return
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val extras = notification.extras ?: return
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
        if (text.length < MIN_CHARS) return
        val key = "${sbn.packageName}:${text.hashCode()}"
        synchronized(seen) {
            val now = SystemClock.elapsedRealtime()
            if (seen[key]?.let { now - it < DEDUPE_MILLIS } == true) return
            seen[key] = now
            while (seen.size > 200) seen.remove(seen.keys.first())
        }
        worker.execute { check(text, channel) }
    }

    private fun check(text: String, channel: String) {
        refresh(force = false)
        val current = config ?: return
        if (!current.enabled) return
        val rules = ScamRules.assess(text)
        if (rules.clean) return
        val gemmaVerdict = if (rules.strong) null else gemma.classify(text)
        val verdict = GemmaVerdict.decide(rules, gemmaVerdict) ?: return
        val engine = if (gemmaVerdict != null) "gemma" else "rules"
        warn(current.language, verdict.kind)
        val body = "{\"kind\":\"${verdict.kind}\",\"engine\":\"$engine\",\"channel\":\"$channel\",\"confidence\":${"%.2f".format(Locale.ROOT, verdict.confidence)}}"
        try {
            SaathiApi.call(applicationContext, "/api/scam-shield/report", "POST", body)
        } catch (_: Exception) {
        }
    }

    private fun localized(language: String): Context {
        val conf = Configuration(resources.configuration)
        conf.setLocale(Locale.forLanguageTag(language))
        return createConfigurationContext(conf)
    }

    private fun warn(language: String, kind: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val words = localized(language)
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, words.getString(R.string.shield_channel), NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) },
        )
        val open = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val detail = when (kind) {
            "otp" -> R.string.shield_otp
            "kyc" -> R.string.shield_kyc
            "digital-arrest" -> R.string.shield_arrest
            "prize", "investment", "job" -> R.string.shield_money
            "impersonation" -> R.string.shield_family
            else -> R.string.shield_other
        }
        val notice = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(words.getString(R.string.shield_title))
            .setContentText(words.getString(detail))
            .setStyle(Notification.BigTextStyle().bigText(words.getString(detail) + " " + words.getString(R.string.shield_family_told)))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(WARN_ID, notice)
    }

    companion object {
        private const val CHANNEL = "scam-shield"
        private const val WARN_ID = 51
        private const val MIN_CHARS = 12
        private const val DEDUPE_MILLIS = 10 * 60_000L
        private const val REFRESH_MILLIS = 6 * 60 * 60_000L
        private val SMS_APPS = setOf("com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging")
    }
}
