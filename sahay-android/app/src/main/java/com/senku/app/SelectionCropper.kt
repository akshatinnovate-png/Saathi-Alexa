package com.senku.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import kotlin.math.ceil
import kotlin.math.floor

/** Keeps only selected pixels. The rest of the output is transparent with zero RGB values. */
internal object SelectionCropper {
    fun crop(source: Bitmap, selection: Path, offsetX: Int, offsetY: Int): Bitmap {
        val mask = Path(selection).apply {
            transform(Matrix().apply { setTranslate(offsetX.toFloat(), offsetY.toFloat()) })
        }
        val screen = Path().apply { addRect(0f, 0f, source.width.toFloat(), source.height.toFloat(), Path.Direction.CW) }
        check(mask.op(screen, Path.Op.INTERSECT)) { "Could not prepare selection" }
        val bounds = RectF()
        mask.computeBounds(bounds, true)
        val left = floor(bounds.left).toInt().coerceIn(0, source.width)
        val top = floor(bounds.top).toInt().coerceIn(0, source.height)
        val right = ceil(bounds.right).toInt().coerceIn(0, source.width)
        val bottom = ceil(bounds.bottom).toInt().coerceIn(0, source.height)
        require(right > left && bottom > top) { "Select an area of the screen first" }
        return Bitmap.createBitmap(right - left, bottom - top, Bitmap.Config.ARGB_8888).also { output ->
            val canvas = Canvas(output)
            canvas.translate(-left.toFloat(), -top.toFloat())
            canvas.drawPath(mask, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
            canvas.drawBitmap(source, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
            })
        }
    }
}
