package com.senku.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import android.provider.Settings
import android.widget.Toast

/** Requests microphone access while visible, then hands the call to the floating service. */
class VoiceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        if (!SupabaseAuth(this).isSignedIn) {
            Toast.makeText(this, "Sign in to Sahay first", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Show the companion first to allow floating voice", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        val textMessage = intent?.getStringExtra(EXTRA_TEXT_MESSAGE)
        if (textMessage != null) {
            startTextChat(textMessage)
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startVoice()
        } else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC_PERMISSION)
    }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MIC_PERMISSION) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startVoice()
            else {
                Toast.makeText(this, "Microphone permission is needed to talk", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }

    private fun startVoice() {
        val onboardingSession = intent?.getBooleanExtra(EXTRA_ONBOARDING_SESSION, false) == true
        val ready = object : ResultReceiver(Handler(Looper.getMainLooper())) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                if (resultCode != 0) {
                    Toast.makeText(this@VoiceActivity, "Could not start floating voice", Toast.LENGTH_LONG).show()
                }
                finish()
            }
        }
        startForegroundService(Intent(this, VoiceOverlayService::class.java)
            .putExtra(VoiceOverlayService.EXTRA_PROVIDER_OVERRIDE, if (onboardingSession) "gemini" else null)
            .putExtra(VoiceOverlayService.EXTRA_INITIAL_PROMPT, if (onboardingSession) onboardingPrompt() else null)
            .putExtra(VoiceOverlayService.EXTRA_ONBOARDING_SESSION, onboardingSession)
            .putExtra(VoiceOverlayService.EXTRA_READY, ready))
    }

    private fun startTextChat(text: String) {
        val ready = object : ResultReceiver(Handler(Looper.getMainLooper())) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                if (resultCode != 0) ChatTranscript.add("Sahay", "Could not start the Gemini text session.")
                finish()
            }
        }
        startForegroundService(Intent(this, VoiceOverlayService::class.java)
            .putExtra(VoiceOverlayService.EXTRA_TEXT_MODE, true)
            .putExtra(VoiceOverlayService.EXTRA_INITIAL_TEXT, text)
            .putExtra(VoiceOverlayService.EXTRA_READY, ready))
    }

    companion object {
        const val EXTRA_TEXT_MESSAGE = "com.senku.app.TEXT_MESSAGE"
        const val EXTRA_ONBOARDING_SESSION = "com.senku.app.ONBOARDING_SESSION"
        private const val MIC_PERMISSION = 4001
    }

    private fun onboardingPrompt(): String =
        "The user has completed Sahay setup: Accessibility, microphone access, and Display over other apps are enabled. Welcome them briefly in English and invite their first request. Do not start permission guidance or ask them to revisit Settings."
}
