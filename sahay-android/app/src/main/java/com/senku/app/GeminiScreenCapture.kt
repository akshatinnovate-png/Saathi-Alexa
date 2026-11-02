package com.senku.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.Display
import com.senku.app.agent.AgentAccessibilityService
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/** One screenshot per explicit screen tool call. Encoded in memory; never written to disk. */
internal class GeminiScreenCapture(private val reply: (String, JSONObject) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    private var capturing = false
    private var lastCaptureAt = 0L

    fun capture(id: String) {
        if (closed || id.isBlank() || id.length > 200) return
        captureBitmap { pixels, failure ->
            if (pixels == null) { error(id, failure ?: "Screenshot unavailable."); return@captureBitmap }
            worker.execute {
                var scaled: Bitmap? = null
                try {
                    val ratio = minOf(1.0, 1280.0 / maxOf(pixels.width, pixels.height))
                    scaled = Bitmap.createScaledBitmap(pixels,
                        (pixels.width * ratio).toInt().coerceAtLeast(1),
                        (pixels.height * ratio).toInt().coerceAtLeast(1), true)
                    val bytes = ByteArrayOutputStream().use { output ->
                        check(scaled.compress(Bitmap.CompressFormat.JPEG, 80, output))
                        output.toByteArray()
                    }
                    check(bytes.size <= 700_000)
                    val result = JSONObject().put("status", "success").put("mimeType", "image/jpeg")
                        .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        .put("width", scaled.width).put("height", scaled.height)
                    main.post { if (!closed) reply(id, result) }
                } catch (_: Exception) {
                    main.post { error(id, "Could not encode this screenshot.") }
                } finally {
                    if (scaled !== pixels) scaled?.recycle()
                    pixels.recycle()
                }
            }
        }
    }

    /** Transfers an unencoded local bitmap to the editor. No pixels go to the WebView here. */
    fun captureBitmap(result: (Bitmap?, String?) -> Unit) {
        if (closed) return
        if (Build.VERSION.SDK_INT < 30) return result(null, "Screen sharing needs Android 11 or newer.")
        val service = AgentAccessibilityService.instance
            ?: return result(null, "Enable Sahay accessibility in Android Settings to share your screen.")
        if (capturing || SystemClock.uptimeMillis() - lastCaptureAt < 1000)
            return result(null, "Please wait a moment before requesting another screenshot.")
        capturing = true
        lastCaptureAt = SystemClock.uptimeMillis()
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, worker, object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                    val buffer = screenshot.hardwareBuffer
                    var hardware: Bitmap? = null
                    try {
                        if (closed) return
                        hardware = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                        val pixels = hardware?.copy(Bitmap.Config.ARGB_8888, false)
                            ?: throw IllegalStateException("Could not read the screenshot.")
                        main.post {
                            capturing = false
                            if (closed) pixels.recycle() else result(pixels, null)
                        }
                    } catch (_: Exception) {
                        main.post { capturing = false; if (!closed) result(null, "Could not capture this screen. It may be protected by the app.") }
                    } finally {
                        hardware?.recycle()
                        buffer.close()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    main.post {
                        capturing = false
                        val reason = when (errorCode) {
                            AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS ->
                                "Turn Sahay accessibility off and back on to enable screenshot access after this update."
                            AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT ->
                                "Please wait a moment and ask again."
                            6 -> "This app protects its screen from screenshots."
                            else -> "Android could not capture this screen ($errorCode)."
                        }
                        if (!closed) result(null, reason)
                    }
                }
            })
        } catch (_: Exception) {
            capturing = false
            if (!closed) result(null, "Screenshot access is unavailable. Turn Sahay accessibility off and back on, then try again.")
        }
    }

    private fun error(id: String, message: String) {
        if (!closed) reply(id, JSONObject().put("status", "error").put("summary", message))
    }

    fun close() {
        closed = true
        worker.shutdown()
    }
}
