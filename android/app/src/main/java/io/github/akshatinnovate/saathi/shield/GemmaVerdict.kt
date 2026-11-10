package io.github.akshatinnovate.saathi.shield

data class Verdict(val scam: Boolean, val kind: String, val confidence: Double)

object GemmaVerdict {
    val KINDS = setOf("otp", "kyc", "digital-arrest", "prize", "investment", "job", "impersonation", "link", "other")

    fun prompt(message: String): String {
        val clean = message.take(ScamRules.MAX_CHARS).replace("\"\"\"", "\"").replace("<start_of_turn>", "").replace("<end_of_turn>", "")
        return "<start_of_turn>user\n" +
            "You check messages that reach an elderly person in India for scams. Messages may be in English, Hindi, Marathi or Hinglish.\n" +
            "Scams ask for one-time codes, PINs or card details; threaten arrest or a blocked account; promise prizes, jobs or easy profit; ask to install an app or pay a fee; or pretend to be family on a new number.\n" +
            "A real bank message that only reports a payment, or an OTP that says not to share it, is not a scam.\n" +
            "Reply with JSON only, like {\"scam\": true, \"kind\": \"kyc\", \"confidence\": 0.9}. kind is one of: otp, kyc, digital-arrest, prize, investment, job, impersonation, link, other, none.\n" +
            "Message:\n\"\"\"\n" + clean + "\n\"\"\"<end_of_turn>\n<start_of_turn>model\n"
    }

    private val scamField = Regex("\"scam\"\\s*:\\s*(true|false)", RegexOption.IGNORE_CASE)
    private val kindField = Regex("\"kind\"\\s*:\\s*\"([a-z-]+)\"", RegexOption.IGNORE_CASE)
    private val confidenceField = Regex("\"confidence\"\\s*:\\s*([0-9]*\\.?[0-9]+)")

    fun parse(output: String?): Verdict? {
        if (output.isNullOrBlank()) return null
        val start = output.indexOf('{')
        val end = output.indexOf('}', start + 1)
        if (start < 0 || end < 0) return null
        val json = output.substring(start, end + 1)
        val scam = scamField.find(json)?.groupValues?.get(1)?.lowercase() ?: return null
        val kind = kindField.find(json)?.groupValues?.get(1)?.lowercase()?.takeIf { it in KINDS } ?: "other"
        val confidence = confidenceField.find(json)?.groupValues?.get(1)?.toDoubleOrNull()?.coerceIn(0.0, 1.0) ?: 0.5
        return Verdict(scam == "true", kind, confidence)
    }

    fun decide(rules: RuleResult, gemma: Verdict?): Verdict? {
        if (rules.clean) return null
        if (rules.strong) return Verdict(true, gemma?.takeIf { it.scam }?.kind ?: rules.kind, maxOf(gemma?.confidence ?: 0.0, 0.9))
        if (gemma != null) return if (gemma.scam && gemma.confidence >= GEMMA_THRESHOLD) gemma else null
        return if (rules.likely) Verdict(true, rules.kind, 0.7) else null
    }

    const val GEMMA_THRESHOLD = 0.6
}
