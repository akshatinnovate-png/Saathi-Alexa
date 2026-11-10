package io.github.akshatinnovate.saathi.shield

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.StatFs
import java.io.File
import java.security.MessageDigest

class ModelStore(private val context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val file = File(context.filesDir, FILE_NAME)

    fun ready(sha256: String?): File? = if (sha256 != null && file.exists() && prefs.getString(KEY_SHA, null) == sha256) file else null

    fun deviceCanRun(): Boolean {
        val memory = ActivityManager.MemoryInfo()
        context.getSystemService(ActivityManager::class.java)?.getMemoryInfo(memory) ?: return false
        return memory.totalMem >= MIN_RAM_BYTES
    }

    private fun unmetered(): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    fun download(config: ShieldConfig): File? {
        val sha = config.modelSha256 ?: return null
        ready(sha)?.let { return it }
        val url = config.modelUrl ?: return null
        if (!deviceCanRun() || !unmetered()) return null
        val needed = (config.modelBytes ?: DEFAULT_BYTES) * 12 / 10
        if (StatFs(context.filesDir.path).availableBytes < needed) return null
        val sameServer = url.startsWith("/api/")
        val full = if (sameServer) (SaathiApi.origin(context) ?: return null) + url else url
        val part = File(context.filesDir, "$FILE_NAME.part")
        val connection = SaathiApi.open(full, withCookie = sameServer)
        try {
            connection.connectTimeout = 30_000
            connection.readTimeout = 60_000
            if (connection.responseCode !in 200..299) return null
            val digest = MessageDigest.getInstance("SHA-256")
            connection.inputStream.use { input ->
                part.outputStream().use { output ->
                    val buffer = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        digest.update(buffer, 0, n)
                        output.write(buffer, 0, n)
                    }
                }
            }
            val got = digest.digest().joinToString("") { "%02x".format(it) }
            if (got != sha) {
                part.delete()
                return null
            }
            if (!part.renameTo(file)) return null
            prefs.edit().putString(KEY_SHA, sha).apply()
            return file
        } catch (_: Exception) {
            part.delete()
            return null
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val PREFS = "shield"
        private const val KEY_SHA = "model_sha256"
        private const val FILE_NAME = "gemma.task"
        private const val DEFAULT_BYTES = 600L * 1024 * 1024
        private const val MIN_RAM_BYTES = 3L * 1024 * 1024 * 1024
    }
}
