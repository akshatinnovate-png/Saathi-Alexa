package io.github.akshatinnovate.saathi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SaathiAddressTest {

    @Test
    fun aTypedNameBecomesAnHttpsAddress() {
        assertEquals("https://aaji-pc.tail1a2b.ts.net", SaathiAddress.from("aaji-pc.tail1a2b.ts.net")?.origin)
        assertEquals("https://saathi.example.org", SaathiAddress.from("  HTTPS://Saathi.Example.org/family.html  ")?.origin)
        assertEquals("https://saathi.example.org:8443", SaathiAddress.from("https://saathi.example.org:8443/")?.origin)
    }

    @Test
    fun plainHttpIsOnlyForThisDeviceOrTheEmulator() {
        assertNull(SaathiAddress.from("http://saathi.example.org"))
        assertNull(SaathiAddress.from("http://192.168.1.20:8787"))
        assertEquals("http://10.0.2.2:8787", SaathiAddress.from("http://10.0.2.2:8787")?.origin)
        assertEquals("http://localhost:8787", SaathiAddress.from("http://localhost:8787")?.origin)
    }

    @Test
    fun trickAddressesAreRefused() {
        for (bad in listOf(
            "", "   ", "javascript:alert(1)", "file:///sdcard/x.html", "content://x/y", "intent://x#Intent;end",
            "https://user:pass@saathi.example.org", "https://saathi.example.org@evil.example", "https://evil .example",
            "https://", "https://-bad-.example", "https://999.1.1.1", "ftp://saathi.example.org",
            "https://saathi.example.org:0", "https://saathi.example.org\n.evil.example",
        )) {
            assertNull(bad, SaathiAddress.from(bad))
        }
    }

    @Test
    fun theAppOnlyStaysOnItsOwnSaathi() {
        val home = SaathiAddress.from("https://saathi.example.org")!!
        assertTrue(home.owns("https://saathi.example.org/family.html#assistant"))
        assertTrue(home.owns("https://SAATHI.example.org:443/alexa.html"))
        assertFalse(home.owns("http://saathi.example.org/"))
        assertFalse(home.owns("https://saathi.example.org:8443/"))
        assertFalse(home.owns("https://saathi.example.org.evil.example/"))
        assertFalse(home.owns("https://evil.example/?saathi.example.org"))
        assertFalse(home.owns("https://saathi.example.org@evil.example/"))
        assertFalse(home.owns("javascript:alert(document.cookie)"))
        assertFalse(home.owns(null))
    }

    @Test
    fun aPairingLinkOpensTheDeviceScreenWithItsCode() {
        assertEquals("https://saathi.example.org/device.html?code=482913", SaathiAddress.startPage("https://saathi.example.org/device.html?code=482913"))
        assertEquals("https://saathi.example.org/device.html", SaathiAddress.startPage("https://saathi.example.org/device.html?code=48291x"))
        assertEquals("https://saathi.example.org/family.html", SaathiAddress.startPage("saathi.example.org/family.html"))
        assertEquals("https://saathi.example.org/", SaathiAddress.startPage("saathi.example.org/../../etc/passwd"))
        assertNull(SaathiAddress.startPage("http://evil.example/device.html?code=123456"))
    }
}
