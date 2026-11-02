package com.senku.app.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
import androidx.annotation.RequiresApi
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Validates one tool call against the current observation and performs it. ACTION_IME_ENTER is API 30. */
@RequiresApi(Build.VERSION_CODES.R)
class AgentExecutor {

  /** [launched] is the package a successful `launch_app` started. */
  class Outcome(
      val result: String,
      val finishStatus: String? = null,
      val summary: String? = null,
      val launched: String? = null,
  )

  companion object {
    /** [node] or its nearest clickable parent, which Android's accessibility click acts on; null if neither is. */
    fun pressTarget(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
      var target = node
      while (target != null && !target.isClickable) target = target.parent
      return target
    }
  }

  fun execute(service: AgentAccessibilityService, name: String, args: JSONObject, obs: Observation): Outcome {
    // The keyboard's field stands for one the app hides; its node is the whole window.
    if (obs.keyboardField != null && args.optInt("node_id", -1) == obs.keyboardField) {
      return when (name) {
        "type" -> keyboard(service, obs.packageName, "typed into the field the keyboard is open for") {
          KeyboardInput.type(service, obs.packageName, args.optString("text"))
        }
        "submit" -> keyboard(service, obs.packageName, "submitted the field the keyboard is open for") {
          KeyboardInput.submit(service, obs.packageName)
        }
        else -> Outcome("rejected: element ${obs.keyboardField} is the field the keyboard is open for; only type or submit work on it")
      }
    }
    return when (name) {
      "launch_app" -> launchApp(service, args.optString("app"))
      "click" -> withNode(args, obs) { click(service, it) }
      "tap" -> withNode(args, obs) { tap(service, it) }
      "press" -> withNode(args, obs) { press(service, it) }
      "type" -> withNode(args, obs) { type(service, it, args.optString("text"), obs.packageName) }
      "submit" -> withNode(args, obs) { submit(service, it) }
      "scroll" -> withNode(args, obs) { scroll(service, it, args.optString("direction")) }
      "back" -> global(service, AccessibilityService.GLOBAL_ACTION_BACK)
      "home" -> global(service, AccessibilityService.GLOBAL_ACTION_HOME)
      "wait" -> {
        val seconds = args.optInt("seconds", 2).coerceIn(1, 30)
        Thread.sleep(seconds * 1000L)
        Outcome("ok: waited ${seconds}s")
      }
      "note" -> {
        AgentState.addNote(args.optString("text"))
        Outcome("ok: noted")
      }
      "finish" -> {
        val status = args.optString("status").takeIf { it in setOf("success", "failed", "blocked") } ?: "failed"
        Outcome("finished: $status", status, args.optString("summary"))
      }
      else -> Outcome("rejected: unknown tool $name")
    }
  }

  /** Types or submits through [KeyboardInput]: [what] when it's sent, else why not. */
  private fun keyboard(service: AgentAccessibilityService, packageName: String, what: String, action: () -> String?): Outcome {
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before typing")
    service.hideActionCursor()
    val failure = action()
    return Outcome(if (failure == null) "ok: $what" else "failed: $failure")
  }

  private fun withNode(args: JSONObject, obs: Observation, action: (AccessibilityNodeInfo) -> Outcome): Outcome {
    val id = args.optInt("node_id", -1)
    val node = obs.elements[id] ?: return Outcome("rejected: element $id is not on the current screen")
    return action(node)
  }

  private fun launchApp(service: AgentAccessibilityService, query: String): Outcome {
    val q = query.trim()
    if (q.isEmpty()) return Outcome("rejected: app is empty")
    val apps = LauncherApps.list(service)
    val match =
        apps.firstOrNull { it.packageName.equals(q, ignoreCase = true) }
            ?: apps.firstOrNull { it.label.equals(q, ignoreCase = true) }
            ?: apps.firstOrNull { it.label.contains(q, ignoreCase = true) }
            ?: return Outcome("failed: no installed app matches \"$q\"")
    val pkg = match.packageName
    val intent =
        (service.packageManager.getLaunchIntentForPackage(pkg)
                ?: Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(pkg, match.activity))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // Started from the accessibility service: Android exempts it from background-launch limits.
    return try {
      service.hideActionCursor()
      service.startActivity(intent)
      Outcome("ok: launched ${match.label} ($pkg)", launched = pkg)
    } catch (e: Exception) {
      Outcome("failed: ${e.message}")
    }
  }

  /**
   * A real tap with [AgentSettings.REAL_GESTURES], falling back to the accessibility click where no
   * spot can be tapped safely; otherwise the accessibility click. AgentLoop tries the other one when
   * the screen doesn't change.
   */
  private fun click(service: AgentAccessibilityService, node: AccessibilityNodeInfo): Outcome {
    if (!AgentSettings.REAL_GESTURES) return press(service, node)
    val tapped = tap(service, node)
    if (!tapped.result.startsWith("failed:")) return tapped
    val pressed = press(service, node)
    return Outcome("${pressed.result} (no tap: ${tapped.result.removePrefix("failed: ")})")
  }

  /** Android's accessibility click on [node] or its nearest clickable parent. */
  private fun press(service: AgentAccessibilityService, node: AccessibilityNodeInfo): Outcome {
    val target = pressTarget(node) ?: return Outcome("failed: neither the element nor any parent is clickable")
    indicate(service, target)
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before click")
    return result(target.performAction(AccessibilityNodeInfo.ACTION_CLICK), if (target == node) "clicked" else "clicked its clickable parent")
  }

  /**
   * A real touch on [node]: web pages and React Native views answer touches, not accessibility clicks.
   * Never through a window on top, such as Senku's orb, which the touch would close, or the keyboard.
   */
  private fun tap(service: AgentAccessibilityService, node: AccessibilityNodeInfo): Outcome {
    node.refresh()
    val point = tapPoint(node) ?: return Outcome("failed: no visible spot to tap")
    if (WindowTracker.coveredAt(service, node.windowId, point.x, point.y)) {
      return Outcome("failed: another window covers the spot to tap")
    }
    indicate(service, node)
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before tapping")
    // 50 ms: a tap, well short of a long press.
    val failure = touch(service, Path().apply { moveTo(point.x.toFloat(), point.y.toFloat()) }, 50)
    return Outcome(if (failure == null) "ok: tapped" else "failed: $failure")
  }

  /**
   * A real swipe across [node]'s visible part: upward to scroll forward, or leftward when it scrolls
   * sideways (a carousel), and the reverse backward. Null when done, else why not.
   */
  private fun swipe(service: AgentAccessibilityService, node: AccessibilityNodeInfo, backward: Boolean): String? {
    val bounds = visibleBounds(node) ?: return "nothing of it is on screen"
    val ids = node.actionList.map { it.id }.toSet()
    val vertical = AccessibilityAction.ACTION_SCROLL_DOWN.id in ids || AccessibilityAction.ACTION_SCROLL_UP.id in ids
    val horizontal = AccessibilityAction.ACTION_SCROLL_RIGHT.id in ids || AccessibilityAction.ACTION_SCROLL_LEFT.id in ids
    val sideways = if (vertical || horizontal) horizontal && !vertical else bounds.width() > bounds.height() * 2
    fun at(fx: Float, fy: Float) = Point(bounds.left + (bounds.width() * fx).toInt(), bounds.top + (bounds.height() * fy).toInt())
    var (from, to) = if (sideways) at(.8f, .5f) to at(.2f, .5f) else at(.5f, .8f) to at(.5f, .25f)
    if (backward) from = to.also { to = from }
    if (WindowTracker.coveredAt(service, node.windowId, from.x, from.y) ||
        WindowTracker.coveredAt(service, node.windowId, to.x, to.y)) {
      return "another window covers the spot to swipe"
    }
    // 350 ms: a drag that scrolls about the distance swiped, without a long fling.
    return touch(service, Path().apply { moveTo(from.x.toFloat(), from.y.toFloat()); lineTo(to.x.toFloat(), to.y.toFloat()) }, 350)
  }

  /** Runs [path] as a real touch lasting [ms]. Null when it completed, else why not. */
  private fun touch(service: AgentAccessibilityService, path: Path, ms: Long): String? {
    val done = CountDownLatch(1)
    var completed = false
    val sent = service.dispatchGesture(
        GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms)).build(),
        object : AccessibilityService.GestureResultCallback() {
          override fun onCompleted(gestureDescription: GestureDescription) {
            completed = true
            done.countDown()
          }
          override fun onCancelled(gestureDescription: GestureDescription) = done.countDown()
        },
        null)
    if (!sent) return "real touches need Sahay's accessibility turned off and on again"
    done.await(ms + 2000, TimeUnit.MILLISECONDS)
    return if (completed) null else "the touch was cancelled"
  }

  /** [node]'s bounds within its window, or null when none of it is on screen. */
  private fun visibleBounds(node: AccessibilityNodeInfo): Rect? {
    val bounds = Rect().also { node.getBoundsInScreen(it) }
    val window = node.window?.let { w -> Rect().also { w.getBoundsInScreen(it) } }
    if (window != null && !bounds.intersect(window)) return null
    return bounds.takeUnless { it.isEmpty }
  }

  /** The centre of [node]'s visible part, or a spot there off a clickable child (a card's "ADD" button). */
  private fun tapPoint(node: AccessibilityNodeInfo): Point? {
    val bounds = visibleBounds(node) ?: return null
    val children = clickableChildBounds(node)
    return listOf(.5f to .5f, .2f to .5f, .8f to .5f, .5f to .2f, .5f to .8f)
        .map { (fx, fy) -> Point(bounds.left + (bounds.width() * fx).toInt(), bounds.top + (bounds.height() * fy).toInt()) }
        .firstOrNull { p -> children.none { it.contains(p.x, p.y) } }
  }

  /** Bounds of the clickable elements inside [node], a few levels down. */
  private fun clickableChildBounds(node: AccessibilityNodeInfo, depth: Int = 0): List<Rect> {
    if (depth > 4) return emptyList()
    return (0 until node.childCount).mapNotNull { node.getChild(it) }.flatMap { child ->
      val own = if (child.isClickable) listOf(Rect().also { child.getBoundsInScreen(it) }) else emptyList()
      own + clickableChildBounds(child, depth + 1)
    }
  }

  /**
   * [node], or a field inside it. Failing both, the field the keyboard is open for in [packageName]: the
   * element is often its label, when the app hides the field itself (see [KeyboardInput]).
   */
  private fun type(service: AgentAccessibilityService, node: AccessibilityNodeInfo, text: String, packageName: String): Outcome {
    val field = if (node.isEditable) node else findDescendant(node) { it.isEditable }
    if (field == null) {
      if (KeyboardInput.field(service, packageName) == null) return Outcome("failed: element is not a text field")
      return keyboard(service, packageName, "typed into the field the keyboard is open for") {
        KeyboardInput.type(service, packageName, text)
      }
    }
    // Only the user types a password (AgentLoop asks them), so none reaches a model or a trace.
    if (field.isPassword) return Outcome("rejected: only the user types into a password field")
    indicate(service, field)
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before typing")
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
    return result(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args), "typed")
  }

  private fun submit(service: AgentAccessibilityService, node: AccessibilityNodeInfo): Outcome {
    indicate(service, node)
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before submit")
    val enter = AccessibilityAction.ACTION_IME_ENTER.id
    if (node.performAction(enter)) return Outcome("ok: submitted")
    // The element may not hold input focus; try whichever field does.
    val focused = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    if (focused != null) indicate(service, focused)
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before submit")
    return result(focused?.performAction(enter) == true, "submitted via the focused field")
  }

  private fun scroll(service: AgentAccessibilityService, node: AccessibilityNodeInfo, direction: String): Outcome {
    var target: AccessibilityNodeInfo? = node
    while (target != null && !target.isScrollable) target = target.parent
    target = target ?: findDescendant(node) { it.isScrollable }
    target ?: return Outcome("failed: nothing scrollable here")
    service.indicateAction(Rect().also { target.getBoundsInScreen(it) }, direction == "backward")
    if (AgentState.stopRequested) return Outcome("stopped: task cancelled before scroll")
    val noSwipe =
        if (AgentSettings.REAL_GESTURES) swipe(service, target, direction == "backward") ?: return Outcome("ok: swiped $direction")
        else null
    val action =
        if (direction == "backward") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
    val scrolled = result(target.performAction(action), "scrolled $direction")
    return if (noSwipe == null) scrolled else Outcome("${scrolled.result} (no swipe: $noSwipe)")
  }

  private fun global(service: AgentAccessibilityService, action: Int): Outcome {
    service.hideActionCursor()
    return result(service.performGlobalAction(action), "done")
  }

  private fun indicate(service: AgentAccessibilityService, target: AccessibilityNodeInfo) {
    service.indicateAction(Rect().also { target.getBoundsInScreen(it) })
  }

  private fun result(ok: Boolean, what: String) =
      Outcome(if (ok) "ok: $what" else "failed: the app rejected the action")

  private fun findDescendant(node: AccessibilityNodeInfo, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      if (predicate(child)) return child
      findDescendant(child, predicate)?.let { return it }
    }
    return null
  }
}
