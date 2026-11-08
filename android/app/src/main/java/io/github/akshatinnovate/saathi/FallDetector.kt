package io.github.akshatinnovate.saathi

import kotlin.math.abs
import kotlin.math.sqrt

class FallDetector(
    private val freeFallG: Double = 0.45,
    private val freeFallMillis: Long = 60,
    private val impactG: Double = 2.5,
    private val impactWindowMillis: Long = 1000,
    private val settleMillis: Long = 500,
    private val stillMillis: Long = 2000,
    private val stillToleranceG: Double = 0.3,
    private val giveUpMillis: Long = 6000,
) {
    private enum class Phase { IDLE, FALLING, IMPACT }

    private var phase = Phase.IDLE
    private var fallStart = -1L
    private var phaseStart = 0L
    private var stillStart = -1L

    var lastMovement: Long = 0
        private set

    fun feed(x: Float, y: Float, z: Float, millis: Long): Boolean {
        val g = sqrt((x * x + y * y + z * z).toDouble()) / EARTH
        if (abs(g - 1.0) > MOVEMENT_G) lastMovement = millis
        when (phase) {
            Phase.IDLE -> {
                if (g < freeFallG) {
                    if (fallStart < 0) fallStart = millis
                    if (millis - fallStart >= freeFallMillis) enter(Phase.FALLING, millis)
                } else {
                    fallStart = -1
                }
            }
            Phase.FALLING -> {
                if (g > impactG) enter(Phase.IMPACT, millis)
                else if (millis - phaseStart > impactWindowMillis) reset()
            }
            Phase.IMPACT -> {
                if (millis - phaseStart < settleMillis) return false
                if (abs(g - 1.0) <= stillToleranceG) {
                    if (stillStart < 0) stillStart = millis
                    if (millis - stillStart >= stillMillis) {
                        reset()
                        return true
                    }
                } else {
                    stillStart = -1
                }
                if (millis - phaseStart > giveUpMillis) reset()
            }
        }
        return false
    }

    private fun enter(next: Phase, millis: Long) {
        phase = next
        phaseStart = millis
        stillStart = -1
    }

    private fun reset() {
        phase = Phase.IDLE
        fallStart = -1
        stillStart = -1
    }

    companion object {
        const val EARTH = 9.80665
        const val MOVEMENT_G = 0.15
    }
}
