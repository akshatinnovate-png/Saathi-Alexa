package io.github.akshatinnovate.saathi.shield

import android.content.Context
import android.webkit.CookieManager
import io.github.akshatinnovate.saathi.SaathiAddress
import java.net.HttpURLConnection
import java.net.URL

object SaathiApi {
    private const val MAIN_PREFS = "saathi"
    private const val KEY_START = "start"
    private const val TIMEOUT_MILLIS = 15_000

    fun origin(context: Context): String? =
        context.getSharedPreferences(MAIN_PREFS, Context.MODE_PRIVATE).getString(KEY_START, null)?.let { SaathiAddress.from(it)?.origin }

    fun open(url: String, withCookie: Boolean): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = TIMEOUT_MILLIS
        connection.readTimeout = TIMEOUT_MILLIS
        connection.instanceFollowRedirects = false
        if (withCookie) CookieManager.getInstance().getCookie(url)?.let { connection.setRequestProperty("Cookie", it) }
        return connection
    }

    fun call(context: Context, path: String, method: String, body: String?): String? {
        val base = origin(context) ?: return null
        val connection = open(base + path, withCookie = true)
        try {
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            if (connection.responseCode !in 200..299) return null
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
