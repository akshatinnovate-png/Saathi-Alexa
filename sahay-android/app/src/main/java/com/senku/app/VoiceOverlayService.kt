package com.senku.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ResultReceiver
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import android.widget.TextView
import java.util.concurrent.FutureTask
import org.json.JSONObject
import com.senku.app.agent.AgentAccessibilityService
import com.senku.app.agent.AgentForegroundService
import com.senku.app.agent.AgentState
import com.senku.app.agent.AgentSettings

/** Keeps the WebRTC call and its orb in a system overlay after the app screen closes. */
class VoiceOverlayService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val pageUrl = "https://appassets.androidplatform.net/voice"
    private lateinit var windows: WindowManager
    private var frame: FrameLayout? = null
    private var web: WebView? = null
    private var orb: CompanionView? = null
    private var hasStarted = false
    private var loadFailed = false
    private var restoreCompanion = false
    private var provider = "gemini"
    private var providerOverride: String? = null
    private var textOnly = false
    private var initialText: String? = null
    private var initialPrompt: String? = null
    private var onboardingSession = false
    @Volatile private var geminiTokenTask: FutureTask<String>? = null
    private var geminiReady = false
    private var geminiAgentTools: GeminiAgentTools? = null
    private var geminiScreenCapture: GeminiScreenCapture? = null
    private var screenSelection: ScreenSelectionOverlay? = null
    private var selectionId: String? = null
    private var selectionGeneration = 0L
    private val fullCaptureGenerations = mutableMapOf<String, Long>()

    override fun onCreate() {
        super.onCreate()
        windows = getSystemService(WINDOW_SERVICE) as WindowManager
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, "Voice conversation", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == OverlayService.ACTION_THEME) {
            orb?.setTheme(intent.getStringExtra(OverlayService.EXTRA_THEME))
            if (frame == null) stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_SEND_LIVE_TEXT) {
            val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
            if (frame != null && text.isNotBlank()) web?.evaluateJavascript("window.sendLiveTextMessage(${JSONObject.quote(text)})", null)
            else stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_SEND_TEXT) {
            val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
            if (frame != null) web?.evaluateJavascript("window.sendTextMessage(${JSONObject.quote(text)})", null)
            else { initialText = text; textOnly = true }
            return START_NOT_STICKY
        }
        val ready = if (Build.VERSION.SDK_INT >= 33)
            intent?.getParcelableExtra(EXTRA_READY, ResultReceiver::class.java)
        else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_READY)
        if (intent?.action == ACTION_CLOSE) {
            restoreCompanion = false
            getSharedPreferences("companion", MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
            stopService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_HIDE))
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (frame != null) {
            intent?.getStringExtra(EXTRA_INITIAL_TEXT)?.let { text ->
                web?.evaluateJavascript("window.sendTextMessage(${JSONObject.quote(text)})", null)
            }
            ready?.send(0, Bundle())
            return START_NOT_STICKY
        }
        VoiceConnection.start()
        providerOverride = intent?.getStringExtra(EXTRA_PROVIDER_OVERRIDE)
        onboardingSession = intent?.getBooleanExtra(EXTRA_ONBOARDING_SESSION, false) == true
        textOnly = intent?.getBooleanExtra(EXTRA_TEXT_MODE, false) == true
        initialText = intent?.getStringExtra(EXTRA_INITIAL_TEXT)
        initialPrompt = intent?.getStringExtra(EXTRA_INITIAL_PROMPT)
        if (!Settings.canDrawOverlays(this) ||
            (!textOnly && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) {
            ready?.send(1, Bundle())
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val type = if (textOnly) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                startForeground(NOTIFICATION_ID, notification(), type)
            } else startForeground(NOTIFICATION_ID, notification())
            showVoiceOverlay()
            ready?.send(0, Bundle())
        } catch (error: Exception) {

            Toast.makeText(this, "Could not start floating voice", Toast.LENGTH_LONG).show()
            ready?.send(1, Bundle())
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val stop = PendingIntent.getService(this, 0,
            Intent(this, VoiceOverlayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(if (textOnly) "Sahay text chat" else "Sahay is listening")
            .setContentText("Tap the orb or this notification to end the conversation")
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End call", stop)
            .build()
    }

    private fun showVoiceOverlay() {
        val preferences = getSharedPreferences("companion", MODE_PRIVATE)
        provider = (providerOverride ?: preferences.getString("voice_provider", "gemini"))
            ?.takeIf { it == "gemini" || it == "livejev" } ?: "gemini"
        // Seed one greeting for each newly opened voice conversation, never text chat.
        // The voice page consumes this initial prompt once; reconnects do not queue it again.
        if (!textOnly && isGeminiLiveProvider() && initialPrompt.isNullOrBlank()) {
            initialPrompt = "The user has just woken Sahay for a new voice conversation. Speak first now with a brief, friendly English greeting: Hey, what’s up? Then wait for their answer. Do not introduce yourself, give permission instructions, or repeat this greeting later in this conversation. If the user is already asking for something, answer their request directly."
        }
        // Token minting does not depend on the WebView. Start it while the page and audio UI load.
        if (onboardingSession && isGeminiLiveProvider()) {
            FutureTask { SupabaseAuth(this).mintGeminiToken() }.also { task ->
                geminiTokenTask = task
                Thread(task, "senku-gemini-token").start()
            }
        }
        restoreCompanion = preferences.getBoolean("enabled", false)
        if (restoreCompanion) startService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_VOICE_ACTIVE))

        val size = (88 * resources.displayMetrics.density).toInt()
        val controlSize = (44 * resources.displayMetrics.density).toInt()
        val closeSize = (32 * resources.displayMetrics.density).toInt()
        val orbTop = (16 * resources.displayMetrics.density).toInt()
        val width = (112 * resources.displayMetrics.density).toInt()
        val height = size + orbTop
        val pet = CompanionView(this).apply {
            setTheme(preferences.getString("theme", "seaglass"))
            setMode("thinking")
            setConnectionLabel("Waking up…")
            contentDescription = "Voice companion. Tap to end conversation."
        }
        val browser = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            visibility = View.INVISIBLE
            settings.javaScriptEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(VoiceBridge(), "Sahay")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.toString() != pageUrl
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) failVoice("Could not load Sahay voice")
                }
                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                    if (request.isForMainFrame) failVoice("Sahay voice returned HTTP ${errorResponse.statusCode}")
                }
                override fun onPageFinished(view: WebView, url: String) {
                    if (!loadFailed && !hasStarted) {
                        view.visibility = View.VISIBLE
                        hasStarted = true
                        if (textOnly && isGeminiLiveProvider()) {
                            val text = initialText.also { initialText = null }
                            view.evaluateJavascript("window.startTextChat(${JSONObject.quote(text.orEmpty())})", null)
                        } else {
                            val prompt = initialPrompt.also { initialPrompt = null }
                            val start = if (prompt.isNullOrBlank()) "window.startVoice()"
                                else "window.startVoice(${JSONObject.quote(prompt)})"
                            view.evaluateJavascript(start, null)
                        }
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    main.post {
                        val trusted = request.origin.toString().trimEnd('/') == "https://appassets.androidplatform.net"
                        val granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                        val audio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                        if (!textOnly && trusted && granted && audio) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                        else request.deny()
                    }
                }
            }
        }
        val overlay = FrameLayout(this).apply {
            addView(pet, FrameLayout.LayoutParams(size, size).apply { topMargin = orbTop })
            addView(browser, FrameLayout.LayoutParams(size, size).apply { topMargin = orbTop })
            addView(orbControl(this@VoiceOverlayService, false, preferences.getString("theme", "seaglass")) {
                startService(Intent(this@VoiceOverlayService, VoiceOverlayService::class.java).setAction(ACTION_CLOSE))
            }, FrameLayout.LayoutParams(closeSize, closeSize, Gravity.TOP or Gravity.RIGHT))
            addView(orbControl(this@VoiceOverlayService, true, preferences.getString("theme", "seaglass")) {
                if (geminiReady) browser.evaluateJavascript("window.requestScreenSelection()", null)
                else Toast.makeText(this@VoiceOverlayService, "Wait for Sahay to connect", Toast.LENGTH_SHORT).show()
            }, FrameLayout.LayoutParams(controlSize, controlSize, Gravity.TOP or Gravity.RIGHT).apply { topMargin = closeSize })
        }
        val display = resources.displayMetrics
        val layout = WindowManager.LayoutParams(width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = (if (onboardingSession) display.widthPixels - width
                else preferences.getInt("orb_x", display.widthPixels - width))
                .coerceIn(0, (display.widthPixels - width).coerceAtLeast(0))
            y = (if (onboardingSession) (display.heightPixels * .40f).toInt()
                else preferences.getInt("orb_y", display.heightPixels - height - (120 * display.density).toInt()))
                .coerceIn(0, (display.heightPixels - height).coerceAtLeast(0))
        }
        val dragThreshold = ViewConfiguration.get(this).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        val touch = View.OnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = layout.x
                    startY = layout.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && kotlin.math.hypot(dx.toDouble(), dy.toDouble()) > dragThreshold) dragging = true
                    if (dragging) {
                        layout.x = (startX + dx.toInt()).coerceIn(0, (display.widthPixels - width).coerceAtLeast(0))
                        layout.y = (startY + dy.toInt()).coerceIn(0, (display.heightPixels - height).coerceAtLeast(0))
                        windows.updateViewLayout(overlay, layout)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) preferences.edit().putInt("orb_x", layout.x).putInt("orb_y", layout.y).apply()
                    else {
                        // A native tap also works while the voice connection is still starting.
                        restoreCompanion = true
                        preferences.edit().putBoolean("enabled", true).apply()
                        VoiceConnection.update("Disconnected")
                        pet.setMode("idle")
                        stopSelf()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> true
                else -> true
            }
        }
        pet.setOnTouchListener(touch)
        browser.setOnTouchListener(touch)
        windows.addView(overlay, layout)
        frame = overlay
        orb = pet
        web = browser
        val html = assets.open("gemini.html")
            .bufferedReader().use { it.readText() }
        browser.loadDataWithBaseURL(pageUrl, html, "text/html", "UTF-8", pageUrl)
    }

    private fun failVoice(message: String) {
        if (loadFailed) return
        loadFailed = true

        VoiceConnection.update("Failed: $message")
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        stopSelf()
    }

    override fun onDestroy() {
        geminiReady = false
        geminiTokenTask?.cancel(true)
        geminiTokenTask = null
        if (onboardingSession) getSharedPreferences("companion", MODE_PRIVATE).edit()
            .putBoolean("onboarding_live_active_v1", false).apply()
        selectionId = null
        fullCaptureGenerations.clear()
        screenSelection?.close()
        screenSelection = null
        geminiAgentTools?.close()
        geminiAgentTools = null
        geminiScreenCapture?.close()
        geminiScreenCapture = null
        web?.let {
            it.evaluateJavascript("window.stopVoice()", null)
            it.removeJavascriptInterface("Sahay")
            it.destroy()
        }
        frame?.let { windows.removeView(it) }
        frame = null
        web = null
        orb = null
        if (restoreCompanion && getSharedPreferences("companion", MODE_PRIVATE).getBoolean("enabled", false)) {
            val restore = Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_VOICE_INACTIVE)
            if (VoiceConnection.status.startsWith("Failed:"))
                restore.putExtra(OverlayService.EXTRA_CONNECTION_LABEL, if (UsageLimitNotice.isLimitError(VoiceConnection.status)) UsageLimitNotice.LABEL else "Try again?")
            startService(restore)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun screenCapture(): GeminiScreenCapture = geminiScreenCapture ?: GeminiScreenCapture { toolId, result ->
        val requestedGeneration = fullCaptureGenerations.remove(toolId)
        val response = if (selectionId != null || requestedGeneration != selectionGeneration)
            JSONObject().put("status", "cancelled").put("summary", "Full-screen capture cancelled because the user started selecting an area.")
        else result
        if (geminiReady) web?.evaluateJavascript(
            "window.receiveScreenCapture(${JSONObject.quote(toolId)}, $response)", null)
    }.also { geminiScreenCapture = it }

    private fun beginScreenSelection(id: String) {
        if (!isGeminiLiveProvider() || !geminiReady || id.isBlank() || id.length > 200) return
        if (selectionId != null) {
            web?.evaluateJavascript("window.receiveScreenSelection(${JSONObject.quote(id)}, " +
                "{status:'error',summary:'Finish or cancel the existing selection first.'})", null)
            return
        }
        selectionId = id
        selectionGeneration++
        frame?.alpha = 0f
        // Let the compositor remove Senku's orb before capturing the local screen snapshot.
        main.postDelayed({
            if (!geminiReady || selectionId != id) return@postDelayed
            screenCapture().captureBitmap { bitmap, failure ->
                if (!geminiReady || selectionId != id) { bitmap?.recycle(); return@captureBitmap }
                if (bitmap == null) {
                    selectionId = null
                    frame?.alpha = 1f
                    val result = JSONObject().put("status", "error").put("summary", failure ?: "Screen capture failed")
                    web?.evaluateJavascript("window.receiveScreenSelection(${JSONObject.quote(id)}, $result)", null)
                } else {
                    screenSelection = ScreenSelectionOverlay(this, bitmap, onDismiss = {
                        if (selectionId == id) {
                            selectionId = null
                            screenSelection = null
                            frame?.alpha = 1f
                        }
                    }) { result ->
                        frame?.alpha = 1f
                        if (geminiReady) web?.evaluateJavascript(
                            "window.receiveScreenSelection(${JSONObject.quote(id)}, $result)", null)
                    }.also { it.show() }
                }
            }
        }, 80)
    }

    private inner class VoiceBridge {
        @JavascriptInterface fun notice(message: String) = main.post {
            Toast.makeText(this@VoiceOverlayService, message.take(160), Toast.LENGTH_LONG).show()
        }
        @JavascriptInterface fun selectScreen(id: String) = main.post { beginScreenSelection(id) }
        @JavascriptInterface fun captureScreen(id: String) = main.post {
            if (!isGeminiLiveProvider() || !geminiReady || web == null) return@post
            if (selectionId != null) {
                web?.evaluateJavascript("window.receiveScreenCapture(${JSONObject.quote(id)}, " +
                    "{status:'error',summary:'Screen drawing is open. Finish or cancel it first.'})", null)
            } else {
                fullCaptureGenerations[id] = selectionGeneration
                screenCapture().capture(id)
            }
        }
        @JavascriptInterface fun agentTool(id: String, name: String, arguments: String) = main.post {
            if (!isGeminiLiveProvider() || !geminiReady || web == null) return@post
            val tools = geminiAgentTools ?: GeminiAgentTools(
                this@VoiceOverlayService,
                reply = { toolId, result ->
                    web?.evaluateJavascript("window.receiveAgentResult(${JSONObject.quote(toolId)}, $result)", null)
                },
                update = { toolId, result ->
                    web?.evaluateJavascript("window.receiveAgentUpdate(${JSONObject.quote(toolId)}, $result)", null)
                },
                progress = { toolId, result ->
                    web?.evaluateJavascript("window.receiveAgentProgress(${JSONObject.quote(toolId)}, $result)", null)
                },
                notice = { toolId, result ->
                    web?.evaluateJavascript("window.receiveAgentNotice(${JSONObject.quote(toolId)}, $result)", null)
                },
            ).also { geminiAgentTools = it }
            tools.handle(id, name, arguments)
        }
        @JavascriptInterface fun liveJevMode(): Boolean = provider == "livejev"
        @JavascriptInterface fun isOnboardingSession(): Boolean = onboardingSession
        @JavascriptInterface fun chatResponse(message: String) = ChatTranscript.add("Gemini", message)
        @JavascriptInterface fun cancelAgentTool(id: String) = main.post {
            geminiAgentTools?.cancel(id)
            fullCaptureGenerations.remove(id)
            if (selectionId == id) {
                selectionId = null
                screenSelection?.close()
                screenSelection = null
                frame?.alpha = 1f
            }
        }
        @JavascriptInterface fun requestGeminiToken(id: String) {
            if (!isGeminiLiveProvider() || id.isBlank() || id.length > 200) return
            Thread {
                try {
                    val body = geminiTokenTask?.get() ?: SupabaseAuth(this@VoiceOverlayService).mintGeminiToken()
                    main.post { web?.evaluateJavascript(
                        "window.receiveGeminiToken(${JSONObject.quote(id)}, ${JSONObject.quote(body)}, null)", null) }
                } catch (error: Exception) {
                    if (UsageLimitNotice.isLimitError(error.message)) UsageLimitNotice.notify(this@VoiceOverlayService, "voice_sessions")
                    main.post { web?.evaluateJavascript(
                        "window.receiveGeminiToken(${JSONObject.quote(id)}, null, ${JSONObject.quote(error.message ?: "Could not start Gemini Live")})", null) }
                }
            }.start()
        }
        @JavascriptInterface fun drawCircle(): String {
            if (!isGeminiLiveProvider() || !geminiReady) return "Gemini Live is not active"
            main.post {
                startForegroundService(Intent(this@VoiceOverlayService, OverlayService::class.java)
                    .setAction(OverlayService.ACTION_DRAW_CIRCLE))
            }
            return "Circle requested on phone"
        }
        @JavascriptInterface fun connection(value: String) = main.post {
            VoiceConnection.update(value)
            orb?.setConnectionLabel(when {
                value.startsWith("Speaking") -> null
                value.startsWith("Connected") -> "I'm awake!"
                value.startsWith("Requesting") || value.startsWith("Starting") || value.startsWith("Connecting") -> "Waking up…"
                value.startsWith("Preparing") -> "A little groggy…"
                value.startsWith("Failed:") -> if (UsageLimitNotice.isLimitError(value)) UsageLimitNotice.LABEL else "Try again?"
                value == "Disconnected" -> "Goodnight"
                else -> null
            })
        }
        @JavascriptInterface fun emotion(value: String) = main.post {
            orb?.setEmotion(value)
        }
        @JavascriptInterface fun state(value: String) = main.post {
            orb?.setMode(value)
        }
        @JavascriptInterface fun callStarted() = main.post {
            if (isGeminiLiveProvider()) geminiReady = true
            if (onboardingSession) getSharedPreferences("companion", MODE_PRIVATE).edit()
                .putBoolean("onboarding_live_active_v1", true).apply()
        }
        @JavascriptInterface fun ended() = main.post {
            if (!VoiceConnection.status.startsWith("Failed:")) VoiceConnection.update("Disconnected")
            stopSelf()
        }
        @JavascriptInterface fun error(message: String) = main.post {
            VoiceConnection.update("Failed: $message")

            orb?.setMode("idle")
            Toast.makeText(this@VoiceOverlayService, message.take(120), Toast.LENGTH_LONG).show()
            stopSelf()
        }
    }

    companion object {
        private const val CHANNEL = "senku_voice"
        private const val NOTIFICATION_ID = 2
        const val ACTION_STOP = "com.senku.app.STOP_VOICE"
        const val ACTION_CLOSE = "com.senku.app.CLOSE_VOICE"
        const val ACTION_SEND_TEXT = "com.senku.app.SEND_TEXT"
        const val ACTION_SEND_LIVE_TEXT = "com.senku.app.SEND_LIVE_TEXT"
        const val EXTRA_TEXT = "text"
        const val EXTRA_TEXT_MODE = "text_mode"
        const val EXTRA_INITIAL_TEXT = "initial_text"
        const val EXTRA_INITIAL_PROMPT = "initial_prompt"
        const val EXTRA_PROVIDER_OVERRIDE = "provider_override"
        const val EXTRA_ONBOARDING_SESSION = "onboarding_session"
        const val EXTRA_READY = "ready"
    }

    private fun isGeminiLiveProvider() = provider == "gemini" || provider == "livejev"
}
