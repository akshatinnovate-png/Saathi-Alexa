package com.senku.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.result.contract.ActivityResultContracts
import android.widget.Toast
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.content.Context
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.os.Build
import android.content.ComponentName
import com.senku.app.agent.AgentAccessibilityService
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

private val Ink = Color(0xFF172033)
private val Muted = Color(0xFF596579)
private val White = Color(0xFFFFFFFF)
private val Paper = Color(0xFFF8F7F3)
private val SoftSurface = Color(0xFFF0F4F5)
private val BrandLine = Color(0xFFE3E3E9)
private val BrandButton = Color(0xFF1B2334)
private val SenkuTypography = Typography(
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, letterSpacing = (-.6).sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold)
)

private data class Glow(val id: String, val name: String, val color: Color, val light: Color)
private val glows = listOf(
    Glow("seaglass", "Sea glass", Color(0xFF61C9B8), Color(0xFFD4FBF2)),
    Glow("blue", "Blue", Color(0xFF76BAF2), Color(0xFFC3F7FD)),
    Glow("pink", "Pink", Color(0xFFEE8FBA), Color(0xFFFFEDF6)),
    Glow("red", "Red", Color(0xFFF18A80), Color(0xFFFFE6CA))
)

/** Compose owns the setup UI; the always-on-top orb stays in OverlayService. */
class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("companion", MODE_PRIVATE) }
    private var selectedGlow by mutableStateOf("seaglass")
    private var voiceProvider by mutableStateOf("gemini")
    private var overlayAllowed by mutableStateOf(false)
    private var companionEnabled by mutableStateOf(false)
    private var startAfterPermission = false
    private val auth by lazy { SupabaseAuth(this) }
    private var signedInEmail by mutableStateOf<String?>(null)
    private var authMessage by mutableStateOf("")
    private var authBusy by mutableStateOf(false)
    private var accessibilityReady by mutableStateOf(false)
    private var onboardingActive by mutableStateOf(false)
    private var onboardingStep by mutableStateOf(0)
    private var editingColour by mutableStateOf(false)
    private var accessibilityAttempted by mutableStateOf(false)
    private var restrictedSettingsOpened by mutableStateOf(false)
    private var awaitingRestrictedSettingsReturn = false
    private var guideAudio: android.media.MediaPlayer? = null
    private var lastGuideStage = 0
    private var awaitingAccessibilityReturn = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var accessibilityReturnCheck: Runnable? = null
    private var liveAttemptedThisActivity = false
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) refreshOnboarding()
        else Toast.makeText(this, "Microphone access lets you talk with Sahay. Tap Enable microphone to try again.", Toast.LENGTH_LONG).show()
    }
    private var chatDraft by mutableStateOf("")
    private var chatMessages by mutableStateOf(emptyList<ChatLine>())
    private val chatListener: (List<ChatLine>) -> Unit = { lines -> runOnUiThread { chatMessages = lines } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ChatTranscript.listen(chatListener)
        selectedGlow = preferences.getString("theme", "seaglass") ?: "seaglass"
        // Migrate any retired provider selection to the supported default.
        voiceProvider = preferences.getString("voice_provider", "gemini")
            ?.takeIf { it == "gemini" || it == "livejev" } ?: "gemini"
        preferences.edit().putString("voice_provider", voiceProvider).apply()
        companionEnabled = preferences.getBoolean("enabled", false)
        onboardingActive = !preferences.getBoolean(KEY_ONBOARDING_COMPLETE, false)
        onboardingStep = nextOnboardingStep()
        // Updates can reapply Android's restricted-settings gate, even with the same versionCode.
        val installRevision = packageManager.getPackageInfo(packageName, 0).lastUpdateTime
        if (preferences.getLong("accessibility_setup_install_revision", 0L) != installRevision) {
            resetAccessibilitySetupProgress()
            preferences.edit().putLong("accessibility_setup_install_revision", installRevision).apply()
        }
        accessibilityAttempted = preferences.getBoolean("accessibility_attempted", false)
        restrictedSettingsOpened = preferences.getBoolean("restricted_settings_opened", false)
        signedInEmail = if (auth.isSignedIn) auth.email else null
        val systemBarColor = android.graphics.Color.rgb(248, 247, 243)
        window.statusBarColor = systemBarColor
        window.navigationBarColor = systemBarColor
        window.decorView.systemUiVisibility =
            android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = BrandButton, onPrimary = White,
                    secondary = Color(0xFF61C9B8), onSecondary = Ink,
                    background = Paper, onBackground = Ink,
                    surface = White, onSurface = Ink
                ),
                typography = SenkuTypography
            ) {
                if (signedInEmail == null) {
                    SignInScreen(
                        message = authMessage,
                        busy = authBusy,
                        onSaveKey = ::saveGeminiKey
                    )
                } else if (editingColour || (onboardingActive && onboardingStep == 0)) {
                    ColourScreen(selectedGlow, ::chooseGlow, onContinue = {
                        preferences.edit().putBoolean("onboarding_colour_chosen", true).apply()
                        editingColour = false
                        refreshOnboarding()
                    })
                } else if (onboardingActive) {
                    OnboardingScreen(
                        step = onboardingStep,
                        selected = selectedGlow,
                        accessibilityAttempted = accessibilityAttempted,
                        restrictedSettingsOpened = restrictedSettingsOpened,
                        onContinue = when (onboardingStep) { 1 -> ::requestOverlayPermission; 4 -> ::finishOnboarding; else -> ::requestMicrophone },
                        onAccessibility = ::openAccessibilitySettings,
                        onRestrictedSettings = ::openRestrictedSettings
                    )
                } else HomeScreen(
                    selected = selectedGlow,
                    signedInEmail = signedInEmail.orEmpty(),
                    onColour = { editingColour = true },
                    onVoice = ::startConversation,
                    onSignOut = {
                        hideCompanion()
                        auth.signOut(); signedInEmail = null; authMessage = ""
                    },
                    accessibilityReady = accessibilityReady,
                    displayOverAppsAllowed = overlayAllowed,
                    microphoneAllowed = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
                    onAccessibility = ::openAccessibilitySettings,
                    onOverlayPermission = ::requestOverlayPermission
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        overlayAllowed = Settings.canDrawOverlays(this)
        companionEnabled = preferences.getBoolean("enabled", false)
        signedInEmail = if (auth.isSignedIn) auth.email else null
        accessibilityReady = AgentAccessibilityService.instance != null
            || isAccessibilityServiceEnabled()
        if (!awaitingAccessibilityReturn) refreshOnboarding()
        if (awaitingAccessibilityReturn) {
            awaitingAccessibilityReturn = false
            verifyAccessibilityAfterReturn()
        }
        if (awaitingRestrictedSettingsReturn) {
            awaitingRestrictedSettingsReturn = false
        }
        if (overlayAllowed && startAfterPermission) {
            startAfterPermission = false
            startOverlay()
        }
    }

    override fun onPostResume() {
        super.onPostResume()
        playAccessibilityGuideIfNeeded()
    }

    override fun onDestroy() {
        guideAudio?.release()
        guideAudio = null
        accessibilityReturnCheck?.let(mainHandler::removeCallbacks)
        ChatTranscript.remove(chatListener)
        super.onDestroy()
    }

    }

    private fun nextOnboardingStep(): Int = when {
        !preferences.getBoolean("onboarding_colour_chosen", preferences.getBoolean(KEY_ONBOARDING_COMPLETE, false)) -> 0
        !accessibilityReady -> 3
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED -> 2
        !Settings.canDrawOverlays(this) -> 1
        else -> 4
    }

    private fun resetAccessibilitySetupProgress() {
        accessibilityAttempted = false
        restrictedSettingsOpened = false
        lastGuideStage = 0
        preferences.edit().remove("accessibility_attempted").remove("restricted_settings_opened").apply()
    }

    private fun refreshOnboarding() {
        if (!auth.isSignedIn) return
        overlayAllowed = Settings.canDrawOverlays(this)
        accessibilityReady = AgentAccessibilityService.instance != null || isAccessibilityServiceEnabled()
        if (accessibilityReady && (accessibilityAttempted || restrictedSettingsOpened)) {
            resetAccessibilitySetupProgress()
        }
        val nextStep = nextOnboardingStep()
        if (nextStep in 0..3) onboardingActive = true
        onboardingStep = nextStep
        playAccessibilityGuideIfNeeded()
    }

    /** Recordings keep playing when Android Settings takes the foreground. */
    private fun playAccessibilityGuideIfNeeded() {
        if (!auth.isSignedIn || !onboardingActive || onboardingStep != 3 || editingColour ||
            awaitingAccessibilityReturn || awaitingRestrictedSettingsReturn || accessibilityReturnCheck != null ||
            !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) return
        val stage = when {
            restrictedSettingsOpened -> 3
            accessibilityAttempted -> 2
            else -> 1
        }
        if (stage == lastGuideStage) return
        val recording = when (stage) {
            1 -> R.raw.accessibility_step_1
            2 -> R.raw.accessibility_step_2
            else -> R.raw.accessibility_step_3
        }
        guideAudio?.release()
        guideAudio = null
        val attributes = android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()
        runCatching {
            val player = android.media.MediaPlayer.create(this, recording, attributes, 0)
                ?: return@runCatching
            guideAudio = player
            player.setOnCompletionListener {
                if (guideAudio === it) guideAudio = null
                it.release()
            }
            player.setOnErrorListener { failed, _, _ ->
                if (guideAudio === failed) guideAudio = null
                failed.release()
                true
            }
            player.start()
            lastGuideStage = stage
        }.onFailure {
            guideAudio?.release()
            guideAudio = null
        }
    }

    /** Give Android time to persist the switch and bind the service before deciding setup failed. */
    private fun verifyAccessibilityAfterReturn() {
        accessibilityReturnCheck?.let(mainHandler::removeCallbacks)
        var attempts = 0
        lateinit var check: Runnable
        check = Runnable {
            attempts += 1
            accessibilityReady = AgentAccessibilityService.instance != null || isAccessibilityServiceEnabled()
            if (accessibilityReady) {
                accessibilityReturnCheck = null
                refreshOnboarding()
            } else if (attempts < 5) {
                mainHandler.postDelayed(check, 500L)
            } else {
                accessibilityReturnCheck = null
                refreshOnboarding()

            }
        }
        accessibilityReturnCheck = check
        mainHandler.postDelayed(check, 1_200L)
    }

    private fun requestMicrophone() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) refreshOnboarding()
        else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startConversation() {
        if (!Settings.canDrawOverlays(this)) { requestOverlayPermission(); return }
        preferences.edit().putBoolean("enabled", true).apply()
        companionEnabled = true
        startActivity(Intent(this, VoiceActivity::class.java))
    }

    private fun openAccessibilitySettings() {
        accessibilityAttempted = true
        preferences.edit().putBoolean("accessibility_attempted", true).apply()
        awaitingAccessibilityReturn = true
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openRestrictedSettings() {
        if (!accessibilityAttempted) { openAccessibilitySettings(); return }
        restrictedSettingsOpened = true
        preferences.edit().putBoolean("restricted_settings_opened", true).apply()
        awaitingRestrictedSettingsReturn = true
        val apps = Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)
        startActivity(if (apps.resolveActivity(packageManager) != null) apps else Intent(Settings.ACTION_SETTINGS))
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val target = ComponentName(this, AgentAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(target, ignoreCase = true) }
    }

    private fun finishOnboarding() {
        if (!onboardingActive) return
        onboardingActive = false
        lastGuideStage = 0
        preferences.edit().putBoolean(KEY_ONBOARDING_COMPLETE, true).apply()
        if (overlayAllowed && !companionEnabled) startOverlay()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun sendChatMessage() {
        val text = chatDraft.trim()
        if (text.isEmpty()) return
        chatDraft = ""
        ChatTranscript.add("You", text)
        if (!auth.isSignedIn) {
            ChatTranscript.add("Sahay", "Add your Gemini key first, then send your message again.")
        } else if (!Settings.canDrawOverlays(this)) {
            ChatTranscript.add("Sahay", "Allow display over other apps first, then send your message again.")
            requestOverlayPermission()
        } else {
            startActivity(Intent(this, VoiceActivity::class.java).putExtra(VoiceActivity.EXTRA_TEXT_MESSAGE, text))
        }
    }

    private fun chooseGlow(id: String) {
        selectedGlow = id
        preferences.edit().putString("theme", id).apply()
        if (overlayAllowed && companionEnabled) {
            startService(Intent(this, VoiceOverlayService::class.java)
                .setAction(OverlayService.ACTION_THEME)
                .putExtra(OverlayService.EXTRA_THEME, id))
            startForegroundService(Intent(this, OverlayService::class.java)
                .setAction(OverlayService.ACTION_THEME)
                .putExtra(OverlayService.EXTRA_THEME, id))
        }
    }

    private fun requestOverlayPermission() {
        if (!Settings.canDrawOverlays(this)) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
    }

    private fun showCompanion() {
        if (Settings.canDrawOverlays(this)) startOverlay()
        else {
            startAfterPermission = true
            requestOverlayPermission()
        }
    }

    private fun startOverlay() {
        preferences.edit().putBoolean("enabled", true).apply()
        companionEnabled = true
        startForegroundService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_SHOW))
    }

    private fun hideCompanion() {
        preferences.edit().putBoolean("enabled", false).apply()
        companionEnabled = false
        stopService(Intent(this, VoiceOverlayService::class.java))
        stopService(Intent(this, OverlayService::class.java))
    }

    private fun testCircle() {
        if (!Settings.canDrawOverlays(this)) {
            requestOverlayPermission()
            return
        }
        startForegroundService(Intent(this, OverlayService::class.java)
            .setAction(OverlayService.ACTION_DRAW_CIRCLE))
        moveTaskToBack(true)
    }

    companion object {
        private const val KEY_ONBOARDING_COMPLETE = "onboarding_complete_v1"
        private const val KEY_ONBOARDING_LIVE_ATTEMPTED = "onboarding_live_attempted_v1"
        private const val KEY_ONBOARDING_LIVE_PROMPTED = "onboarding_live_prompted_v1"
        private const val KEY_ONBOARDING_LIVE_ACTIVE = "onboarding_live_active_v1"
    }

    private fun saveGeminiKey(text: String) {
        if (authBusy) return
        authBusy = true
        try {
            val count = auth.saveGeminiKeys(text)
            authBusy = false
            completeSignIn(auth.email ?: "Your own Gemini key")
            authMessage = if (count > 1) "Saved $count keys. Sahay switches between them when one is busy." else "Saved."
        } catch (error: Exception) {
            authMessage = error.message ?: "That key could not be saved."
            authBusy = false
        }
    }

    private fun completeSignIn(email: String) {
        signedInEmail = email
        authMessage = "Signed in."
        authBusy = false
        overlayAllowed = Settings.canDrawOverlays(this)
        refreshOnboarding()
    }
}
