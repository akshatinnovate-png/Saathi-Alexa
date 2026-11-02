package com.senku.app.agent

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/** An app with a launcher icon. [activity] is its launcher activity. */
class LauncherApp(val label: String, val packageName: String, val activity: String)

/** Apps the agent can open: launcher entries (`<queries>` in the manifest), minus Senku. */
object LauncherApps {

  fun list(context: Context): List<LauncherApp> {
    val pm = context.packageManager
    @Suppress("DEPRECATION")
    val entries = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
    return entries
        .map { LauncherApp(it.loadLabel(pm).toString(), it.activityInfo.packageName, it.activityInfo.name) }
        .filter { it.packageName != context.packageName }
        .distinctBy { it.packageName }
        .sortedBy { it.label.lowercase() }
  }

  /** The default home screen app (`<queries>` HOME); null when none is set (Android's chooser, `android`). */
  @Suppress("DEPRECATION")
  fun homePackage(context: Context): String? =
      context.packageManager
          .resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
          ?.activityInfo?.packageName?.takeIf { it != "android" }
}
