package com.senku.app.agent

import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

/** OpenAI Responses API. Stateless: every request carries the whole context (CLAUDE.md). */
class LlmClient(private val proxy: AgentProxy) {

  class ToolCall(val name: String, val arguments: JSONObject)

  fun nextAction(model: String, effort: String?, instructions: String, input: String, tools: JSONArray): ToolCall {
    val body =
        JSONObject()
            .put("operation", if (instructions == AgentTools.PLAN_PROMPT) "plan" else "action")
            .put("context", input)
            .put("tools", tools)
            .put("instructions", instructions)

    val response = proxy.call("openai", body)
    val output = response.optJSONArray("output") ?: JSONArray()
    for (i in 0 until output.length()) {
      val item = output.getJSONObject(i)
      if (item.optString("type") == "function_call") {
        return ToolCall(item.getString("name"), JSONObject(item.optString("arguments", "{}")))
      }
    }
    throw IOException("model returned no tool call (status ${response.optString("status")})")
  }

}
