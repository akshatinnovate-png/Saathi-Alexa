package com.senku.app.agent

import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
import android.view.inputmethod.EditorInfo
import androidx.annotation.RequiresApi

/**
 * The text field the keyboard is open for, typed into through the keyboard's input connection when the
 * app hides the field from accessibility. Rapido's drop location (2026-10-28) showed only a label with
 * no node that takes text, so Jev had nothing to type into, and GPT's types, taps and clicks on the label
 * did nothing. Android 13+ lets the accessibility service act as an input method (flagInputMethodEditor);
 * before that, only a focused field the tree holds but doesn't show can be typed into.
 */
@RequiresApi(Build.VERSION_CODES.R)
object KeyboardInput {

  /** What can be told of the field: its hint, and whether it's for a password. */
  class Field(val hint: String, val password: Boolean)

  /** The field in [packageName] that the keyboard is open for, or null. */
  fun field(service: AgentAccessibilityService, packageName: String): Field? {
    if (!WindowTracker.keyboardVisible(service)) return null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      editor(service, packageName)?.let { return Field(it.hintText?.toString()?.trim().orEmpty(), isPassword(it.inputType)) }
    }
    return focusedNode(service, packageName)?.let { Field(it.hintText?.toString()?.trim().orEmpty(), it.isPassword) }
  }

  /** Replaces the field's text with [text]. Null when sent, else why not. */
  fun type(service: AgentAccessibilityService, packageName: String, text: String): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val editor = editor(service, packageName)
      val connection = service.inputMethod?.currentInputConnection
      if (editor != null && connection != null) {
        if (isPassword(editor.inputType)) return "only the user types into a password field"
        // Selected text is replaced by what's committed, so this replaces the field like ACTION_SET_TEXT.
        connection.performContextMenuAction(android.R.id.selectAll)
        connection.commitText(text, 1, null)
        return null
      }
    }
    val node = focusedNode(service, packageName) ?: return "no text field has the keyboard"
    if (node.isPassword) return "only the user types into a password field"
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
    return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) null else "the app rejected the text"
  }

  /** Presses the keyboard's action key (search, go, done), or Enter. Null when sent, else why not. */
  fun submit(service: AgentAccessibilityService, packageName: String): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val editor = editor(service, packageName)
      val connection = service.inputMethod?.currentInputConnection
      if (editor != null && connection != null) {
        val action = editor.imeOptions and EditorInfo.IME_MASK_ACTION
        if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
          connection.performEditorAction(action)
        } else {
          connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
          connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        }
        return null
      }
    }
    val node = focusedNode(service, packageName) ?: return "no text field has the keyboard"
    return if (node.performAction(AccessibilityAction.ACTION_IME_ENTER.id)) null else "the app rejected the action"
  }

  /** The field the keyboard is typing into, if it's [packageName]'s. */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun editor(service: AgentAccessibilityService, packageName: String): EditorInfo? {
    val method = service.inputMethod ?: return null
    if (!method.currentInputStarted) return null
    return method.currentInputEditorInfo?.takeIf { it.packageName == packageName }
  }

  private fun focusedNode(service: AgentAccessibilityService, packageName: String): AccessibilityNodeInfo? =
      service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf {
        it.isEditable && it.packageName?.toString() == packageName
      }

  private fun isPassword(inputType: Int): Boolean {
    val variation = inputType and InputType.TYPE_MASK_VARIATION
    return when (inputType and InputType.TYPE_MASK_CLASS) {
      InputType.TYPE_CLASS_TEXT ->
          variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
              variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
              variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
      InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
      else -> false
    }
  }
}
