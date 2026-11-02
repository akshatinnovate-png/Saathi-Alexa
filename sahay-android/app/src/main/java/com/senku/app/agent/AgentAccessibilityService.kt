package com.senku.app.agent

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent

class AgentAccessibilityService : AccessibilityService() {
  private var cursor: AgentCursorOverlay? = null
  private val cursorStateListener: () -> Unit = {
    if (AgentState.status() != "running" || AgentState.stopRequested) cursor?.hide()
  }

  fun indicateAction(bounds: Rect, scrollBackward: Boolean? = null) {
    cursor?.indicate(bounds, scrollBackward)
  }

  fun hideActionCursor() { cursor?.hide() }

  companion object {
    private const val TAG = "AgentAccessibility"

    @Volatile
    var instance: AgentAccessibilityService? = null
      private set
  }

  /** Uptime of the last window/content event; the agent loop waits for this to go quiet. */
  @Volatile
  var lastEventAt: Long = 0
    private set

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    cursor?.close()
    cursor = AgentCursorOverlay(this, { AgentState.status() == "running" && !AgentState.stopRequested })
    AgentState.addListener(cursorStateListener)

  }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    lastEventAt = SystemClock.uptimeMillis()
  }

  override fun onInterrupt() { hideActionCursor() }

  override fun onUnbind(intent: Intent?): Boolean {
    AgentState.removeListener(cursorStateListener)
    cursor?.close(); cursor = null
    instance = null

    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    AgentState.removeListener(cursorStateListener)
    cursor?.close(); cursor = null
    instance = null
    super.onDestroy()
  }
}
