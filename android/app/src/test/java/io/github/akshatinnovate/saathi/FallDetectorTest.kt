package io.github.akshatinnovate.saathi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FallDetectorTest {

    private class Phone {
        val detector = FallDetector()
        var time = 0L
        var falls = 0

        fun hold(g: Double, millis: Long, wobble: Double = 0.0) {
            val end = time + millis
            var n = 0
            while (time < end) {
                val swing = if (wobble == 0.0) 0.0 else if (n % 2 == 0) wobble else -wobble
                val a = ((g + swing) * FallDetector.EARTH).toFloat()
                if (detector.feed(0f, 0f, a, time)) falls++
                time += 20
                n++
            }
        }
    }

    @Test
    fun aRealFallIsNoticedOnce() {
        val phone = Phone()
        phone.hold(1.0, 1000, 0.3)
        phone.hold(0.2, 300)
        phone.hold(3.2, 60)
        phone.hold(1.0, 3000)
        assertEquals(1, phone.falls)
    }

    @Test
    fun walkingSittingAndClimbingStairsAreNotFalls() {
        val phone = Phone()
        phone.hold(1.0, 5000, 0.35)
        phone.hold(1.9, 200)
        phone.hold(1.0, 2000)
        phone.hold(0.6, 400)
        phone.hold(1.4, 400)
        phone.hold(1.0, 3000)
        assertEquals(0, phone.falls)
    }

    @Test
    fun gettingStraightBackUpIsNotReported() {
        val phone = Phone()
        phone.hold(0.2, 300)
        phone.hold(3.0, 60)
        phone.hold(1.0, 600)
        phone.hold(1.0, 4000, 0.6)
        phone.hold(1.0, 3000, 0.6)
        assertEquals(0, phone.falls)
    }

    @Test
    fun aFreeFallWithoutAnImpactIsIgnored() {
        val phone = Phone()
        phone.hold(0.2, 300)
        phone.hold(1.0, 3000)
        assertEquals(0, phone.falls)
    }

    @Test
    fun movementIsTrackedForStillnessChecks() {
        val phone = Phone()
        phone.hold(1.0, 1000, 0.4)
        val moved = phone.detector.lastMovement
        phone.hold(1.0, 5000)
        assertEquals(moved, phone.detector.lastMovement)
        assertTrue(moved > 0)
    }
}
