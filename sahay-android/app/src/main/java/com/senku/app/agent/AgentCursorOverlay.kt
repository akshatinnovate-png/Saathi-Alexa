package com.senku.app.agent

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.hypot

/** A tiny, non-touchable marker. Never supplies coordinates to the action executor. */
internal class AgentCursorOverlay(
    private val context: Context,
    private val canShow: () -> Boolean,
    private val windowType: Int = WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
) {
    private val main = Handler(Looper.getMainLooper())
    private val windows = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private val size = (72 * density).toInt()
    private var view: CursorView? = null
    private var layout: WindowManager.LayoutParams? = null
    private var motion: ValueAnimator? = null
    private var ripple: ValueAnimator? = null
    private var x = 0f
    private var y = 0f
    private var disposed = false
    private val soften = Runnable { view?.alpha = .5f }

    /** Runs on the agent worker; the short visual lead-in never blocks Android's UI thread. */
    fun indicate(bounds: Rect, scrollBackward: Boolean? = null) {
        if (bounds.isEmpty) return
        val arrived = CountDownLatch(1)
        val span = minOf(48f * density, bounds.height() * .22f)
        val centerX = bounds.exactCenterX()
        val centerY = bounds.exactCenterY()
        val startY = if (scrollBackward == null) centerY else centerY + if (scrollBackward) -span else span
        val endY = if (scrollBackward == null) null else centerY + if (scrollBackward) span else -span
        main.post { show(centerX, startY, endY, arrived) }
        if (Looper.myLooper() != Looper.getMainLooper()) arrived.await(350, TimeUnit.MILLISECONDS)
    }

    private fun show(targetX: Float, targetY: Float, scrollEndY: Float?, arrived: CountDownLatch) {
        if (disposed || !canShow()) { arrived.countDown(); return }
        try {
            main.removeCallbacks(soften)
            motion?.cancel()
            ripple?.cancel()
            val existing = view != null
            if (!existing) {
                x = targetX; y = targetY
                val marker = CursorView(context)
                val params = WindowManager.LayoutParams(size, size, windowType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    android.graphics.PixelFormat.TRANSLUCENT).apply {
                    gravity = Gravity.TOP or Gravity.LEFT
                    x = (targetX - size / 2f).toInt(); y = (targetY - size / 2f).toInt()
                    if (Build.VERSION.SDK_INT >= 30) setFitInsetsTypes(0)
                }
                windows.addView(marker, params)
                view = marker; layout = params
            }
            view?.alpha = 1f
            val fromX = x; val fromY = y
            val duration = if (!existing) 0L else (100 + hypot((targetX - x).toDouble(), (targetY - y).toDouble()) / density / 6)
                .toLong().coerceAtMost(200)
            motion = ValueAnimator.ofFloat(0f, 1f).apply {
                this.duration = duration
                interpolator = DecelerateInterpolator()
                addUpdateListener {
                    val t = it.animatedValue as Float
                    position(fromX + (targetX - fromX) * t, fromY + (targetY - fromY) * t)
                }
                addListener(object : AnimatorListenerAdapter() {
                    private var cancelled = false
                    override fun onAnimationCancel(animation: Animator) { cancelled = true; arrived.countDown() }
                    override fun onAnimationEnd(animation: Animator) {
                        arrived.countDown()
                        if (!cancelled && !disposed && canShow()) pulse(targetX, targetY, scrollEndY)
                    }
                })
                start()
            }
        } catch (_: Exception) {
            // Visual feedback must never break the underlying accessibility action.
            hideNow()
            arrived.countDown()
        }
    }

    private fun position(newX: Float, newY: Float) {
        x = newX; y = newY
        val marker = view ?: return
        val params = layout ?: return
        params.x = (x - size / 2f).toInt(); params.y = (y - size / 2f).toInt()
        if (marker.isAttachedToWindow) windows.updateViewLayout(marker, params)
    }

    private fun pulse(startX: Float, startY: Float, scrollEndY: Float?) {
        ripple = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = if (scrollEndY == null) 420 else 480
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                if (!canShow()) { hideNow(); return@addUpdateListener }
                val t = it.animatedValue as Float
                if (scrollEndY != null) position(startX, startY + (scrollEndY - startY) * t)
                view?.progress = t
                view?.postInvalidateOnAnimation()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) { main.postDelayed(soften, 650) }
            })
            start()
        }
    }

    fun hide() { main.post { hideNow() } }

    private fun hideNow() {
        main.removeCallbacks(soften)
        motion?.cancel(); motion = null
        ripple?.cancel(); ripple = null
        view?.let { if (it.isAttachedToWindow) windows.removeView(it) }
        view = null; layout = null
    }

    fun close() { main.post { disposed = true; hideNow() } }

    private inner class CursorView(context: Context) : View(context) {
        var progress = 1f
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        init {
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            isClickable = false
            isFocusable = false
        }
        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f; val cy = height / 2f
            val theme = context.getSharedPreferences("companion", Context.MODE_PRIVATE)
                .getString("theme", "seaglass")
            val color = when (theme) {
                "blue" -> Color.rgb(130, 210, 255)
                "pink" -> Color.rgb(255, 165, 215)
                "red" -> Color.rgb(255, 145, 130)
                else -> Color.rgb(140, 255, 225)
            }
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(55, Color.red(color), Color.green(color), Color.blue(color))
            canvas.drawCircle(cx, cy, 12 * density, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 4f * density
            paint.color = Color.argb((145 * (1 - progress)).toInt(), 5, 12, 20)
            canvas.drawCircle(cx, cy, (8 + 18 * progress) * density, paint)
            paint.strokeWidth = 2f * density
            paint.color = Color.argb((230 * (1 - progress)).toInt(), Color.red(color), Color.green(color), Color.blue(color))
            canvas.drawCircle(cx, cy, (8 + 18 * progress) * density, paint)
            paint.style = Paint.Style.FILL
            paint.color = Color.rgb(5, 12, 20)
            canvas.drawCircle(cx, cy, 7f * density, paint)
            paint.color = Color.WHITE
            canvas.drawCircle(cx, cy, 5.3f * density, paint)
            paint.color = color
            canvas.drawCircle(cx, cy, 4.2f * density, paint)
        }
    }
}
