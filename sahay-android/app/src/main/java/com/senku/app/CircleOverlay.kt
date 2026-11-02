package com.senku.app

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/** Draws a temporary ring in a system window, above whichever app is visible. */
class CircleOverlay(context: Context) {
    private val app = context.applicationContext
    private val windows = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var ring: View? = null

    fun show(onFinished: () -> Unit = {}) {
        ring?.let { windows.removeView(it) }
        val density = app.resources.displayMetrics.density
        val diameter = (72 * density).toInt()
        val view = View(app).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke((5 * density).toInt(), Color.rgb(128, 229, 213))
            }
        }
        val layout = WindowManager.LayoutParams(
            diameter, diameter, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.CENTER }
        windows.addView(view, layout)
        ring = view
        main.postDelayed({
            if (ring === view) {
                windows.removeView(view)
                ring = null
                onFinished()
            }
        }, 7_000)
    }

    fun close() {
        ring?.let { windows.removeView(it) }
        ring = null
    }
}
