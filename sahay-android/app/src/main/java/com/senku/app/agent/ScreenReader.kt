package com.senku.app.agent

import android.graphics.Rect
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject

/** One read of the screen. Element ids are only valid for this observation. */
class Observation(
    val packageName: String,
    val elements: Map<Int, AccessibilityNodeInfo>,
    /** Short label per element id, for the step log. */
    val labels: Map<Int, String>,
    val json: String,
    /**
     * The element standing for the field the keyboard is open for, when the app hides that field from
     * accessibility: it's typed into through the keyboard (see [KeyboardInput]), and can't be tapped.
     */
    val keyboardField: Int? = null,
)

/** Serializes the agent's app window into the compact JSON the model sees. */
@RequiresApi(Build.VERSION_CODES.R)
object ScreenReader {

  private const val MAX_ELEMENTS = 250
  private const val MAX_TEXT = 150
  private const val MAX_LABEL = 120

  /**
   * [hideInput] leaves out what is typed in fields, for screens the user fills in themselves, such as
   * signing in: their phone number, email or code never reaches a model or a trace.
   */
  fun read(service: AgentAccessibilityService, packageName: String?, hideInput: Boolean = false): Observation {
    val root = WindowTracker.windowFor(service, packageName)?.root
    val app = root?.packageName?.toString() ?: packageName ?: "unknown"
    val elements = LinkedHashMap<Int, AccessibilityNodeInfo>()
    val labels = HashMap<Int, String>()
    val list = JSONArray()
    if (root != null) walk(root, elements, labels, list, hideInput)
    val keyboardOpen = WindowTracker.keyboardVisible(service)
    // The keyboard is open, but no element on screen takes text: the app hides the field from
    // accessibility (Rapido's drop location). It goes in as one more element, backed by the window.
    val field =
        if (root != null && keyboardOpen && elements.values.none { it.isEditable }) KeyboardInput.field(service, app) else null
    var keyboardField: Int? = null
    if (root != null && field != null) {
      val id = elements.size + 1
      val o =
          JSONObject()
              .put("id", id)
              .put("type", "KeyboardField")
              .put("desc", "the text field the keyboard is open for, which the app doesn't show in this tree")
      if (field.password) o.put("password_field", true)
      if (field.hint.isNotEmpty()) o.put("hint", field.hint.take(MAX_TEXT))
      o.put("editable", true).put("focused", true)
      elements[id] = root
      labels[id] = "the field the keyboard is open for"
      list.put(o)
      keyboardField = id
    }
    val json =
        JSONObject()
            .put("app", app)
            .put("keyboard_open", keyboardOpen)
            .put("elements", list)
            .toString()
    return Observation(app, elements, labels, json, keyboardField)
  }

  private fun walk(
      node: AccessibilityNodeInfo,
      elements: MutableMap<Int, AccessibilityNodeInfo>,
      labels: MutableMap<Int, String>,
      list: JSONArray,
      hideInput: Boolean,
  ) {
    if (elements.size >= MAX_ELEMENTS) return
    if (node.isVisibleToUser) add(node, elements, labels, list, hideInput)
    for (i in 0 until node.childCount) {
      node.getChild(i)?.let { walk(it, elements, labels, list, hideInput) }
    }
  }

  private fun add(
      node: AccessibilityNodeInfo,
      elements: MutableMap<Int, AccessibilityNodeInfo>,
      labels: MutableMap<Int, String>,
      list: JSONArray,
      hideInput: Boolean,
  ) {
    // Never forward password contents to the model or write them into an automation trace.
    val passwordField = node.isPassword
    val text = if (passwordField || (hideInput && node.isEditable)) "" else node.text?.toString()?.trim().orEmpty()
    val desc = if (passwordField) "" else node.contentDescription?.toString()?.trim().orEmpty()
    val clickable = node.isClickable
    if (text.isEmpty() && desc.isEmpty() && !clickable && !node.isEditable &&
        !node.isScrollable && !node.isCheckable) {
      return
    }
    val bounds = Rect().also { node.getBoundsInScreen(it) }
    if (bounds.width() <= 0 || bounds.height() <= 0) return

    val id = elements.size + 1
    val o = JSONObject().put("id", id)
    o.put("type", node.className?.toString()?.substringAfterLast('.').orEmpty())
    if (passwordField) o.put("password_field", true)
    if (text.isNotEmpty()) o.put("text", text.take(MAX_TEXT))
    if (desc.isNotEmpty() && desc != text) o.put("desc", desc.take(MAX_TEXT))
    // Compose apps put a button's label in a child; give it to the clickable node.
    var childLabel = ""
    if (clickable && !passwordField && text.isEmpty() && desc.isEmpty()) {
      childLabel = descendantText(node, hideInput)
      if (childLabel.isNotEmpty()) o.put("label", childLabel)
    }
    if (node.isEditable) {
      o.put("editable", true)
      val hint = node.hintText?.toString()?.trim().orEmpty()
      if (hint.isNotEmpty() && hint != text) o.put("hint", hint.take(MAX_TEXT))
    }
    if (clickable) o.put("clickable", true)
    if (node.isScrollable) o.put("scrollable", true)
    if (node.isCheckable) o.put("checked", node.isChecked)
    if (node.isFocused) o.put("focused", true)
    node.viewIdResourceName?.substringAfter(":id/")?.let { o.put("rid", it) }
    o.put("at", JSONArray().put(bounds.centerX()).put(bounds.centerY()))

    elements[id] = node
    labels[id] = (text.ifEmpty { desc.ifEmpty { childLabel } }).take(40)
    list.put(o)
  }

  private fun descendantText(node: AccessibilityNodeInfo, hideInput: Boolean): String {
    val parts = LinkedHashSet<String>()
    fun collect(n: AccessibilityNodeInfo, depth: Int) {
      if (depth > 6 || parts.size >= 6) return
      for (i in 0 until n.childCount) {
        val child = n.getChild(i) ?: continue
        if (child.isPassword || (hideInput && child.isEditable)) continue
        val t = (child.text ?: child.contentDescription)?.toString()?.trim().orEmpty()
        if (t.isNotEmpty()) parts += t
        collect(child, depth + 1)
      }
    }
    collect(node, 0)
    return parts.joinToString(" | ").take(MAX_LABEL)
  }
}
