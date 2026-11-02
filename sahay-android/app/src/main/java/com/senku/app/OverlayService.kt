package com.senku.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.graphics.Color
import kotlin.math.hypot

/** Owns the Android system overlay; the app's voice agent can send explicit state intents. */
class OverlayService : Service() {
    private lateinit var windows: WindowManager
    private var params: WindowManager.LayoutParams? = null
    private var pet: CompanionView? = null
    private var frame: FrameLayout? = null
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false
    private var voiceActive = false
    private var monthlyLimitReached = false
    private lateinit var circle: CircleOverlay

    override fun onCreate() {
        super.onCreate()
        windows = getSystemService(WINDOW_SERVICE) as WindowManager
        circle = CircleOverlay(this)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, "Floating companion", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_SHOW
        if (action == ACTION_HIDE) {
            getSharedPreferences("companion", MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
            stopSelf()
            return START_NOT_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(1, notification())
        if (action == ACTION_VOICE_ACTIVE) voiceActive = true
        if (action == ACTION_VOICE_INACTIVE) voiceActive = false
        if (pet == null && !voiceActive && action != ACTION_DRAW_CIRCLE) show()
        when (action) {
            ACTION_DRAW_CIRCLE -> circle.show {
                if (!getSharedPreferences("companion", MODE_PRIVATE).getBoolean("enabled", false)) stopSelf()
            }
            ACTION_VOICE_ACTIVE -> { frame?.let { windows.removeView(it) }; frame = null; pet = null }
            ACTION_VOICE_INACTIVE -> if (pet == null) show()
            ACTION_STATE -> pet?.setMode(intent?.getStringExtra(EXTRA_STATE))
            ACTION_THEME -> {
                val theme = intent?.getStringExtra(EXTRA_THEME)
                pet?.setTheme(theme)
                if (theme in setOf("seaglass", "blue", "pink", "red"))
                    getSharedPreferences("companion", MODE_PRIVATE).edit().putString("theme", theme).apply()
            }
            ACTION_EMOTION -> pet?.setEmotion(intent?.getStringExtra(EXTRA_EMOTION))
            ACTION_FACE -> pet?.setFace(intent?.getStringExtra(EXTRA_EYES), intent?.getStringExtra(EXTRA_MOUTH))
        }
        intent?.getStringExtra(EXTRA_CONNECTION_LABEL)?.let {
            monthlyLimitReached = it == UsageLimitNotice.LABEL
            pet?.setConnectionLabel(it)
        }
        return START_STICKY
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_HIDE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Companion is on your screen")
            .setContentText("Tap to manage the companion")
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hide", stop)
            .setOngoing(true)
            .build()
    }

    private fun show() {
        val view = CompanionView(this).apply {
            setTheme(getSharedPreferences("companion", MODE_PRIVATE).getString("theme", "seaglass"))
            setEmotion("normal")
        }
        val display = resources.displayMetrics
        val size = (88 * display.density).toInt()
        val closeSize = (24 * display.density).toInt()
        val width = size + closeSize
        val container = FrameLayout(this).apply {
            addView(view, FrameLayout.LayoutParams(size, size))
            addView(orbControl(this@OverlayService, false, getSharedPreferences("companion", MODE_PRIVATE).getString("theme", "seaglass")) {
                startService(Intent(this@OverlayService, OverlayService::class.java).setAction(ACTION_HIDE))
            }, FrameLayout.LayoutParams(closeSize, closeSize, Gravity.TOP or Gravity.RIGHT))
        }
        val layout = WindowManager.LayoutParams(width, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = getSharedPreferences("companion", MODE_PRIVATE).getInt("orb_x", display.widthPixels - width)
            y = getSharedPreferences("companion", MODE_PRIVATE).getInt("orb_y", display.heightPixels - size - (120 * display.density).toInt())
        }
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX; downY = event.rawY
                    startX = layout.x; startY = layout.y; moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downX).toInt()
                    val dy = (event.rawY - downY).toInt()
                    if (hypot(dx.toDouble(), dy.toDouble()) > 8) moved = true
                    if (moved) {
                        layout.x = startX + dx; layout.y = startY + dy
                        windows.updateViewLayout(container, layout)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) {
                        layout.x = if (layout.x < (display.widthPixels - width) / 2) 0 else display.widthPixels - width
                        layout.y = layout.y.coerceIn(45, (display.heightPixels - size - 80).coerceAtLeast(45))
                        windows.updateViewLayout(container, layout)
                        getSharedPreferences("companion", MODE_PRIVATE).edit()
                            .putInt("orb_x", layout.x).putInt("orb_y", layout.y).apply()
                    } else {
                        if (monthlyLimitReached) {
                            UsageLimitNotice.openApp(this@OverlayService)
                        } else startActivity(Intent(this@OverlayService, VoiceActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION))
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> false
                else -> false
            }
        }
        windows.addView(container, layout)
        frame = container
        pet = view
        params = layout
    }

    override fun onDestroy() {
        circle.close()
        frame?.let { windows.removeView(it) }
        frame = null
        pet = null
        params = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "companion"
        const val ACTION_SHOW = "com.senku.app.SHOW"
        const val ACTION_VOICE_ACTIVE = "com.senku.app.VOICE_ACTIVE"
        const val ACTION_VOICE_INACTIVE = "com.senku.app.VOICE_INACTIVE"
        const val ACTION_HIDE = "com.senku.app.HIDE"
        const val ACTION_STATE = "com.senku.app.STATE"
        const val ACTION_THEME = "com.senku.app.THEME"
        const val ACTION_EMOTION = "com.senku.app.EMOTION"
        const val ACTION_FACE = "com.senku.app.FACE"
        const val ACTION_DRAW_CIRCLE = "com.senku.app.DRAW_CIRCLE"
        const val EXTRA_CONNECTION_LABEL = "com.senku.app.CONNECTION_LABEL"
        const val EXTRA_STATE = "state"
        const val EXTRA_THEME = "theme"
        const val EXTRA_EMOTION = "emotion"
        const val EXTRA_EYES = "eyes"
        const val EXTRA_MOUTH = "mouth"
    }
}
