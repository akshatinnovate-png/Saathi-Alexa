package io.github.akshatinnovate.saathi.shield

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import java.io.File

class GemmaScamClassifier(private val context: Context) {
    private var engine: LlmInference? = null
    private var loadedFrom: String? = null

    @Synchronized
    fun load(model: File): Boolean {
        if (engine != null && loadedFrom == model.path) return true
        close()
        return try {
            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(model.path)
                .setMaxTokens(MAX_TOKENS)
                .build()
            engine = LlmInference.createFromOptions(context, options)
            loadedFrom = model.path
            true
        } catch (_: Throwable) {
            engine = null
            loadedFrom = null
            false
        }
    }

    @Synchronized
    fun classify(message: String): Verdict? {
        val llm = engine ?: return null
        return try {
            GemmaVerdict.parse(llm.generateResponse(GemmaVerdict.prompt(message)))
        } catch (_: Throwable) {
            null
        }
    }

    @Synchronized
    fun close() {
        try {
            engine?.close()
        } catch (_: Throwable) {
        }
        engine = null
        loadedFrom = null
    }

    companion object {
        private const val MAX_TOKENS = 768
    }
}
