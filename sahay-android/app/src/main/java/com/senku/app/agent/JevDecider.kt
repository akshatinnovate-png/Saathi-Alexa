package com.senku.app.agent

import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Jev half of the "Jev + GPT" decider. Turns the screen into named options for Jev, and
 * Jev's top pick, whatever its probability, into a tool call. Text comes from the plan when Jev
 * matches one of its texts to the field; the app to open comes from the launcher list Jev picks
 * from. GPT only writes what those lack, or acts when Jev is stuck.
 */
object JevDecider {

  /** Question ids in the Jev request. */
  const val ACTION = "next_action"
  const val TEXT = "text_to_type"
  const val APP = "app_to_open"
  /** Where Jev is in the plan, for Gemini Live's per-step progress. */
  const val PLAN_STEP = "plan_step"
  /** Asked in a second request, only after Jev picks `ask_user` (tasks from Gemini Live). */
  const val REASON = "ask_reason"
  const val ITEM = "decision_item"
  /** Asked on each new screen while the task waits on the user (see AgentLoop.waitForUser). */
  const val WAIT_STATE = "wait_state"

  /** Jev's option for a sign-in or sign-up wall (tasks from Gemini Live): the user gets past it themselves. */
  const val SIGN_IN = "sign_in"

  const val APP_INSTRUCTIONS =
      "If the next action opens an app, which app does the plan need? Pick other if it isn't listed."

  /** A choice question takes at most 255 options; one is `other`. */
  private const val MAX_APPS = 254

  const val TEXT_INSTRUCTIONS =
      "If the next action types into a field, which of these texts from the plan goes into it now? " +
          "state.steps_so_far shows what has already been typed. Pick other if the field needs text that " +
          "isn't listed."

  const val PLAN_STEP_INSTRUCTIONS =
      "Which step of state.plan does the next action carry out? Pick the number of the next unfinished " +
          "step; state.steps_so_far shows what is done."

  /** Past steps sent to Jev; the gateway gives Jev a 32K-token context. */
  private const val MAX_HISTORY = 20

  /** Jev noticing the plan has gone wrong: GPT or Gemini Live writes a new one (see AgentLoop.replan). */
  private const val REPLAN_RULE =
      "Pick replan when the plan has gone off track: the screen wants something the plan doesn't cover, " +
          "such as signing in, or state.back_again says the steps since led back to this screen. "

  const val INSTRUCTIONS =
      "You operate an Android phone to complete the goal by following state.plan in order. " +
          "state.steps_so_far shows what has been done; pick the single action that carries out the next " +
          "unfinished plan step. state.screen is the current screen as an accessibility tree; option names " +
          "refer to its element ids. Pick done only when the plan's last step is complete and the goal is " +
          "visibly achieved. Pick stuck if no option helps, if the screen offers a choice the goal and plan " +
          "don't settle (several similar contacts or addresses), or if a step needs the user (captcha, " +
          "fingerprint). " + REPLAN_RULE + "state.already_tried_here, when present, lists actions already taken on this same " +
          "screen that didn't get past it; they aren't offered again, so try something else."

  /** [REPLAN_RULE] where Jev can pick sign_in, which covers sign-in screens instead. */
  private const val ASK_REPLAN_RULE =
      "Pick replan when the plan has gone off track: the screen wants something the plan doesn't cover, " +
          "such as an error or a step that didn't do what it should, or state.back_again says the steps since " +
          "led back to this screen. "

  /** [INSTRUCTIONS] for tasks from Gemini Live, where the user can be asked through it. */
  const val ASK_INSTRUCTIONS =
      "You operate an Android phone to complete the goal by following state.plan in order. " +
          "state.steps_so_far shows what has been done; pick the single action that carries out the next " +
          "unfinished plan step. state.screen is the current screen as an accessibility tree; option names " +
          "refer to its element ids. Pick ask_user when the screen offers several items that fit the goal and " +
          "the plan doesn't say which one (similar products, contacts, addresses), when the next step needs a " +
          "detail only the user knows, or when the next tap would buy, pay, send, book or delete and the plan " +
          "doesn't say the user approved it. Pick sign_in when the screen won't let the task go on until the " +
          "user signs in, logs in, verifies their phone or email, or creates an account: the user does that " +
          "themselves, so never type into or tap a sign-in or sign-up screen. Pick done only when the plan's " +
          "last step is complete and the goal is visibly achieved. Pick stuck if no option helps or a step " +
          "needs the user to act (captcha, fingerprint). " + ASK_REPLAN_RULE + "state.already_tried_here, when " +
          "present, lists actions already taken on this same screen that didn't get past it; they aren't " +
          "offered again, so try something else."

  const val WAIT_STATE_INSTRUCTIONS =
      "The task paused for the user; state.waiting_for says why. Look at state.screen: has the phone moved " +
          "past that, so the task can go on with state.plan? Scrolling, typing into a field or a loading screen " +
          "isn't moving past it."

  val waitStateOptions: Map<String, String> =
      linkedMapOf(
          "still_waiting" to
              "the screen still asks for what state.waiting_for describes, or is loading (for signing in: still a " +
                  "sign-in, sign-up, verification code, consent or PIN screen)",
          "moved_on" to
              "the phone moved past it: the user did it themselves, and the app shows what comes after (its " +
                  "normal content again, the next step of the task, or a confirmation)")

  const val REASON_INSTRUCTIONS =
      "The executor stopped to ask the user before carrying out the next unfinished step of state.plan. Why?"

  val reasonOptions: Map<String, String> =
      linkedMapOf(
          "multiple_products" to "several products or items fit the goal and the plan doesn't say which",
          "multiple_contacts" to "several people, chats or groups fit and the plan doesn't say which",
          "multiple_options" to "several other choices fit (addresses, places, sizes, times, plans)",
          "missing_detail" to "a detail only the user knows is missing (a quantity, a preference, text to type)",
          "confirm_action" to "the next tap buys, pays, sends, books or deletes, and the plan doesn't say the user approved it",
          "needs_user" to "the user has to act themselves (login, OTP, captcha, fingerprint)",
          "other" to "another reason")

  const val ITEM_INSTRUCTIONS =
      "The executor stopped to ask the user before carrying out the next unfinished step of state.plan. " +
          "Which on-screen item is the user's decision about? With several similar items, each one of them " +
          "is; before buying, paying, sending or deleting, it's the button that does it. Pick none if no " +
          "on-screen item is."

  /** Items Jev gives at least this probability become the decision's options. */
  private const val MIN_ITEM_PROBABILITY = 0.05
  private const val MAX_OPTIONS = 6
  /** What Gemini Live gets of the rest of the screen with a decision. */
  private const val MAX_SCREEN_ITEMS = 40
  private const val MAX_SCREEN_CHARS = 2500
  /** Items before a decision's first option that still go with it, such as the title above a price. */
  private const val ITEMS_BEFORE_OPTIONS = 12
  private const val MAX_ITEM_TEXT = 120
  /** What Gemini Live gets of the screen with each step's progress: up to 30 steps per task. */
  const val PROGRESS_SCREEN_ITEMS = 15
  const val PROGRESS_SCREEN_CHARS = 600

  sealed class Plan {
    class Run(val call: LlmClient.ToolCall) : Plan()

    /** GPT fills in the call; [nodeId], when set, overrides the element GPT names. */
    class AskGpt(val tools: JSONArray, val hint: String?, val nodeId: Int? = null) : Plan()
  }

  /**
   * [triedHere] is set when Jev is asked again after repeating itself on this screen, and [waitingFor]
   * while the task waits on the user.
   */
  fun state(
      goal: String,
      plan: List<String>,
      stepLog: List<String>,
      notes: List<String>,
      screenJson: String,
      triedHere: List<String> = emptyList(),
      backAgain: String? = null,
      waitingFor: String? = null,
  ): JSONObject =
      JSONObject()
          .put("goal", goal)
          .put("plan", JSONArray(plan.mapIndexed { i, step -> "${i + 1}. $step" }))
          .put("steps_so_far", JSONArray(stepLog.takeLast(MAX_HISTORY)))
          .put("notes", JSONArray(notes))
          .put("screen", JSONObject(screenJson))
          .also { if (triedHere.isNotEmpty()) it.put("already_tried_here", JSONArray(triedHere)) }
          .also { if (backAgain != null) it.put("back_again", backAgain) }
          .also { if (waitingFor != null) it.put("waiting_for", waitingFor) }

  /**
   * On Senku's own screen ([ownApp]) the only options are leaving it: Jev used to wait there
   * forever, or tap the app's own buttons (AgentRunner traces, 2026-10-22). On the home screen,
   * [appIcons] (installed app names) aren't offered as taps: apps open through open_app. Jev
   * tapped Blinkit's card in Recent apps instead, and it failed (trace 1792932734861). [askUser]
   * offers `ask_user` (tasks from Gemini Live).
   */
  fun options(obs: Observation, ownApp: Boolean, appIcons: Set<String> = emptySet(), askUser: Boolean = false): Map<String, String> {
    val options = LinkedHashMap<String, String>()
    if (ownApp) {
      options["open_app"] = "leave Sahay and open the app the plan needs"
      options["home"] = "go to the home screen"
      options["done"] = "the goal is achieved"
      options["stuck"] = "none of these options moves toward the goal"
      return options
    }
    for ((id, node) in obs.elements) {
      // Stands for a field the app hides, so it's only typed into; its node is the whole window.
      if (id == obs.keyboardField) {
        options["type_$id"] = "enter text into the field the keyboard is open for (element $id)"
        options["submit_$id"] = "press enter/search in the field the keyboard is open for (element $id)"
        continue
      }
      val what = describe(id, node, obs)
      if (node.isClickable && obs.labels[id] !in appIcons) options["click_$id"] = "tap $what"
      if (node.isEditable) {
        options["type_$id"] = "enter text into $what"
        options["submit_$id"] = "press enter/search in $what"
      }
      if (node.isScrollable) {
        options["scroll_down_$id"] = "scroll $what down/right"
        options["scroll_up_$id"] = "scroll $what up/left"
      }
    }
    options["back"] = "press the system Back button"
    options["home"] = "go to the home screen"
    options["wait"] = "wait for the screen to load or change"
    options["open_app"] = "open a different app"
    if (askUser) {
      options["ask_user"] =
          "ask the user before going on: several items fit and the plan doesn't say which, a detail only " +
              "the user knows is missing, or the next tap buys, pays, sends, books or deletes and the plan " +
              "doesn't say the user approved it"
      options[SIGN_IN] =
          "this screen won't let the task go on until the user signs in, logs in, verifies their phone or " +
              "email, or creates an account (a login or sign-up wall, not an optional sign-in banner); the " +
              "user does it themselves"
    }
    // With sign_in offered, sign-in screens aren't a replan.
    options["replan"] =
        "the plan has gone off track here: this screen wants something the plan doesn't cover (" +
            (if (askUser) "it shows an error" else "it asks to sign in, shows an error") +
            ", or the last step didn't do what it should), or state.back_again says the last steps led back " +
            "to this screen"
    options["done"] = "the goal is achieved and its answer is on screen"
    options["stuck"] = "none of these options moves toward the goal"
    return options
  }

  /** Options for the [TEXT] question: `text_1`… for each plan text, plus `other`. */
  fun textOptions(texts: List<String>): Map<String, String> {
    val options = LinkedHashMap<String, String>()
    texts.forEachIndexed { i, text -> options["text_${i + 1}"] = "type \"$text\"" }
    options["other"] = "the field needs other text that isn't listed here"
    return options
  }

  /** The text Jev chose with a `text_<n>` option, or null for `other`. */
  fun planText(option: String?, texts: List<String>): String? =
      option?.removePrefix("text_")?.toIntOrNull()?.let { texts.getOrNull(it - 1) }

  /**
   * Options for the [APP] question: `app_1`… per launcher app, plus `other`. Past [MAX_APPS],
   * apps named in [mentions] (the goal and plan) come first.
   */
  fun appOptions(apps: List<LauncherApp>, mentions: String): Map<String, LauncherApp> {
    val (named, rest) = apps.partition { mentions.contains(it.label, ignoreCase = true) }
    return (named + rest).take(MAX_APPS).withIndex().associate { (i, app) -> "app_${i + 1}" to app }
  }

  fun appCriteria(apps: Map<String, LauncherApp>): Map<String, String> =
      apps.mapValues { (_, app) -> "${app.label} (${app.packageName})" } +
          ("other" to "the app the plan needs isn't listed here")

  /**
   * What comes right before an app's name: "open Blinkit", "in blinkit", "go to the Play Store".
   * "Google" may precede it too: plans say "Google Photos" for the app the launcher calls Photos.
   */
  private const val APP_LEAD =
      "(?:open|launch|start|use|using|in|on|with|via|from|go to|switch to)\\s+(?:the\\s+)?(?:google\\s+)?"

  /**
   * The app a task starts in, launched before Jev's first step from whatever screen is in front:
   * the installed app the plan's first step names, else the one the goal names. A label only
   * counts after [APP_LEAD], so "tap the phone number field" doesn't name Phone. The earliest
   * mention wins, then the longest ("Open Google Maps" is Maps, not Google). Null when neither
   * names one.
   */
  fun startApp(apps: List<LauncherApp>, plan: List<String>, goal: String): LauncherApp? {
    for (text in listOfNotNull(plan.firstOrNull(), goal)) {
      val mentioned =
          apps.filter { it.label.isNotBlank() }.mapNotNull { app ->
            Regex("(?<![\\p{L}\\p{N}])$APP_LEAD${Regex.escape(app.label)}(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
                .find(text)
                ?.let { app to it.range }
          }
      mentioned
          .minWithOrNull(compareBy({ it.second.first }, { -it.second.last }, { -it.first.label.length }))
          ?.let { return it.first }
    }
    return null
  }

  /** Options for the [ITEM] question: `item_<id>` per clickable or checkable element, plus `none`. */
  fun itemOptions(obs: Observation): Map<String, String> {
    val options = LinkedHashMap<String, String>()
    for ((id, node) in obs.elements) {
      if (id == obs.keyboardField) continue
      if (node.isClickable || node.isCheckable) options["item_$id"] = describe(id, node, obs)
    }
    options["none"] = "no on-screen item; the decision is about something else"
    return options
  }

  /**
   * The items Jev spread probability over in its [ITEM] answer, in screen order: several similar
   * items share it. None when Jev's top pick is `none`.
   */
  fun chosenItems(choice: JevClient.Choice, obs: Observation): List<String> {
    if (choice.option == "none") return emptyList()
    return choice.top
        .filter { it.second >= MIN_ITEM_PROBABILITY }
        .mapNotNull { it.first.removePrefix("item_").toIntOrNull() }
        .take(MAX_OPTIONS)
        .sorted()
        .map { itemText(obs, it) }
        .filter { it.isNotEmpty() }
  }

  /** Whether element [id] is a password field, which only the user types into (see ScreenReader). */
  fun isPasswordField(obs: Observation, id: Int): Boolean = elementsById(obs)[id]?.optBoolean("password_field") == true

  /** An element's full text: [Observation.labels] are cut to 40 characters, too short for prices. */
  fun itemText(obs: Observation, id: Int): String {
    val element = elementsById(obs)[id] ?: return obs.labels[id].orEmpty()
    return listOf("text", "desc", "label", "hint")
        .map { element.optString(it).trim() }
        .firstOrNull { it.isNotEmpty() }
        .orEmpty()
        .take(MAX_ITEM_TEXT)
  }

  /** Each plan step by its number, for [PLAN_STEP]. */
  fun planStepOptions(plan: List<String>): Map<String, String> =
      plan.withIndex().associateTo(LinkedHashMap()) { (i, step) -> "${i + 1}" to step.take(MAX_ITEM_TEXT) }

  /**
   * What else is on screen, for Gemini Live to describe the choice to the user. With [near], a
   * decision's options, it starts a few items before the first of them, so the listing they belong to
   * comes first rather than whatever fills the top of the screen (ads, filters).
   */
  fun screenItems(
      obs: Observation,
      maxItems: Int = MAX_SCREEN_ITEMS,
      maxChars: Int = MAX_SCREEN_CHARS,
      near: List<String> = emptyList(),
  ): List<String> {
    val ids = elementsById(obs).keys.toList()
    val first = if (near.isEmpty()) -1 else ids.indexOfFirst { itemText(obs, it) in near }
    val items = LinkedHashSet<String>()
    var chars = 0
    for (id in ids.drop((first - ITEMS_BEFORE_OPTIONS).coerceAtLeast(0))) {
      val text = itemText(obs, id)
      if (text.isEmpty() || text in items) continue
      if (items.size >= maxItems || chars + text.length > maxChars) break
      items += text
      chars += text.length
    }
    return items.toList()
  }

  private fun elementsById(obs: Observation): Map<Int, JSONObject> {
    val list = JSONObject(obs.json).optJSONArray("elements") ?: return emptyMap()
    return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.associateBy { it.optInt("id") }
  }

  /**
   * [text] is the text Jev matched to the field, used when [option] is `type_<id>`; [app] is the
   * package Jev chose, used when [option] is `open_app`.
   */
  fun plan(option: String, text: String? = null, app: String? = null): Plan {
    val id = option.substringAfterLast('_').toIntOrNull()
    return when {
      option == "back" || option == "home" -> Plan.Run(call(option))
      option == "wait" -> Plan.Run(call("wait", "seconds" to 2))
      option == "open_app" && app != null -> Plan.Run(call("launch_app", "app" to app))
      option == "open_app" ->
          Plan.AskGpt(AgentTools.schemaOf("launch_app"), "The executor chose to open an app. Call launch_app.")
      option == "done" ->
          Plan.AskGpt(
              AgentTools.schemaOf("finish"),
              "The executor decided the goal is done. Call finish: success with a summary that answers the " +
                  "goal, or failed if the screen shows it isn't done.")
      id == null -> Plan.AskGpt(AgentTools.schema, null) // stuck
      option.startsWith("click_") -> Plan.Run(call("click", "node_id" to id))
      option.startsWith("submit_") -> Plan.Run(call("submit", "node_id" to id))
      option.startsWith("scroll_down_") -> Plan.Run(call("scroll", "node_id" to id, "direction" to "forward"))
      option.startsWith("scroll_up_") -> Plan.Run(call("scroll", "node_id" to id, "direction" to "backward"))
      option.startsWith("type_") && text != null -> Plan.Run(call("type", "node_id" to id, "text" to text))
      option.startsWith("type_") ->
          Plan.AskGpt(
              AgentTools.schemaOf("type", "finish"),
              "The executor chose to type into element $id. Call type with node_id $id and the text to enter, " +
                  "or finish with blocked if only the user knows it.",
              nodeId = id)
      else -> Plan.AskGpt(AgentTools.schema, null)
    }
  }

  private fun describe(id: Int, node: AccessibilityNodeInfo, obs: Observation): String {
    val type = node.className?.toString()?.substringAfterLast('.').orEmpty().ifEmpty { "element" }
    val label =
        obs.labels[id].orEmpty().ifEmpty {
          node.hintText?.toString()?.trim().orEmpty().ifEmpty {
            node.viewIdResourceName?.substringAfter(":id/").orEmpty()
          }
        }
    return if (label.isEmpty()) "$type $id (no label)" else "$type $id \"$label\""
  }

  private fun call(name: String, vararg args: Pair<String, Any>) =
      LlmClient.ToolCall(name, JSONObject().also { o -> args.forEach { o.put(it.first, it.second) } })
}
