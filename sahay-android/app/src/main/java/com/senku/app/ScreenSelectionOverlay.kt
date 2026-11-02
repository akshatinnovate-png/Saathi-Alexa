package com.senku.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.hypot

/** Frozen screen with a pen lasso. Only pixels inside the selected area are sent. */
internal class ScreenSelectionOverlay(
    private val context: Context,
    private val screenshot: Bitmap,
    private val onDismiss: () -> Unit = {},
    private val onComplete: (JSONObject) -> Unit,
) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val density = context.resources.displayMetrics.density
    @Volatile private var closed = false
    private var busy = false
    private var delivered = false
    private var fadeFinished = false
    private val idleTimeout = Runnable {
        if (!closed && !busy && !draw.hasSelection()) finish(JSONObject().put("status", "cancelled"))
    }
    private val root = FrameLayout(context)
    private lateinit var draw: LassoView

    fun show() {
        draw = LassoView(context, screenshot,
            { main.removeCallbacks(idleTimeout) },
            { send() })
        root.addView(draw, FrameLayout.LayoutParams(-1, -1))
        val params = WindowManager.LayoutParams(-1, -1, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.graphics.PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        try {
            windows.addView(root, params)
            main.postDelayed(idleTimeout, 30_000)
        } catch (_: Exception) {
            finish(JSONObject().put("status", "error").put("summary", "Could not open screen selection."))
        }
    }

    private fun send() {
        if (busy || !draw.hasSelection()) return
        busy = true
        draw.isEnabled = false
        val selection = draw.selection()
        val offset = IntArray(2).also { draw.getLocationOnScreen(it) }
        // Reveal the live app immediately; only the drawn outline fades while the crop encodes.
        draw.releaseScreen()
        (root.layoutParams as? WindowManager.LayoutParams)?.let { params ->
            params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            windows.updateViewLayout(root, params)
        }
        root.animate().alpha(0f).setDuration(500L).withEndAction {
            fadeFinished = true
            if (delivered) close()
        }.start()
        worker.execute {
            var selected: Bitmap? = null
            try {
                selected = SelectionCropper.crop(screenshot, selection, offset[0], offset[1])
                val ratio = minOf(1.0, 1600.0 / maxOf(selected.width, selected.height))
                var scaled = Bitmap.createScaledBitmap(selected,
                    (selected.width * ratio).toInt().coerceAtLeast(1),
                    (selected.height * ratio).toInt().coerceAtLeast(1), true)
                val result = try {
                    fun encode() = ByteArrayOutputStream().use { output ->
                        check(scaled.compress(Bitmap.CompressFormat.PNG, 100, output)); output.toByteArray()
                    }
                    var bytes = encode()
                    while (bytes.size > 600_000 && maxOf(scaled.width, scaled.height) > 256) {
                        val smaller = Bitmap.createScaledBitmap(scaled,
                            (scaled.width * .75).toInt().coerceAtLeast(1),
                            (scaled.height * .75).toInt().coerceAtLeast(1), true)
                        if (scaled !== selected) scaled.recycle()
                        scaled = smaller
                        bytes = encode()
                    }
                    check(bytes.size <= 600_000) { "Selection is too large" }
                    JSONObject().put("status", "success").put("mimeType", "image/png")
                        .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                        .put("width", scaled.width).put("height", scaled.height)
                } finally { if (scaled !== selected) scaled.recycle() }
                main.post { if (!closed) finish(result) }
            } catch (_: Exception) {
                main.post { if (!closed) finish(JSONObject().put("status", "error")
                    .put("summary", "Could not send your selected area. Try a smaller outline.")) }
            } finally { selected?.recycle() }
        }
    }

    private fun finish(result: JSONObject) {
        if (closed || delivered) return
        delivered = true
        // Deliver as soon as encoding completes, independently of the visual fade.
        onComplete(result)
        if (result.optString("status") != "success" || fadeFinished) close()
    }

    fun close() {
        if (closed) return
        closed = true
        main.removeCallbacks(idleTimeout)
        root.animate().cancel()
        if (root.isAttachedToWindow) windows.removeView(root)
        worker.execute { screenshot.recycle() }
        worker.shutdown()
        onDismiss()
    }

    private inner class LassoView(context: Context, private val screen: Bitmap,
        private val started: () -> Unit, private val finished: () -> Unit) : View(context) {
        private val strokes = mutableListOf<Path>()
        private val current = Path()
        private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3f * density
            strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
            color = Color.rgb(156, 255, 231)
        }
        private val halo = Paint(stroke).apply { strokeWidth = 12f * density; alpha = 55 }
        private var drawing = false
        private var showScreenshot = true
        private var lastX = 0f
        private var lastY = 0f
        private val location = IntArray(2)

        fun hasSelection() = strokes.isNotEmpty()
        fun selection() = Path().apply { strokes.forEach { addPath(it) } }

        fun releaseScreen() { showScreenshot = false; invalidate() }

        override fun onDraw(canvas: Canvas) {
            getLocationOnScreen(location)
            if (showScreenshot) canvas.drawBitmap(screen, -location[0].toFloat(), -location[1].toFloat(), bitmapPaint)
            for (path in strokes + current) {
                if (path.isEmpty) continue
                canvas.drawPath(path, halo)
                canvas.drawPath(path, stroke)
            }
        }

        private fun point(x: Float, y: Float) {
            if (hypot((x - lastX).toDouble(), (y - lastY).toDouble()) < density) return
            current.quadTo(lastX, lastY, (lastX + x) / 2f, (lastY + y) / 2f)
            lastX = x; lastY = y
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (!isEnabled) return true
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    started()
                    drawing = true; lastX = event.x; lastY = event.y
                    current.reset(); current.moveTo(lastX, lastY)
                }
                MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> { drawing = false; current.reset() }
                MotionEvent.ACTION_MOVE -> if (drawing) {
                    for (i in 0 until event.historySize) point(event.getHistoricalX(i), event.getHistoricalY(i))
                    point(event.x, event.y)
                }
                MotionEvent.ACTION_UP -> if (drawing) {
                    point(event.x, event.y)
                    current.lineTo(event.x, event.y)
                    val bounds = RectF().also { current.computeBounds(it, true) }
                    val shape = Path()
                    if (bounds.width() < 4 * density && bounds.height() < 4 * density) {
                        shape.addCircle(event.x, event.y, 24 * density, Path.Direction.CW)
                    } else if (bounds.width() < 12 * density || bounds.height() < 12 * density) {
                        Paint(stroke).apply { strokeWidth = 32 * density }.getFillPath(current, shape)
                    } else {
                        shape.set(current)
                        shape.close()
                    }
                    strokes.add(shape)
                    current.reset(); drawing = false
                    finished(); performClick()
                }
            }
            postInvalidateOnAnimation()
            return true
        }

        override fun performClick(): Boolean { super.performClick(); return true }

        override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
            if (oldw > 0 && oldh > 0 && (w != oldw || h != oldh)) main.post {
                if (!closed) finish(JSONObject().put("status", "error").put("summary", "Screen size changed. Start selection again."))
            }
        }
    }
}
