package com.senku.app

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ImageView

/** Small visible controls with a larger, separate touch target. */
internal fun orbControl(context: Context, pen: Boolean, theme: String?, onClick: () -> Unit): FrameLayout {
    val density = context.resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()
    val accent = when (theme) {
        "blue" -> 0xFF438FD0.toInt()
        "pink" -> 0xFFD86EA9.toInt()
        "red" -> 0xFFE26E68.toInt()
        else -> 0xFF43B9AA.toInt()
    }
    return FrameLayout(context).apply {
        contentDescription = if (pen) "Draw on screen" else "Close companion"
        isFocusable = true
        addView(ImageView(context).apply {
            setImageResource(if (pen) R.drawable.ic_orb_pen else R.drawable.ic_orb_close)
            setColorFilter(Color.rgb(23, 32, 51))
            setPadding(dp(7), dp(7), dp(7), dp(7))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(248, 247, 243))
                setStroke(dp(1).coerceAtLeast(1), if (pen) accent else Color.rgb(224, 227, 231))
            }
            elevation = dp(2).toFloat()
            importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, FrameLayout.LayoutParams(dp(if (pen) 28 else 24), dp(if (pen) 28 else 24), Gravity.CENTER))
        setOnClickListener { onClick() }
    }
}
