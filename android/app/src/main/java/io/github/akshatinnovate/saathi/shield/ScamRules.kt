package io.github.akshatinnovate.saathi.shield

import java.util.Locale

data class RuleResult(val score: Int, val kind: String) {
    val clean: Boolean get() = score <= 0
    val strong: Boolean get() = score >= STRONG
    val likely: Boolean get() = score >= LIKELY

    companion object {
        const val LIKELY = 3
        const val STRONG = 5
    }
}

object ScamRules {
    private class Signal(val kind: String, val weight: Int, val patterns: List<Regex>)

    private fun rx(vararg p: String) = p.map { Regex(it, setOf(RegexOption.IGNORE_CASE)) }

    private val signals = listOf(
        Signal("otp", 3, rx(
            "(share|send|tell|give|forward|read out)\\b.{0,40}\\b(otp|code|pin|cvv|password)",
            "(otp|code|pin|cvv)\\b.{0,40}\\b(share|send|tell|give|forward)\\b(?!.{0,12}(anyone|nobody|no one))",
            "ओटीपी.{0,30}(बताएं|बताइए|भेजें|शेयर)", "ओटीपी.{0,30}(सांगा|पाठवा)",
        )),
        Signal("kyc", 3, rx(
            "\\b(kyc|pan|aadhaa?r)\\b.{0,40}\\b(update|expire|expired|pending|verify|link)",
            "\\b(account|card|sim|wallet|electricity|connection)\\b.{0,30}\\b(blocked|suspended|deactivated|disconnected|closed|frozen)",
            "केवाईसी", "खाता.{0,20}(बंद|ब्लॉक)", "बिजली.{0,20}(कट|बंद)", "खाते.{0,20}(बंद|ब्लॉक)",
        )),
        Signal("digital-arrest", 5, rx(
            "digital(ly)?\\s+arrest", "\\b(cbi|ncb|customs|cyber ?cell|narcotics|trai)\\b", "arrest\\s+warrant", "\\bcourt\\b.{0,30}\\b(case|notice|summons)",
            "money laundering", "गिरफ्तार", "अटक वॉरंट", "डिजिटल अरेस्ट",
        )),
        Signal("prize", 3, rx(
            "\\b(won|winner|win)\\b.{0,30}\\b(prize|lottery|lucky draw|car|crore|lakh|reward)", "\\bkbc\\b", "\\blottery\\b", "claim (your )?(reward|prize|cashback|refund)",
            "लॉटरी", "इनाम", "बक्षीस", "जीत(ा|े) हैं",
        )),
        Signal("investment", 3, rx(
            "guaranteed (returns|profit)", "\\b(double|triple) your money", "stock (tips|market) (group|expert)", "\\bcrypto\\b.{0,30}\\b(profit|returns|invest)",
            "\\d+%\\s*(daily|weekly|monthly) (returns|profit)",
        )),
        Signal("job", 3, rx(
            "part[- ]time job", "work from home.{0,40}(earn|₹|rs\\.?|rupees)", "earn (₹|rs\\.?)\\s?\\d", "(like|subscribe).{0,20}(youtube|videos).{0,30}(earn|pay|₹)",
            "घर बैठे.{0,30}(कमाएं|कमाई)",
        )),
        Signal("impersonation", 3, rx(
            "(this is|it'?s) my new (number|phone)", "\\bnew number\\b.{0,40}\\b(mum|mom|mummy|papa|dad|aai|aaji|nani|dadi)", "(mum|mom|mummy|papa|dad|aai|aaji|nani|dadi)\\b.{0,40}\\bnew number",
            "मेरा नया नंबर", "माझा नवीन नंबर",
        )),
        Signal("other", 2, rx(
            "\\b(anydesk|teamviewer|quick ?support|rustdesk)\\b", "(install|download)\\b.{0,20}\\b(app|apk)\\b", "\\.apk\\b",
            "\\b(pay|transfer|deposit|send)\\b.{0,30}\\b(fee|charges|amount|money|₹|rs\\.?)",
        )),
    )

    private val link = Regex("(https?://|www\\.|bit\\.ly|tinyurl|wa\\.me|t\\.me/|\\b[a-z0-9-]+\\.(xyz|top|click|link|info|online|site|buzz|live)\\b)", RegexOption.IGNORE_CASE)
    private val urgency = rx(
        "\\b(immediately|urgent|urgently|today|within \\d+ (hours?|minutes?)|last (chance|day|warning)|act now|final notice)\\b",
        "तुरंत", "आज ही", "लगेच", "आजच",
    )
    private val safeOtp = rx(
        "(do not|don'?t|never|not to)\\s+(share|disclose|tell)", "(बताएं नहीं|साझा न करें|शेयर न करें|कोणालाही सांगू नका|शेअर करू नका)",
    )
    private val otpDigits = Regex("\\b\\d{4,8}\\b")

    fun assess(raw: String): RuleResult {
        val text = raw.take(MAX_CHARS).lowercase(Locale.ROOT)
        if (text.isBlank()) return RuleResult(0, "none")
        var score = 0
        var best: Signal? = null
        for (signal in signals) {
            if (signal.patterns.any { it.containsMatchIn(text) }) {
                score += signal.weight
                if (best == null || signal.weight > best.weight) best = signal
            }
        }
        val hasLink = link.containsMatchIn(text)
        if (hasLink) score += 1
        if (urgency.any { it.containsMatchIn(text) }) score += 1
        val looksLikeRealOtp = safeOtp.any { it.containsMatchIn(text) } && otpDigits.containsMatchIn(text) && best?.kind == "otp"
        if (looksLikeRealOtp) score -= 4
        if (best == null && hasLink && score >= 2) return RuleResult(score, "link")
        if (score <= 0) return RuleResult(0, "none")
        return RuleResult(score, best?.kind ?: "link")
    }

    const val MAX_CHARS = 1000
}
