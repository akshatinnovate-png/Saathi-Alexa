package com.senku.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SupabaseAuth(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("sahay_keys", Context.MODE_PRIVATE)

    val email: String? get() = if (isSignedIn) "Your own Gemini key${if (geminiKeys().size > 1) "s (${geminiKeys().size})" else ""}" else null
    val isSignedIn: Boolean get() = prefs.contains("gemini_keys")

    fun saveGeminiKeys(text: String): Int {
        val keys = text.split(',', ' ', '\n', ';', '\t').map { it.trim() }.filter { it.length >= 20 && it.all { c -> c.isLetterOrDigit() || c == '-' || c == '_' } }.distinct()
        if (keys.isEmpty()) throw IllegalArgumentException("That does not look like a Gemini API key. It usually starts with AIza.")
        prefs.edit().putString("gemini_keys", encrypt(keys.joinToString(","))).apply()
        return keys.size
    }

    fun geminiKeys(): List<String> = prefs.getString("gemini_keys", null)
        ?.let { runCatching { decrypt(it) }.getOrNull() }
        ?.split(',')?.filter { it.isNotBlank() }.orEmpty()

    fun signOut() { prefs.edit().clear().apply() }

    fun mintGeminiToken(): String {
        val key = geminiKeys().firstOrNull() ?: throw IllegalStateException("Add your Gemini key first")
        val session = UUID.randomUUID().toString()
        prefs.edit().putString("voice_session_id", session).apply()
        return JSONObject()
            .put("token", key)
            .put("key", true)
            .put("keys", org.json.JSONArray(geminiKeys()))
            .put("session_id", session)
            .toString()
    }

    fun voiceSessionId(): String = prefs.getString("voice_session_id", "").orEmpty()

    fun freshAccessToken(): String = geminiKeys().firstOrNull() ?: throw IllegalStateException("Add your Gemini key first")

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("sahay_keys", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("sahay_keys", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}
