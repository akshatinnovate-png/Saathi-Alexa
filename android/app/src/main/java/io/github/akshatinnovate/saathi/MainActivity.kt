package io.github.akshatinnovate.saathi

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ComponentName
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import io.github.akshatinnovate.saathi.shield.SaathiApi
import io.github.akshatinnovate.saathi.shield.ScamShieldService
import io.github.akshatinnovate.saathi.shield.ShieldConfig
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private lateinit var prefs: SharedPreferences
    private var web: WebView? = null
    private var address: SaathiAddress? = null
    private var pendingRequest: PermissionRequest? = null
    private var pendingResources: List<String> = emptyList()
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        val start = savedStart()
        when {
            intent?.action == ACTION_CHANGE_ADDRESS || start == null -> showSetup(null)
            else -> openSaathi(start, savedInstanceState)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_CHANGE_ADDRESS) showSetup(null)
        if (intent.action == ACTION_RAKSHA) web?.reload()
    }

    private fun savedStart(): String? = prefs.getString(KEY_START, null)?.let { SaathiAddress.startPage(it) }

    private fun dp(value: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun screen(vararg views: View): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(48), dp(28), dp(28))
        }
        views.forEach { view ->
            column.addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
        }
        return ScrollView(this).apply {
            setBackgroundColor(getColor(R.color.paper))
            isFillViewport = true
            addView(column)
        }
    }

    private fun text(resId: Int, size: Float, bold: Boolean = false): TextView = TextView(this).apply {
        setText(resId)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(getColor(R.color.ink))
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun button(resId: Int, primary: Boolean, onClick: () -> Unit): Button = Button(this).apply {
        setText(resId)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        isAllCaps = false
        minHeight = dp(56)
        if (primary) {
            setBackgroundColor(getColor(R.color.ink))
            setTextColor(getColor(R.color.paper))
        }
        setOnClickListener { onClick() }
    }

    private fun closeWeb() {
        web?.let {
            it.stopLoading()
            it.destroy()
        }
        web = null
    }

    private fun showSetup(errorRes: Int?) {
        closeWeb()
        val field = EditText(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setHint(R.string.address_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_GO
            setSingleLine(true)
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            setText(address?.origin ?: prefs.getString(KEY_START, null)?.let { SaathiAddress.from(it)?.origin } ?: "")
            contentDescription = getString(R.string.address_label)
        }
        val error = text(errorRes ?: R.string.address_invalid, 16f).apply {
            setTextColor(Color.rgb(0xA3, 0x2D, 0x2D))
            visibility = if (errorRes == null) View.GONE else View.VISIBLE
        }
        val connect = {
            val start = SaathiAddress.startPage(field.text.toString())
            if (start == null) {
                error.setText(R.string.address_invalid)
                error.visibility = View.VISIBLE
            } else {
                val previous = prefs.getString(KEY_START, null)?.let { SaathiAddress.from(it) }
                val next = SaathiAddress.from(start)
                if (previous != null && previous != next) {
                    CookieManager.getInstance().removeAllCookies(null)
                    WebStorage.getInstance().deleteAllData()
                }
                prefs.edit().putString(KEY_START, start).apply()
                openSaathi(start, null)
            }
        }
        field.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) {
                connect()
                true
            } else {
                false
            }
        }
        setContentView(
            screen(
                text(R.string.setup_title, 30f, bold = true),
                text(R.string.setup_hint, 18f),
                field,
                error,
                button(R.string.connect, primary = true) { connect() },
                text(R.string.setup_private, 14f),
            ),
        )
    }

    private fun showProblem(messageRes: Int) {
        closeWeb()
        setContentView(
            screen(
                text(R.string.problem_title, 28f, bold = true),
                text(messageRes, 18f),
                button(R.string.try_again, primary = true) { savedStart()?.let { openSaathi(it, null) } ?: showSetup(null) },
                button(R.string.change_address, primary = false) { showSetup(null) },
            ),
        )
    }

    private fun openOutside(uri: Uri) {
        val intent = when (uri.scheme?.lowercase()) {
            "https", "http" -> Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
            "tel" -> Intent(Intent.ACTION_DIAL, uri)
            "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
            else -> return
        }
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
        }
    }

    private fun openSaathi(start: String, saved: Bundle?) {
        val home = SaathiAddress.from(start) ?: return showSetup(R.string.address_invalid)
        closeWeb()
        address = home
        val view = WebView(this)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            userAgentString = "$userAgentString SaathiAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, false)
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (home.owns(request.url.toString())) return false
                openOutside(request.url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (url != null && home.owns(url)) {
                    val path = Uri.parse(url).path
                    if (path == "/alexa.html" || path == "/family.html") prefs.edit().putString(KEY_START, home.page(path)).apply()
                    if (path == "/alexa.html") startRaksha()
                }
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                showProblem(R.string.problem_certificate)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showProblem(R.string.problem_offline)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (web === view) web = null
                view.destroy()
                savedStart()?.let { openSaathi(it, null) } ?: showSetup(null)
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { decide(request, home) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingRequest === request) pendingRequest = null
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!home.owns(view.url)) return false
                pendingFiles?.onReceiveValue(null)
                pendingFiles = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params.createIntent(), REQUEST_FILES)
                    true
                } catch (_: ActivityNotFoundException) {
                    pendingFiles = null
                    false
                }
            }
        }
        web = view
        setContentView(view)
        if (saved == null || view.restoreState(saved) == null) view.loadUrl(start)
    }

    private var rakshaStarted = false

    private fun startRaksha() {
        if (rakshaStarted) return
        rakshaStarted = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFY)
        }
        RakshaService.start(this)
        offerShield()
    }

    private fun shieldGranted(): Boolean {
        val component = ComponentName(this, ScamShieldService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            return getSystemService(NotificationManager::class.java)?.isNotificationListenerAccessGranted(component) == true
        }
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }

    private fun offerShield() {
        if (shieldGranted()) return
        val now = System.currentTimeMillis()
        if (now - prefs.getLong(KEY_SHIELD_ASKED, 0L) < SHIELD_ASK_GAP_MILLIS) return
        Executors.newSingleThreadExecutor().execute {
            val config = try {
                ShieldConfig.parse(SaathiApi.call(applicationContext, "/api/scam-shield", "GET", null))
            } catch (_: Exception) {
                null
            }
            if (config?.enabled != true) return@execute
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                prefs.edit().putLong(KEY_SHIELD_ASKED, now).apply()
                AlertDialog.Builder(this)
                    .setTitle(R.string.shield_ask_title)
                    .setMessage(R.string.shield_ask_text)
                    .setPositiveButton(R.string.shield_allow) { _, _ ->
                        try {
                            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        } catch (_: ActivityNotFoundException) {
                        }
                    }
                    .setNegativeButton(R.string.shield_not_now, null)
                    .show()
            }
        }
    }

    private fun decide(request: PermissionRequest, home: SaathiAddress) {
        if (!home.owns(request.origin.toString())) return request.deny()
        val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        if (wanted.isEmpty()) return request.deny()
        val missing = wanted.map(::androidPermission).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) return request.grant(wanted.toTypedArray())
        pendingRequest?.deny()
        pendingRequest = request
        pendingResources = wanted
        requestPermissions(missing.toTypedArray(), REQUEST_MEDIA)
    }

    private fun androidPermission(resource: String): String =
        if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_MEDIA) return
        val request = pendingRequest ?: return
        pendingRequest = null
        val allowed = pendingResources.filter { checkSelfPermission(androidPermission(it)) == PackageManager.PERMISSION_GRANTED }
        if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
    }

    @Deprecated("Activity result API is not available without AndroidX")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILES) return
        pendingFiles?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        pendingFiles = null
    }

    private fun goBack() {
        val view = web
        if (view != null && view.canGoBack()) view.goBack() else finish()
    }

    @Deprecated("Handled by OnBackInvokedDispatcher on Android 13 and later")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        goBack()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web?.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        pendingRequest?.deny()
        pendingFiles?.onReceiveValue(null)
        closeWeb()
        super.onDestroy()
    }

    companion object {
        const val ACTION_CHANGE_ADDRESS = "io.github.akshatinnovate.saathi.CHANGE_ADDRESS"
        const val ACTION_RAKSHA = "io.github.akshatinnovate.saathi.RAKSHA"
        private const val PREFS = "saathi"
        private const val KEY_START = "start"
        private const val REQUEST_MEDIA = 7
        private const val REQUEST_FILES = 8
        private const val REQUEST_NOTIFY = 9
        private const val KEY_SHIELD_ASKED = "shield_asked"
        private const val SHIELD_ASK_GAP_MILLIS = 24L * 60 * 60 * 1000
    }
}
