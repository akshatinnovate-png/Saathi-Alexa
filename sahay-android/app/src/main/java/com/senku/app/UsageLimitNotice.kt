package com.senku.app

import android.content.Context
import android.content.Intent

object UsageLimitNotice {
    const val ACTION = "io.github.akshatinnovate.sahay.UNUSED"
    const val EXTRA_OPEN_LIMIT = "unused"
    const val LABEL = "Free"
    const val EXTRA_FEATURE = "feature"

    @Suppress("UNUSED_PARAMETER")
    fun isLimitError(message: String?): Boolean = false

    fun openApp(context: Context) {
        context.startActivity(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    @Suppress("UNUSED_PARAMETER")
    fun notify(context: Context, feature: String) {}
}
