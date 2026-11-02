package com.senku.app.agent

import android.content.Context
import com.senku.app.SupabaseAuth
import org.json.JSONObject

class AgentProxy(context: Context) {
  private val auth = SupabaseAuth(context)

  fun start(goal: String) {}

  fun finish() {}

  fun call(provider: String, body: JSONObject): JSONObject {
    val keys = auth.geminiKeys()
    if (keys.isEmpty()) throw IllegalStateException("Add your Gemini key in Sahay first")
    return when (provider) {
      "openai" -> GeminiBrain.action(keys, body)
      "jev" -> GeminiBrain.choose(keys, body)
      else -> throw IllegalArgumentException("Unknown model service $provider")
    }
  }
}
