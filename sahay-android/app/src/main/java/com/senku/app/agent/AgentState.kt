package com.senku.app.agent

import java.util.concurrent.CopyOnWriteArraySet
import org.json.JSONArray
import org.json.JSONObject

/**
 * The current task, in memory. Room persistence and resume-after-process-death replace this
 * in the next round (CLAUDE.md "Persistence").
 */
object AgentState {

  /**
   * Who chose a step and how long each phase took. [jevPick] is Jev's option even when GPT then decided.
   * [planStep] is the 1-based plan step Jev said the action carries out.
   */
  class StepMeta(
      val decider: String,
      val jevPick: String?,
      val probability: Double?,
      val decideMs: Long,
      val actionMs: Long,
      val settleMs: Long,
      val planStep: Int? = null,
  )

  /** [screen] is a short list of what was on screen when the action was taken. */
  class Step(
      val n: Int,
      val action: String,
      val result: String,
      val app: String?,
      val at: Long,
      val meta: StepMeta?,
      val screen: List<String> = emptyList(),
  )

  private val steps = mutableListOf<Step>()
  private val notes = mutableListOf<String>()
  private var taskId = 0L
  private var goal = ""
  private var status = "idle" // idle | running | paused | waiting | success | failed | blocked | stopped
  private var currentApp: String? = null
  private var waitingFor: String? = null
  private var model: String? = null
  private var summary: String? = null
  private var plan: List<String> = emptyList()
  private var planTexts: List<String> = emptyList()
  /** What Jev is waiting for the user to decide while [status] is "waiting"; see [askUser]. */
  private var decision: JSONObject? = null
  /** Decisions asked in this task; each decision's `id`. */
  private var asks = 0
  /** The latest update Gemini Live speaks about, such as coaching the user through signing in; see [notify]. */
  private var notice: JSONObject? = null
  /** Notices sent in this task; each notice's `id`. */
  private var notices = 0
  /** Bumped by [revisePlan], so the loop knows to load the new plan. */
  private var planVersion = 0
  /** What the user decided or changed, from the last [revisePlan]. */
  private var planChange: String? = null
  /** Started from a Gemini Live session, so Jev can ask the user through it. */
  private var askable = false

  @Volatile var stopRequested = false
    private set
  @Volatile var resumeRequested = false
    private set

  /** Called after every change, from whichever thread made it. */
  private val listeners = CopyOnWriteArraySet<() -> Unit>()

  fun addListener(listener: () -> Unit) = listeners.add(listener)

  fun removeListener(listener: () -> Unit) = listeners.remove(listener)

  @Synchronized fun isActive() = status == "running" || status == "paused" || status == "waiting"

  fun begin(
      goal: String,
      model: String,
      initialPlan: List<String> = emptyList(),
      initialTexts: List<String> = emptyList(),
      askUser: Boolean = false,
  ) {
    synchronized(this) {
      taskId = System.currentTimeMillis()
      this.goal = goal
      this.model = model
      status = "running"
      currentApp = null
      waitingFor = null
      summary = null
      plan = initialPlan.toList()
      planTexts = initialTexts.toList()
      decision = null
      asks = 0
      notice = null
      notices = 0
      planVersion = 0
      planChange = null
      askable = askUser
      steps.clear()
      notes.clear()
      stopRequested = false
      resumeRequested = false
    }
    changed()
  }

  fun requestStop() {
    stopRequested = true
    changed()
  }

  fun requestResume() {
    resumeRequested = true
  }

  fun addStep(action: String, result: String, app: String?, meta: StepMeta? = null, screen: List<String> = emptyList()) {
    synchronized(this) { steps += Step(steps.size + 1, action, result, app, System.currentTimeMillis(), meta, screen) }
    changed()
  }

  fun addNote(text: String) {
    synchronized(this) { notes += text }
  }

  fun setCurrentApp(app: String) {
    synchronized(this) { currentApp = app }
    changed()
  }

  fun setPlan(plan: List<String>) {
    synchronized(this) { this.plan = plan }
    changed()
  }

  fun setPlanTexts(texts: List<String>) {
    synchronized(this) { planTexts = texts.toList() }
  }

  @Synchronized fun initialPlan() = plan.toList()

  @Synchronized fun initialPlanTexts() = planTexts.toList()

  fun setModel(model: String) {
    synchronized(this) { this.model = model }
    changed()
  }

  fun pause(waitingForApp: String, preemptedBy: String?) {
    addStep("paused", "preempted by user → ${preemptedBy ?: "unknown"}; waiting for $waitingForApp", preemptedBy)
    synchronized(this) {
      status = "paused"
      waitingFor = waitingForApp
      resumeRequested = false
    }
    changed()
  }

  fun resumed(reason: String) {
    synchronized(this) {
      status = "running"
      waitingFor = null
    }
    addStep("resumed", reason, null)
  }

  /**
   * Jev needs the user: the loop waits, and Gemini Live gets [request] and asks the user, until
   * [revisePlan] or Stop.
   */
  fun askUser(request: JSONObject) {
    synchronized(this) {
      status = "waiting"
      decision = request.put("id", ++asks)
    }
    changed()
  }

  /**
   * An update for Gemini Live to speak about without the task waiting on it, such as what the next
   * sign-in screen wants. Each one gets the next `id`, so it's sent once.
   */
  fun notify(update: JSONObject) {
    synchronized(this) { notice = update.put("id", ++notices) }
    changed()
  }

  /**
   * The user did on the phone what the task waited for, such as signing in or entering the PIN, without
   * Gemini Live changing the plan: the task runs again on the same one.
   */
  fun userDone() {
    synchronized(this) {
      if (status == "waiting") {
        status = "running"
        decision = null
      }
    }
    changed()
  }

  /**
   * Replaces the whole plan, from Gemini Live after the user decided or changed the request. A task
   * waiting on a decision runs again.
   */
  fun revisePlan(goal: String, plan: List<String>, texts: List<String>, change: String) {
    synchronized(this) {
      this.goal = goal
      this.plan = plan.toList()
      planTexts = texts.toList()
      planChange = change
      planVersion++
      if (status == "waiting") {
        status = "running"
        decision = null
      }
    }
    changed()
  }

  /** True once if the user tapped Resume. */
  fun consumeResume(): Boolean = resumeRequested.also { resumeRequested = false }

  fun finish(status: String, summary: String) {
    synchronized(this) {
      this.status = status
      this.summary = summary
      waitingFor = null
      decision = null
    }
    changed()
  }

  @Synchronized fun stepLog(): List<String> = steps.map { "#${it.n} ${it.action} → ${it.result}" }

  @Synchronized fun notesSnapshot(): List<String> = notes.toList()

  @Synchronized fun goal() = goal

  @Synchronized fun taskId() = taskId

  @Synchronized fun status() = status

  @Synchronized fun waitingFor() = waitingFor

  @Synchronized fun summary() = summary

  @Synchronized fun lastAction(): String? = steps.lastOrNull()?.action

  @Synchronized fun lastStep(): Step? = steps.lastOrNull()

  @Synchronized fun decision(): JSONObject? = decision?.let { JSONObject(it.toString()) }

  @Synchronized fun notice(): JSONObject? = notice?.let { JSONObject(it.toString()) }

  @Synchronized fun planVersion() = planVersion

  @Synchronized fun planChange() = planChange

  /** True for tasks from Gemini Live (either mode): Jev may stop and ask the user. */
  @Synchronized fun canAskUser() = askable

  @Synchronized fun stepCount() = steps.size

  @Synchronized
  fun toJson(): String =
      JSONObject()
          .put("taskId", taskId)
          .put("goal", goal)
          .put("status", status)
          .put("currentApp", currentApp ?: JSONObject.NULL)
          .put("waitingFor", waitingFor ?: JSONObject.NULL)
          .put("model", model ?: JSONObject.NULL)
          .put("summary", summary ?: JSONObject.NULL)
          .put("notes", JSONArray(notes))
          .put("plan", JSONArray(plan))
          .put("decision", decision ?: JSONObject.NULL)
          .put(
              "steps",
              JSONArray().also { arr ->
                steps.forEach {
                  val step =
                      JSONObject()
                          .put("n", it.n)
                          .put("action", it.action)
                          .put("result", it.result)
                          .put("app", it.app ?: JSONObject.NULL)
                          .put("at", it.at)
                  it.meta?.let { m ->
                    step
                        .put("decider", m.decider)
                        .put("jevPick", m.jevPick ?: JSONObject.NULL)
                        .put("probability", m.probability ?: JSONObject.NULL)
                        .put("decideMs", m.decideMs)
                        .put("actionMs", m.actionMs)
                        .put("settleMs", m.settleMs)
                        .put("planStep", m.planStep ?: JSONObject.NULL)
                  }
                  arr.put(step)
                }
              })
          .toString()

  private fun changed() {
    listeners.forEach { it() }
  }
}
