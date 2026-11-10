package io.github.akshatinnovate.saathi.shield

data class ShieldConfig(val enabled: Boolean, val language: String, val modelUrl: String?, val modelSha256: String?, val modelBytes: Long?) {
    companion object {
        private val enabledField = Regex("\"enabled\"\\s*:\\s*(true|false)")
        private val languageField = Regex("\"language\"\\s*:\\s*\"([a-z]{2,3})\"")
        private val modelBlock = Regex("\"model\"\\s*:\\s*\\{([^}]*)\\}")
        private val urlField = Regex("\"url\"\\s*:\\s*\"([^\"]+)\"")
        private val shaField = Regex("\"sha256\"\\s*:\\s*\"([a-f0-9]{64})\"")
        private val bytesField = Regex("\"bytes\"\\s*:\\s*(\\d+)")

        fun parse(json: String?): ShieldConfig? {
            if (json.isNullOrBlank()) return null
            val enabled = enabledField.find(json)?.groupValues?.get(1) == "true"
            val language = languageField.find(json)?.groupValues?.get(1) ?: "en"
            val model = modelBlock.find(json)?.groupValues?.get(1)
            val url = model?.let { urlField.find(it)?.groupValues?.get(1) }?.replace("\\/", "/")
            val sha = model?.let { shaField.find(it)?.groupValues?.get(1) }
            val bytes = model?.let { bytesField.find(it)?.groupValues?.get(1)?.toLongOrNull() }
            val safeUrl = url?.takeIf { (it.startsWith("/api/") && !it.contains("..")) || it.startsWith("https://") }
            return ShieldConfig(enabled, language, if (sha != null) safeUrl else null, sha, bytes)
        }
    }
}
