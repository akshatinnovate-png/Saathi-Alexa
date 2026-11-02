package com.senku.app.agent

import android.graphics.Rect
import android.os.Build
import android.view.accessibility.AccessibilityWindowInfo
import androidx.annotation.RequiresApi

/**
 * Finds app windows across every display. Never trusts Android's "active" window: another
 * accessibility service (Switch Access) can hold it while hidden behind the visible app.
 * windowsOnAllDisplays is API 30, so Senku only runs the agent on Android 11+.
 */
@RequiresApi(Build.VERSION_CODES.R)
object WindowTracker {

  private fun allWindows(service: AgentAccessibilityService): List<AccessibilityWindowInfo> {
    val byDisplay = service.windowsOnAllDisplays
    val windows = mutableListOf<AccessibilityWindowInfo>()
    for (i in 0 until byDisplay.size()) windows += byDisplay.valueAt(i)
    return windows
  }

  /** Application windows only: the shade, keyboard and other system windows don't count. */
  private fun appWindows(service: AgentAccessibilityService) =
      allWindows(service).filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }

  private fun packageOf(window: AccessibilityWindowInfo): String? =
      window.root?.packageName?.toString()

  fun isVisible(service: AgentAccessibilityService, packageName: String): Boolean =
      appWindows(service).any { packageOf(it) == packageName }

  fun focusedAppPackage(service: AgentAccessibilityService): String? =
      preferred(appWindows(service))?.let(::packageOf)

  /** The window to read: [packageName]'s if given, otherwise the focused app window. */
  fun windowFor(service: AgentAccessibilityService, packageName: String?): AccessibilityWindowInfo? {
    val windows = appWindows(service)
    return preferred(if (packageName == null) windows else windows.filter { packageOf(it) == packageName })
  }

  fun keyboardVisible(service: AgentAccessibilityService): Boolean =
      allWindows(service).any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }

  /**
   * Whether a window above [windowId]'s covers [x], [y], so a real touch there would land on it:
   * Senku's orb, the keyboard, a system bar. Accessibility overlays, such as the action cursor, don't
   * take touches.
   */
  fun coveredAt(service: AgentAccessibilityService, windowId: Int, x: Int, y: Int): Boolean {
    val windows = allWindows(service)
    val own = windows.firstOrNull { it.id == windowId } ?: return false
    return windows.any {
      it.id != windowId && it.layer > own.layer && it.type != AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY &&
          Rect().also { r -> it.getBoundsInScreen(r) }.contains(x, y)
    }
  }

  private fun preferred(windows: List<AccessibilityWindowInfo>) =
      windows.firstOrNull { it.isFocused } ?: windows.maxByOrNull { it.layer }
}
