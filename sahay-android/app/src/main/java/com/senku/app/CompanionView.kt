package com.senku.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.View
import kotlin.math.cos
import kotlin.math.sin

/** Drawn natively so the companion can animate inside an Android overlay window. */
class CompanionView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var startedAt = System.currentTimeMillis()
    private var reactedAt = -1000L
    var mode: String = "idle"
        private set
    var theme: String = "seaglass"
        private set
    var eyes: String = "square"
        private set

    init { contentDescription = "Floating companion. Drag to move." }

    fun setMode(value: String?) {
        if (value in setOf("idle", "listening", "thinking", "speaking") && value != mode) {
            mode = value!!
            startedAt = System.currentTimeMillis()
            invalidate()
        }
    }

    fun setTheme(value: String?) {
        if (value in setOf("seaglass", "blue", "pink", "red")) {
            theme = value!!
            invalidate()
        }
    }

    /** The companion has no mouth; the second argument remains for old internal callers. */
    fun setFace(eyeStyle: String?, @Suppress("UNUSED_PARAMETER") mouthStyle: String?) {
        if (eyeStyle in EYE_STYLES) eyes = eyeStyle!!
        invalidate()
    }

    fun setEmotion(value: String?) {
        when (value) {
            "normal" -> setFace("square", "none")
            "shy" -> setFace("shy", "none")
            "happy" -> setFace("happy", "none")
            "curious" -> setFace("curious", "none")
            "surprised" -> setFace("round", "none")
        }
    }

    private var connectionLabel: String? = null
    fun setConnectionLabel(value: String?) { connectionLabel = value; invalidate() }

    fun react() { reactedAt = System.currentTimeMillis(); invalidate() }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val u = width / 112f
        val cx = width / 2f
        var cy = height * .43f
        val reactionAge = (System.currentTimeMillis() - reactedAt) / 450f
        canvas.save()
        if (reactionAge in 0f..1f) {
            val bounce = sin(reactionAge * Math.PI).toFloat() * .12f
            canvas.scale(1 + bounce, 1 - bounce * .5f, cx, cy)
        }
        val phase = (System.currentTimeMillis() - startedAt) / 1000.0
        cy += sin(phase * if (mode == "speaking") 14.0 else 2.2).toFloat() *
            (if (mode == "speaking") 2 else 3) * u

        val colors = when (theme) {
            "blue" -> intArrayOf(0xffe7fbff.toInt(), 0xffa7e7ff.toInt(), 0xff438fd0.toInt(), 0xff1d456c.toInt(), 0x008acfff)
            "pink" -> intArrayOf(0xfffff0f7.toInt(), 0xffffc9e4.toInt(), 0xffd86ea9.toInt(), 0xff56304b.toInt(), 0x00ffabd2)
            "red" -> intArrayOf(0xfffff0e7.toInt(), 0xffffc68f.toInt(), 0xffe26e68.toInt(), 0xff5c2d37.toInt(), 0x00ff9d8d)
            else -> intArrayOf(0xffeffffb.toInt(), 0xffa9f5e8.toInt(), 0xff43b9aa.toInt(), 0xff174453.toInt(), 0x009cfde6)
        }
        if (mode == "speaking") {
            colors[0] = blendWhite(colors[0], .28f)
            colors[1] = blendWhite(colors[1], .25f)
        }
        paint.style = Paint.Style.FILL
        // Keep a stationary halo for visibility. Activity cues stay inside the orb.
        paint.shader = RadialGradient(cx, cy, 46 * u,
            intArrayOf(withAlpha(colors[4], 62), withAlpha(colors[4], 24), 0x00000000),
            floatArrayOf(0f, .62f, 1f), Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, 46 * u, paint)
        paint.shader = null
        val background = when (theme) {
            "blue" -> intArrayOf(0xff4388c8.toInt(), 0xff4e9fe0.toInt(), 0xff68b9ec.toInt(), 0xffa4eaff.toInt())
            "pink" -> intArrayOf(0xffc75e9b.toInt(), 0xffd873aa.toInt(), 0xffeb94c3.toInt(), 0xffffd9ee.toInt())
            "red" -> intArrayOf(0xffd36362.toInt(), 0xffe97570.toInt(), 0xfff59079.toInt(), 0xffffdda4.toInt())
            else -> intArrayOf(0xff49a99a.toInt(), 0xff54c0ae.toInt(), 0xff70ddc8.toInt(), 0xffb0f8e7.toInt())
        }
        paint.shader = LinearGradient(cx, cy - 35 * u, cx, cy + 35 * u,
            background, floatArrayOf(0f, .54f, .84f, 1f), Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, 35 * u, paint)
        paint.shader = null

        canvas.save()
        val clip = Path().apply { addCircle(cx, cy, 35 * u, Path.Direction.CW) }
        canvas.clipPath(clip)
        val driftX = when (mode) {
            "listening" -> sin(phase * .9).toFloat() * 7 * u
            "thinking" -> sin(phase * .34).toFloat() * 5 * u
            "speaking" -> sin(phase * 1.5).toFloat() * 4 * u
            else -> sin(phase * .22).toFloat() * 3 * u
        }
        val driftY = when (mode) {
            "listening" -> cos(phase * .7).toFloat() * 4 * u
            "thinking" -> cos(phase * .3).toFloat() * 3 * u
            "speaking" -> cos(phase * 1.1).toFloat() * 2 * u
            else -> cos(phase * .2).toFloat() * 2 * u
        }
        val glowPulse = when (mode) {
            "listening" -> (.82 + (sin(phase * 1.35) + 1) * .08).toFloat()
            "thinking" -> (.72 + (sin(phase * .8) + 1) * .13).toFloat()
            else -> 1f
        }
        // Shift a diffuse highlight inside the clipped orb fill. Listening moves
        // gently; thinking drifts more slowly and breathes with a soft pulse.
        val glowCenterY = cy + 12 * u + driftY
        paint.shader = RadialGradient(cx + driftX, glowCenterY, 48 * u,
            intArrayOf(withAlpha(colors[0], (220 * glowPulse).toInt()),
                withAlpha(colors[1], (175 * glowPulse).toInt()),
                withAlpha(colors[2], 70), 0x00000000),
            floatArrayOf(0f, .26f, .55f, .9f), Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, 35 * u, paint)
        paint.shader = null
        // A restrained lower highlight gives each color the soft glossy finish in the reference.
        paint.shader = RadialGradient(cx, cy + 26 * u, 28 * u,
            intArrayOf(withAlpha(colors[0], 205), withAlpha(colors[0], 105), 0x00000000),
            floatArrayOf(0f, .42f, 1f), Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, 35 * u, paint)
        paint.shader = null
        canvas.restore()

        // Idle is Senku's app-controlled sleep state. Thinking narrows the eyes and
        // gives one short, occasional blink while its inner gradient drifts.
        val displayedEyes = if (mode == "idle") "sleepy" else eyes
        val blinkable = displayedEyes in setOf("soft", "round", "wide", "curious", "square")
        val thinkingBlink = mode == "thinking" && phase % 2.6 < .14
        val squint = reactionAge in .24f.. .72f || thinkingBlink ||
            (mode != "thinking" && blinkable && phase % 3.2 > 1.85 && phase % 3.2 < 1.98)
        drawEyes(canvas, cx, cy, u, squint, displayedEyes, mode == "thinking")
        connectionLabel?.let { label ->
            paint.style = Paint.Style.FILL
            paint.shader = null
            val accent = when (theme) {
                "blue" -> 0xff438fd0.toInt()
                "pink" -> 0xffd86ea9.toInt()
                "red" -> 0xffe26e68.toInt()
                else -> 0xff43b9aa.toInt()
            }
            val bubble = android.graphics.RectF(2 * u, height - 21 * u, width - 2 * u, height - 2 * u)
            paint.color = 0xfff8f7f3.toInt()
            canvas.drawRoundRect(bubble, 7 * u, 7 * u, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = u
            paint.color = withAlpha(accent, 100)
            canvas.drawRoundRect(bubble, 7 * u, 7 * u, paint)
            paint.style = Paint.Style.FILL
            paint.color = 0xff172033.toInt()
            paint.textAlign = Paint.Align.CENTER
            paint.textSize = 10.5f * u
            paint.typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
            val labelWidth = paint.measureText(label)
            val availableWidth = bubble.width() - 8 * u
            if (labelWidth > availableWidth) paint.textSize *= availableWidth / labelWidth
            canvas.drawText(label, cx, height - 7 * u, paint)
        }
        canvas.restore()
        postInvalidateDelayed(32)
    }

    private fun drawEyes(
        canvas: Canvas, cx: Float, cy: Float, u: Float, squint: Boolean,
        style: String, thinking: Boolean
    ) {
        if (style == "none") return
        paint.color = 0xf8ffffff.toInt()
        paint.style = Paint.Style.FILL
        canvas.save()
        val eyeHeight = when {
            squint -> .16f
            thinking -> .62f
            else -> 1f
        }
        if (eyeHeight != 1f) canvas.scale(1f, eyeHeight, cx, cy - 2 * u)
        when (style) {
            "round" -> {
                canvas.drawCircle(cx - 11 * u, cy - 2 * u, 3 * u, paint)
                canvas.drawCircle(cx + 11 * u, cy - 2 * u, 3 * u, paint)
            }
            "wide" -> {
                canvas.drawOval(cx - 15 * u, cy - 4 * u, cx - 8 * u, cy, paint)
                canvas.drawOval(cx + 8 * u, cy - 4 * u, cx + 15 * u, cy, paint)
            }
            "sleepy", "happy", "shy" -> {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * u; paint.strokeCap = Paint.Cap.ROUND
                val bend = if (eyes == "happy") -6 * u else 3 * u
                eyeArc(canvas, cx - 11 * u, cy - 2 * u, 4 * u, bend)
                eyeArc(canvas, cx + 11 * u, cy - 2 * u, 4 * u, bend)
                paint.style = Paint.Style.FILL
                if (eyes == "shy") {
                    paint.alpha = 95
                    canvas.drawCircle(cx - 17 * u, cy + 5 * u, 1.5f * u, paint)
                    canvas.drawCircle(cx + 17 * u, cy + 5 * u, 1.5f * u, paint)
                    paint.alpha = 215
                }
            }
            "sparkle" -> {
                star(canvas, cx - 11 * u, cy - 2 * u, 5 * u)
                star(canvas, cx + 11 * u, cy - 2 * u, 5 * u)
            }
            "curious" -> {
                canvas.drawOval(cx - 13 * u, cy - 4.5f * u, cx - 9 * u, cy + .5f * u, paint)
                canvas.drawOval(cx + 8 * u, cy - 6 * u, cx + 14 * u, cy + 2 * u, paint)
            }
            "wink" -> {
                canvas.drawOval(cx - 13 * u, cy - 4.5f * u, cx - 9 * u, cy + .5f * u, paint)
                paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * u; paint.strokeCap = Paint.Cap.ROUND
                eyeArc(canvas, cx + 11 * u, cy - 2 * u, 4 * u, 3 * u)
                paint.style = Paint.Style.FILL
            }
            "square" -> {
                canvas.drawRoundRect(cx - 13 * u, cy - 5 * u, cx - 9 * u, cy, u, u, paint)
                canvas.drawRoundRect(cx + 9 * u, cy - 5 * u, cx + 13 * u, cy, u, u, paint)
            }
            else -> {
                canvas.drawOval(cx - 13 * u, cy - 5 * u, cx - 9 * u, cy, paint)
                canvas.drawOval(cx + 9 * u, cy - 5 * u, cx + 13 * u, cy, paint)
            }
        }
        canvas.restore()
    }

    private fun eyeArc(canvas: Canvas, x: Float, y: Float, half: Float, bend: Float) {
        val path = Path().apply { moveTo(x - half, y); quadTo(x, y + bend, x + half, y) }
        canvas.drawPath(path, paint)
    }

    private fun star(canvas: Canvas, x: Float, y: Float, r: Float) {
        val path = Path().apply {
            moveTo(x, y - r); lineTo(x + r * .3f, y - r * .3f); lineTo(x + r, y)
            lineTo(x + r * .3f, y + r * .3f); lineTo(x, y + r)
            lineTo(x - r * .3f, y + r * .3f); lineTo(x - r, y)
            lineTo(x - r * .3f, y - r * .3f); close()
        }
        canvas.drawPath(path, paint)
    }

    private fun withAlpha(color: Int, alpha: Int) = (color and 0x00ffffff) or (alpha shl 24)

    private fun blendWhite(color: Int, amount: Float): Int {
        val r = (((color shr 16) and 255) * (1 - amount) + 255 * amount).toInt()
        val g = (((color shr 8) and 255) * (1 - amount) + 255 * amount).toInt()
        val b = ((color and 255) * (1 - amount) + 255 * amount).toInt()
        return 0xff000000.toInt() or (r shl 16) or (g shl 8) or b
    }

    companion object {
        val EYE_STYLES = setOf("none", "soft", "round", "wide", "sleepy", "happy", "sparkle", "curious", "wink", "square", "shy")
    }
}
