package com.senku.app.agent

import org.json.JSONArray
import org.json.JSONObject

/** The model's only API, plus the prompt that explains it. */
object AgentTools {

  val SYSTEM_PROMPT =
      """
      You are Sahay. You operate an Android phone to complete the user's goal.
      You see the screen only as an accessibility tree: a JSON list of on-screen elements, each
      with an id. Each turn, call exactly one tool.

      - Element ids are only valid for the current screen. After every action the screen is read
        again and ids change.
      - Open apps with launch_app, using the app's name or package.
      - To enter text: click the text field first if it isn't focused, then type, then submit to
        press enter / search.
      - Clickable elements with no text of their own show their children's text as "label".
      - If the screen is empty or still loading, wait.
      - You never see earlier screens again. Save anything you will need later with note.
      - Get past first-run screens, update prompts and permission dialogs in whatever way best
        serves the goal.
      - Never invent personal data: phone numbers, names, emails, addresses, dates of birth,
        codes, passwords.
      - When the goal is done, call finish with status "success" and a summary that answers the
        user. If it can't be done, finish with "failed". If only the user can unblock it
        (personal data the goal doesn't give, login, OTP, captcha, payment), finish with
        "blocked" and say what is needed.
      """
          .trimIndent()

  /** For the one GPT call that turns the goal into a plan. */
  val PLAN_PROMPT =
      """
      You plan tasks for an agent that operates an Android phone one tap, scroll or text entry at a
      time. A fast executor follows your plan step by step; it can't think beyond it, so be concrete.
      Turn the user's goal into a short numbered list of on-screen steps:
      - Start with the app the goal needs. If the goal names one, use it. Otherwise pick, from
        INSTALLED APPS, the one that can actually answer the goal: prices and products need a
        shopping or delivery app that shows them, not a recipe or fitness app. When the goal asks
        for the cheapest or best option and several installed apps could answer it, check the two
        most relevant.
      - Only if no installed app can do it, start by installing the most relevant one: open Play
        Store, search for it by name, tap Install, wait for it, then tap Open.
      - Name the buttons, fields and items to look for, as the app most likely labels them.
      - Say how to tell the right item from similar ones (a person, not a group or community).
      - Give any text to type exactly, in quotes.
      - End with what the screen shows once the goal is done.
      Keep it under 10 steps, and don't add steps the goal doesn't need.
      For every step that types, put the exact text in that step's types field, written out in full:
      search terms and names ("Steve") as well as messages (the whole message, not "a greeting").
      The executor types it without asking you again. Leave types empty for steps that type nothing,
      for text that depends on what the screen will show, such as a code or a reply, and for
      anything personal the goal doesn't give (phone number, OTP, name, email, address). types is
      only ever literal text to type, never an instruction.
      """
          .trimIndent()

  /** For Jev's replan: the agent went off track partway through the task. */
  val REPLAN_PROMPT =
      """
      You plan tasks for an agent that operates an Android phone one tap, scroll or text entry at a
      time, and it has gone off track: the executor says its plan no longer fits the CURRENT SCREEN,
      or its last steps led back to a screen it had already seen. Write a new plan from the current
      screen to the goal: concrete on-screen steps that name the buttons, fields and items as the app
      labels them. Don't repeat what STEPS SO FAR shows didn't work. Put the exact text a step types in
      its types field, and leave types empty otherwise, including for anything personal the goal
      doesn't give.
      If the screen asks the user to sign in, log in or create an account and the goal needs it (a
      cart, checkout or account that won't go on without it), set sign_in to true and leave steps
      empty: the user signs in themselves, and the executor carries on with the plan once they have.
      Don't plan around it and don't search or browse again. Otherwise set sign_in to false.
      Use ask_user only when the goal can't go on without the user's say or something only they can
      do (a captcha, a fingerprint); otherwise leave it empty.
      """
          .trimIndent()

  val planSchema: JSONArray by lazy {
    JSONArray()
        .put(
            tool(
                "write_plan",
                "Write the plan for the executor.",
                "steps" to
                    objects(
                        "The steps, in order",
                        "do" to str("One concrete on-screen step"),
                        "types" to str("The exact text this step types, or \"\" if it types nothing"))))
  }

  /** For [REPLAN_PROMPT]: a new plan from the current screen, or a question for the user first. */
  val replanSchema: JSONArray by lazy {
    JSONArray()
        .put(
            tool(
                "rewrite_plan",
                "Rewrite the plan from the current screen, or ask the user how to go on.",
                "steps" to
                    objects(
                        "The new steps from the current screen, in order; none when ask_user or sign_in is set",
                        "do" to str("One concrete on-screen step"),
                        "types" to str("The exact text this step types, or \"\" if it types nothing")),
                "ask_user" to
                    str(
                        "A question for the user when the task can't go on without them, such as \"The site wants " +
                            "a captcha solved. Can you solve it on the screen? I'll carry on once it's done.\", or \"\""),
                "sign_in" to
                    bool("True when the screen is a sign-in or sign-up wall the goal can't get past until the user signs in")))
  }

  /** [plan] is GPT's plan; [hint] comes from Jev when it hands a step to GPT. */
  fun userMessage(
      goal: String,
      stepLog: List<String>,
      notes: List<String>,
      screen: String,
      hint: String? = null,
      plan: List<String> = emptyList(),
  ): String =
      buildString {
        append("GOAL: ").append(goal).append("\n\n")
        if (plan.isNotEmpty()) {
          append("PLAN:\n")
          plan.forEachIndexed { i, step -> append(i + 1).append(". ").append(step).append('\n') }
          append('\n')
        }
        append("STEPS SO FAR:\n")
        if (stepLog.isEmpty()) append("(none yet)\n") else stepLog.forEach { append(it).append('\n') }
        append("\nNOTES:\n")
        if (notes.isEmpty()) append("(none)\n") else notes.forEach { append("- ").append(it).append('\n') }
        append("\nCURRENT SCREEN:\n").append(screen)
        if (hint != null) append("\n\nEXECUTOR NOTE: ").append(hint)
      }

  /** [schema] limited to the named tools. */
  fun schemaOf(vararg names: String): JSONArray =
      JSONArray((0 until schema.length()).map { schema.getJSONObject(it) }.filter { it.getString("name") in names })

  /**
   * [schema] plus sign_in, for GPT deciding whole steps in tasks from Gemini Live: a sign-in or sign-up
   * wall, which the user gets past themselves while Senku waits (see AgentLoop.coachSignIn).
   */
  val schemaWithSignIn: JSONArray by lazy {
    JSONArray((0 until schema.length()).map { schema.getJSONObject(it) })
        .put(
            action(
                JevDecider.SIGN_IN,
                "The screen won't let the task go on until the user signs in, logs in or creates an account; " +
                    "they do it themselves while Sahay waits, then the task carries on."))
  }

  val schema: JSONArray by lazy {
    JSONArray()
        .put(action("launch_app", "Open an installed app by its name or package.", "app" to str("App name or package")))
        .put(action("click", "Tap an element. Non-clickable elements tap their nearest clickable parent.", "node_id" to int()))
        .put(action("type", "Replace the text in an editable element.", "node_id" to int(), "text" to str("Text to enter")))
        .put(action("submit", "Press the keyboard's enter/search key in a text field.", "node_id" to int()))
        .put(
            action(
                "scroll",
                "Scroll a scrollable element (or its nearest scrollable parent).",
                "node_id" to int(),
                "direction" to enumOf("forward = down/right, backward = up/left", "forward", "backward"),
            ))
        .put(action("back", "Press the system Back button."))
        .put(action("home", "Go to the home screen."))
        .put(action("wait", "Wait for the screen to load or change.", "seconds" to int("1 to 30")))
        .put(action("note", "Save a fact you will need later; notes are shown every turn.", "text" to str("The fact")))
        .put(
            action(
                "finish",
                "End the task.",
                "status" to enumOf("Outcome", "success", "failed", "blocked"),
                "summary" to str("What happened, answering the user's goal"),
            ))
  }

  /**
   * A tool GPT acts with. `why` comes first, so GPT writes its reason before the arguments; it's
   * traced as gptWhy and kept out of step lines.
   */
  private fun action(name: String, description: String, vararg params: Pair<String, JSONObject>) =
      tool(name, description, "why" to str("One short sentence: why this action, now"), *params)

  private fun tool(name: String, description: String, vararg params: Pair<String, JSONObject>) =
      JSONObject()
          .put("type", "function")
          .put("name", name)
          .put("description", description)
          .put("strict", true)
          .put(
              "parameters",
              JSONObject()
                  .put("type", "object")
                  .put("properties", JSONObject().also { p -> params.forEach { p.put(it.first, it.second) } })
                  .put("required", JSONArray(params.map { it.first }))
                  .put("additionalProperties", false))

  private fun str(description: String) =
      JSONObject().put("type", "string").put("description", description)

  private fun bool(description: String) =
      JSONObject().put("type", "boolean").put("description", description)

  /** An array of objects with the given string fields, all required (strict mode). */
  private fun objects(description: String, vararg fields: Pair<String, JSONObject>) =
      JSONObject()
          .put("type", "array")
          .put("description", description)
          .put(
              "items",
              JSONObject()
                  .put("type", "object")
                  .put("properties", JSONObject().also { p -> fields.forEach { p.put(it.first, it.second) } })
                  .put("required", JSONArray(fields.map { it.first }))
                  .put("additionalProperties", false))

  private fun int(description: String = "Element id from the current screen") =
      JSONObject().put("type", "integer").put("description", description)

  private fun enumOf(description: String, vararg values: String) =
      JSONObject().put("type", "string").put("description", description).put("enum", JSONArray(values.toList()))
}
