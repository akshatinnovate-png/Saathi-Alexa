package com.senku.app

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Transient diagnostics: no credentials or conversation content. */
internal object VoiceConnection {
    var status by mutableStateOf("Not connected")
        private set
    var startedAt by mutableStateOf(0L)
        private set
    fun start() { startedAt = SystemClock.elapsedRealtime(); status = "Starting voice…" }
    fun update(value: String) { status = value.take(180) }
}
