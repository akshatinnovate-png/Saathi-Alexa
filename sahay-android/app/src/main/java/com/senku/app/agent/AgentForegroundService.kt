package com.senku.app.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.senku.app.MainActivity
import com.senku.app.UsageLimitNotice
import kotlin.concurrent.thread

/** Keeps the agent loop alive while Senku's UI is in the background. */
class AgentForegroundService : Service() {

  companion object {
    const val EXTRA_GOAL = "goal"
    const val ACTION_STOP = "com.senku.app.STOP_AGENT"
    const val ACTION_RESUME = "com.senku.app.RESUME_AGENT"
    private const val CHANNEL_ID = "agent"
    /** 1 is OverlayService's and 2 is VoiceOverlayService's. */
    private const val NOTIFICATION_ID = 3
  }

  private var worker: Thread? = null
  private val listener = { post() }
  /** What the notification last showed, so changes it doesn't display don't repost it. */
  @Volatile private var shown: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        AgentState.requestStop()
        return START_NOT_STICKY
      }
      ACTION_RESUME -> {
        AgentState.requestResume()
        return START_NOT_STICKY
      }
    }

    getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(CHANNEL_ID, "Agent tasks", NotificationManager.IMPORTANCE_LOW))
    val special = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), special)
    if (worker?.isAlive == true) return START_NOT_STICKY

    val goal = intent?.getStringExtra(EXTRA_GOAL)
    if (goal != null && !AgentState.isActive()) AgentState.begin(goal, AgentSettings.planner(this))
    AgentState.addListener(listener)
    worker =
        thread(name = "agent-loop") {
          try {
            // MainActivity only offers Run on Android 11+; the loop needs windowsOnAllDisplays.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) AgentLoop(this).run()
            else AgentState.finish("failed", "Needs Android 11 or newer.")
          } catch (e: Exception) {
            if (UsageLimitNotice.isLimitError(e.message)) UsageLimitNotice.notify(this, "phone_actions")
            AgentState.finish("failed", "Agent crashed: ${e.message}")
          } finally {
            AgentState.removeListener(listener)
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
            post()
            stopSelf()
          }
        }
    return START_NOT_STICKY
  }

  private fun post() {
    val key = "${AgentState.status()}|${AgentState.stepCount()}"
    if (key == shown) return
    shown = key
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
  }

  private fun openApp() =
      PendingIntent.getActivity(
          this,
          0,
          Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_IMMUTABLE)

  private fun buildNotification(): Notification {
    val status = AgentState.status()
    val active = AgentState.isActive()
    val title =
        when (status) {
          "running" -> "Agent running"
          "paused" -> "Agent paused"
          "waiting" -> "Agent needs your answer"
          "success" -> "Agent finished"
          "blocked" -> "Agent blocked"
          "failed" -> "Agent failed"
          "stopped" -> "Agent stopped"
          else -> "Sahay"
        }
    val text =
        when (status) {
          "running" -> AgentState.lastAction()?.let { "Step ${AgentState.stepCount()}: $it" } ?: "Starting…"
          "paused" -> "Paused — waiting for ${AgentState.waitingFor()}"
          "waiting" -> "Answer Sahay: ${AgentState.decision()?.optString("reason")?.replace('_', ' ').orEmpty()}"
          else -> AgentState.summary() ?: ""
        }
    val open = openApp()
    val builder =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${AgentState.goal()}\n$text"))
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(active)
    if (active) builder.addAction(0, "Stop", serviceIntent(ACTION_STOP, 1))
    if (status == "paused") builder.addAction(0, "Resume", serviceIntent(ACTION_RESUME, 2))
    return builder.build()
  }

  private fun serviceIntent(action: String, requestCode: Int) =
      PendingIntent.getService(
          this,
          requestCode,
          Intent(this, AgentForegroundService::class.java).setAction(action),
          PendingIntent.FLAG_IMMUTABLE)
}
