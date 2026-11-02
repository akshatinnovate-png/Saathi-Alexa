package com.senku.app.agent

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** A non-2xx response from a model API. [service] names it in the message ("OpenAI", "Jev"). */
class ApiException(service: String, val status: Int, val body: String) :
    Exception("$service HTTP $status: ${responseMessage(body).take(400)}")

private fun responseMessage(body: String): String = try {
  JSONObject(body).optString("message").ifBlank { body }
} catch (_: Exception) { body }

/**
 * JSON over HTTPS. The key goes in [keyHeader] when set (Gemini's `x-goog-api-key`), otherwise as
 * a bearer token. Retries 429, 5xx and I/O errors, 3 attempts in all.
 */
fun requestJson(
    service: String,
    method: String,
    url: String,
    apiKey: String,
    body: JSONObject?,
    readTimeoutMs: Int = 180_000,
    keyHeader: String? = null,
): JSONObject {
  var attempt = 0
  while (true) {
    attempt++
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = 15_000
      conn.readTimeout = readTimeoutMs
      if (keyHeader != null) conn.setRequestProperty(keyHeader, apiKey)
      else conn.setRequestProperty("Authorization", "Bearer $apiKey")
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      val status = conn.responseCode
      val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
      if (status in 200..299) return JSONObject(text)
      val retryable = status == 429 || status >= 500
      if (!retryable || attempt >= 3) throw ApiException(service, status, text)
    } catch (e: IOException) {
      if (attempt >= 3) throw e
    } finally {
      conn.disconnect()
    }
    Thread.sleep(1000L * attempt * attempt)
  }
}
