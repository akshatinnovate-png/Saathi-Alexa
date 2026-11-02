package com.senku.app.agent

import org.json.JSONArray
import org.json.JSONObject

/** TypeSafe's Jev decision model through Vercel AI Gateway: picks one option from a named set. */
class JevClient(private val proxy: AgentProxy) {

  companion object {
    /** Pinned so experiment runs stay comparable. */
    const val MODEL = "typesafe-ai/jev-1.14.0"
    private const val URL = "https://ai-gateway.vercel.sh/v1/evaluate"
    private const val TOP_N = 5
  }

  /** One choice question: pick one key of [options]; values describe each option. */
  class Question(val instructions: String, val options: Map<String, String>)

  /** [top] is the most likely options with their probabilities, highest first. */
  class Choice(val option: String, val probability: Double, val top: List<Pair<String, Double>>)

  /**
   * Asks all [questions] about the same [state] in one request; answers are keyed like [questions],
   * each with its [top] most likely options.
   */
  fun choose(state: JSONObject, questions: Map<String, Question>, top: Int = TOP_N): Map<String, Choice> {
    val asked = JSONObject()
    for ((id, q) in questions) {
      asked.put(
          id, JSONObject().put("instructions", q.instructions).put("options", JSONObject(q.options)))
    }
    val body =
        JSONObject()
            .put("state", state)
            .put("questions", asked)
    val answers = proxy.call("jev", body).getJSONObject("answers")
    return questions.keys.associateWith { parse(answers.getJSONObject(it), top) }
  }

  private fun parse(answer: JSONObject, topN: Int): Choice {
    val option = answer.getString("choice")
    val probabilities = answer.optJSONObject("probabilities")
    val all = probabilities?.keys()?.asSequence()?.map { it to probabilities.optDouble(it, 0.0) }?.toList().orEmpty()
    val top = all.filter { it.second > 0.0 }.sortedByDescending { it.second }.take(topN)
    return Choice(option, all.firstOrNull { it.first == option }?.second ?: 0.0, top)
  }
}
