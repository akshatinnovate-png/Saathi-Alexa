package io.github.akshatinnovate.saathi

import java.net.URI
import java.util.Locale

class SaathiAddress private constructor(val scheme: String, val host: String, val port: Int) {

    val origin: String
        get() = if (port == defaultPort(scheme)) "$scheme://$host" else "$scheme://$host:$port"

    fun owns(url: String?): Boolean {
        val other = parse(url ?: return false) ?: return false
        return other.scheme == scheme && other.host == host && other.port == port
    }

    fun page(path: String): String = origin + if (path.startsWith("/")) path else "/$path"

    override fun equals(other: Any?): Boolean = other is SaathiAddress && other.origin == origin

    override fun hashCode(): Int = origin.hashCode()

    override fun toString(): String = origin

    companion object {
        private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2", "[::1]")
        private val HOST_LABEL = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
        private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

        private fun defaultPort(scheme: String) = if (scheme == "https") 443 else 80

        private fun validHost(host: String): Boolean {
            if (host in LOCAL_HOSTS) return true
            if (host.length > 253) return false
            if (IPV4.matches(host)) return host.split(".").all { it.toInt() in 0..255 }
            val labels = host.split(".")
            return labels.size >= 2 && labels.all { HOST_LABEL.matches(it) }
        }

        private fun parse(text: String): SaathiAddress? {
            val uri = try {
                URI(text.trim())
            } catch (_: Exception) {
                return null
            }
            val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
            if (scheme != "https" && scheme != "http") return null
            if (uri.rawUserInfo != null) return null
            val rawHost = uri.host ?: return null
            val host = rawHost.lowercase(Locale.ROOT).trimEnd('.')
            if (!validHost(host)) return null
            if (scheme == "http" && host !in LOCAL_HOSTS) return null
            val port = if (uri.port == -1) defaultPort(scheme) else uri.port
            if (port !in 1..65535) return null
            return SaathiAddress(scheme, host, port)
        }

        fun from(typed: String): SaathiAddress? {
            val text = typed.trim()
            if (text.isEmpty() || text.any { it.isWhitespace() || it.isISOControl() }) return null
            return parse(if ("://" in text) text else "https://$text")
        }

        fun startPage(typed: String): String? {
            val address = from(typed) ?: return null
            val text = typed.trim().let { if ("://" in it) it else "https://$it" }
            val uri = try {
                URI(text)
            } catch (_: Exception) {
                return null
            }
            val code = uri.rawQuery?.split("&")?.firstOrNull { it.startsWith("code=") }?.removePrefix("code=")
            return when {
                uri.path == "/device.html" && code != null && code.matches(Regex("^\\d{6}$")) -> address.page("/device.html?code=$code")
                uri.path in setOf("/device.html", "/alexa.html", "/family.html", "/login.html") -> address.page(uri.path)
                else -> address.page("/")
            }
        }
    }
}
