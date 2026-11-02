package com.senku.app

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

data class ChatLine(val role: String, val text: String)

/** Small in-memory transcript shared by the setup screen and Gemini Live WebView bridge. */
object ChatTranscript {
    private val main = Handler(Looper.getMainLooper())
    private val lines = mutableListOf<ChatLine>()
    private val listeners = CopyOnWriteArraySet<(List<ChatLine>) -> Unit>()

    @Synchronized fun snapshot(): List<ChatLine> = lines.toList()

    fun add(role: String, text: String) {
        val clean = text.trim().take(4000)
        if (clean.isEmpty()) return
        main.post {
            val current = synchronized(this) {
                lines += ChatLine(role, clean)
                while (lines.size > 60) lines.removeAt(0)
                lines.toList()
            }
            listeners.forEach { it(current) }
        }
    }

    fun listen(listener: (List<ChatLine>) -> Unit) {
        listeners += listener
        val current = snapshot()
        main.post { listener(current) }
    }

    fun remove(listener: (List<ChatLine>) -> Unit) { listeners -= listener }
}
