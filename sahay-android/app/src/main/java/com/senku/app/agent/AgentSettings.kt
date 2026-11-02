package com.senku.app.agent

import android.content.Context

/** Agent model selection. Provider credentials are held only by the Edge Function. */
object AgentSettings {

  /** The selected mode is shared by the UI, Gemini tool bridge and background agent. */
  fun isLiveJev(context: Context): Boolean =
      context.getSharedPreferences("companion", Context.MODE_PRIVATE).getString("voice_provider", "gemini") == "livejev"

  fun planner(context: Context): String = if (isLiveJev(context)) "Gemini Live" else MODEL

  /** The only GPT model: the plan and every hand-off, with no fallback (user decision, 2026-10-24). */
  const val MODEL = "gpt-6-luna"
  /** Every GPT call except the plan, which uses "low". */
  const val EFFORT = "medium"
  /** Who decided a step. Jev decides every step; GPT fills in text, checks done and takes over. */
  const val DECIDER_GPT = "gpt"
  const val DECIDER_JEV = "jev"
  /** The task's first step: the plan's app, launched directly with no model call. */
  const val DECIDER_START = "start"
  /**
   * Clicks are real taps and scrolls real swipes, with the accessibility actions where no spot can be
   * touched safely (experiment, 2026-10-28: 88 of 252 accessibility clicks did nothing on web pages
   * and React Native views).
   */
  const val REAL_GESTURES = true

}
