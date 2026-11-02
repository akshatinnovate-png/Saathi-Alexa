package com.senku.app.agent

import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

object GeminiBrain {
  private val MODELS = listOf("gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.0-flash")
  private const val BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
  private const val GIVE_UP_MS = 15 * 60 * 1000L

  @Volatile private var model = 0
  @Volatile private var key = 0
  @Volatile private var fullSchema = true

  fun action(keys: List<String>, body: JSONObject): JSONObject {
    val instructions = body.optString("instructions")
    val context = body.optString("context")
    val tools = body.optJSONArray("tools") ?: JSONArray()
    val response = generate(keys) { full ->
      val decls = JSONArray()
      for (i in 0 until tools.length()) {
        val t = tools.getJSONObject(i)
        val params = t.optJSONObject("parameters") ?: JSONObject().put("type", "object").put("properties", JSONObject())
        val d = JSONObject().put("name", t.getString("name")).put("description", t.optString("description"))
        if (full) d.put("parametersJsonSchema", params) else d.put("parameters", sanitize(params))
        decls.put(d)
      }
      JSONObject()
          .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", instructions))))
          .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", context)))))
          .put("tools", JSONArray().put(JSONObject().put("functionDeclarations", decls)))
          .put("toolConfig", JSONObject().put("functionCallingConfig", JSONObject().put("mode", "ANY")))
          .put("generationConfig", JSONObject().put("temperature", 0.2))
    }
    val parts = response.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
    val output = JSONArray()
    for (i in 0 until parts.length()) {
      val call = parts.getJSONObject(i).optJSONObject("functionCall") ?: continue
      output.put(JSONObject().put("type", "function_call").put("name", call.getString("name")).put("arguments", (call.optJSONObject("args") ?: JSONObject()).toString()))
      break
    }
    return JSONObject().put("status", if (output.length() > 0) "completed" else "incomplete").put("output", output)
  }

  fun choose(keys: List<String>, body: JSONObject): JSONObject {
    val state = body.optJSONObject("state") ?: JSONObject()
    val questions = body.optJSONObject("questions") ?: JSONObject()
    val ids = questions.keys().asSequence().toList()
    val optionsOf = ids.associateWith { id ->
      val q = questions.getJSONObject(id)
      val opts = q.optJSONObject("options") ?: q
      opts.keys().asSequence().filter { it != "instructions" }.associateWith { opts.optString(it) }
    }
    val prompt = buildString {
      append("You make decisions for an agent that operates an Android phone for the user. Read the STATE and answer every question by choosing exactly one option key.\n\nSTATE:\n")
      append(state.toString().take(60_000))
      append("\n\nQUESTIONS:\n")
      for (id in ids) {
        val q = questions.getJSONObject(id)
        append("- ").append(id)
        q.optString("instructions").takeIf { it.isNotBlank() }?.let { append(": ").append(it) }
        append("\n  Options:\n")
        for ((k, v) in optionsOf.getValue(id)) append("    ").append(k).append(": ").append(v).append('\n')
      }
    }
    val schema = JSONObject().put("type", "object").put("required", JSONArray(ids)).put("properties", JSONObject().also { p ->
      for (id in ids) p.put(id, JSONObject().put("type", "string").put("enum", JSONArray(optionsOf.getValue(id).keys.toList())))
    })
    val response = generate(keys) { full ->
      val generation = JSONObject().put("temperature", 0.1).put("responseMimeType", "application/json")
      if (full) generation.put("responseJsonSchema", schema) else generation.put("responseSchema", sanitize(schema))
      JSONObject()
          .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", prompt)))))
          .put("generationConfig", generation)
    }
    val text = response.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
        ?.let { parts -> (0 until parts.length()).joinToString("") { parts.getJSONObject(it).optString("text") } }.orEmpty()
    val picked = runCatching { JSONObject(text.trim().removePrefix("```json").removeSuffix("```").trim()) }.getOrDefault(JSONObject())
    val answers = JSONObject()
    for (id in ids) {
      val options = optionsOf.getValue(id).keys.toList()
      val choice = picked.optString(id).takeIf { it in options } ?: options.firstOrNull().orEmpty()
      answers.put(id, JSONObject().put("choice", choice).put("probabilities", JSONObject().put(choice, 1.0)))
    }
    return JSONObject().put("answers", answers)
  }

  private fun sanitize(schema: JSONObject): JSONObject {
    val out = JSONObject()
    for (k in schema.keys()) {
      when (k) {
        "additionalProperties", "strict", "\$schema" -> {}
        "properties" -> {
          val props = schema.getJSONObject(k)
          out.put(k, JSONObject().also { p -> for (pk in props.keys()) p.put(pk, sanitize(props.getJSONObject(pk))) })
        }
        "items" -> out.put(k, sanitize(schema.getJSONObject(k)))
        else -> out.put(k, schema.get(k))
      }
    }
    return out
  }

  private fun generate(keys: List<String>, build: (Boolean) -> JSONObject): JSONObject {
    val started = System.currentTimeMillis()
    var failures = 0
    var deadKeys = 0
    while (true) {
      val k = keys[Math.floorMod(key, keys.size)]
      val m = MODELS[Math.floorMod(model, MODELS.size)]
      try {
        return requestJson("Gemini", "POST", "$BASE$m:generateContent", k, build(fullSchema), 120_000, "x-goog-api-key")
      } catch (e: ApiException) {
        val text = e.body.lowercase()
        when {
          e.status == 400 && (text.contains("parametersjsonschema") || text.contains("responsejsonschema") || text.contains("unknown name")) && fullSchema -> { fullSchema = false; continue }
          e.status == 404 || (e.status == 400 && text.contains("model")) -> { model++; continue }
          e.status == 401 || e.status == 403 || (e.status == 400 && text.contains("api key")) -> {
            deadKeys++
            if (deadKeys >= keys.size) throw e
            key++
            continue
          }
          e.status == 429 -> { if (keys.size > 1) key++ else model++ }
        }
      } catch (_: IOException) {
      }
      failures++
      if (System.currentTimeMillis() - started > GIVE_UP_MS) throw IOException("Gemini stayed busy for 15 minutes")
      Thread.sleep(minOf(60_000L, 1000L shl minOf(failures, 6)))
    }
  }
}
