package com.cinqic.juniper.local_runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real-device/emulator smoke for the in-process runtime. The model is pushed
 * by scripts/run-android-inference-smoke.sh and is never committed to git.
 */
@RunWith(AndroidJUnit4::class)
class JuniperLocalRuntimeInferenceTest {
    private companion object {
        // The hosted x86_64 emulator runs without hardware acceleration. Keep
        // this device smoke bounded while still exercising the runtime's
        // minimum supported context and real streaming/cancellation paths.
        const val smokeContextSize = 512
    }

    private data class GenerationResult(
        val deltas: String,
        val terminal: NativeEvent,
    )

    @Test(timeout = 300_000)
    fun verifiedModelStreamsCancelsUnloadsAndReloads() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val modelArgument = InstrumentationRegistry.getArguments().getString("model_path")
            ?: throw AssertionError("model_path instrumentation argument is required")
        val context = instrumentation.targetContext
        val argumentFile = File(modelArgument)
        val model = if (argumentFile.isAbsolute) argumentFile else File(context.filesDir, argumentFile.path)
        assertTrue("model is not readable: " + model.path, model.isFile && model.canRead())

        EngineOwner.initialize(context, context.applicationInfo.nativeLibraryDir)
        try {
            val loadArgs = LoadModelArgs().apply {
                path = model.absolutePath
                contextSize = smokeContextSize
                threads = 2
                expectedModelBytes = model.length()
            }
            EngineOwner.load(loadArgs)
            awaitState("ready")

            val cold = generate("Say hello in one short sentence.", maxOutput = 16)
            assertTrue("cold generation emitted no text", cold.deltas.isNotBlank())
            assertTrue("cold generation was not successful", cold.terminal.code.isNullOrEmpty())

            val warm = generate(
                "Reply with exactly one short word: ready.",
                maxOutput = 8,
            )
            assertTrue("warm generation emitted no text", warm.deltas.isNotBlank())
            assertTrue("warm generation was not successful", warm.terminal.code.isNullOrEmpty())

            cancelDuringPrefill()
            cancelDuringDecode()

            EngineOwner.unload()
            awaitState("unavailable")
            EngineOwner.load(loadArgs)
            awaitState("ready")
            val reloaded = generate("Say reload.", maxOutput = 8)
            assertTrue("reloaded generation emitted no text", reloaded.deltas.isNotBlank())
            assertTrue("reloaded generation was not successful", reloaded.terminal.code.isNullOrEmpty())
        } finally {
            EngineOwner.unload()
        }
    }

    private fun cancelDuringPrefill() {
        val requestId = "prefill-" + UUID.randomUUID()
        val longPrompt = buildString {
            repeat(120) { append(" prefill") }
        }
        EngineOwner.start(
            GenerateArgs().apply {
                this.requestId = requestId
                messagesJson = messages(longPrompt)
                maxOutput = 64
                temperature = 0.3
            },
        )
        Thread.sleep(100)
        val cancellationStarted = System.nanoTime()
        EngineOwner.cancel(requestId)
        val result = awaitTerminal(requestId)
        val latencyMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - cancellationStarted)
        assertEquals("prefill cancellation did not terminate", "REQUEST_CANCELLED", result.terminal.code)
        assertTrue(
            "prefill cancellation exceeded 1.5 seconds: " + latencyMs + "ms",
            latencyMs <= 1_500,
        )
        awaitState("ready")
    }

    private fun cancelDuringDecode() {
        val requestId = "decode-" + UUID.randomUUID()
        EngineOwner.start(
            GenerateArgs().apply {
                this.requestId = requestId
                messagesJson = messages("Write a long but harmless list of short words.")
                maxOutput = 128
                temperature = 0.3
            },
        )

        val deltasBeforeCancellation = StringBuilder()
        val waitUntil = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (System.nanoTime() < waitUntil) {
            val event = EngineOwner.poll(requestId)
            if (event == null) {
                Thread.sleep(20)
                continue
            }
            when (event.kind) {
                "delta" -> {
                    deltasBeforeCancellation.append(event.text.orEmpty())
                    val cancellationStarted = System.nanoTime()
                    EngineOwner.cancel(requestId)
                    val result = awaitTerminal(requestId, deltasBeforeCancellation)
                    val latencyMs =
                        TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - cancellationStarted)
                    assertEquals(
                        "decode cancellation did not terminate",
                        "REQUEST_CANCELLED",
                        result.terminal.code,
                    )
                    assertTrue(
                        "decode cancellation exceeded 1.5 seconds: " + latencyMs + "ms",
                        latencyMs <= 1_500,
                    )
                    awaitState("ready")
                    return
                }
                "done" -> fail("decode completed before cancellation: " + event.code)
                else -> fail("unexpected native event kind: " + event.kind)
            }
        }
        fail("decode did not emit a delta within 20 seconds")
    }

    private fun generate(prompt: String, maxOutput: Int): GenerationResult {
        val requestId = "generate-" + UUID.randomUUID()
        EngineOwner.start(
            GenerateArgs().apply {
                this.requestId = requestId
                messagesJson = messages(prompt)
                this.maxOutput = maxOutput
                temperature = 0.3
            },
        )
        return awaitTerminal(requestId)
    }

    private fun awaitTerminal(
        requestId: String,
        deltasAlreadySeen: StringBuilder = StringBuilder(),
    ): GenerationResult {
        val waitUntil = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        var terminal: NativeEvent? = null
        while (System.nanoTime() < waitUntil) {
            val event = EngineOwner.poll(requestId)
            if (event == null) {
                Thread.sleep(20)
                continue
            }
            when (event.kind) {
                "delta" -> {
                    assertNull("delta arrived after terminal", terminal)
                    deltasAlreadySeen.append(event.text.orEmpty())
                }
                "done" -> {
                    assertNull("duplicate terminal event", terminal)
                    terminal = event
                }
                else -> fail("unexpected native event kind: " + event.kind)
            }
            if (terminal != null) {
                val completed = terminal
                Thread.sleep(100)
                assertNull("event remained after terminal", EngineOwner.poll(requestId))
                return GenerationResult(deltasAlreadySeen.toString(), completed)
            }
        }
        throw AssertionError("generation did not terminate within 60 seconds")
    }

    private fun awaitState(expected: String) {
        val waitUntil = System.nanoTime() + TimeUnit.SECONDS.toNanos(120)
        var lastState = "unknown"
        while (System.nanoTime() < waitUntil) {
            lastState = EngineOwner.status().optString("state", "unknown")
            if (lastState == expected) return
            if (lastState == "failed") {
                val status = EngineOwner.status()
                fail(
                    "native load failed: " +
                        status.optString("failureCode", "unknown") + ": " +
                        status.optString("failureMessage", "unknown"),
                )
            }
            Thread.sleep(50)
        }
        fail("timed out waiting for state " + expected + "; last state was " + lastState)
    }

    private fun messages(content: String): String =
        "[{\"role\":\"user\",\"content\":" + jsonString(content) + "}]"

    private fun jsonString(value: String): String =
        buildString {
            append('\"')
            value.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '\"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> append(character)
                }
            }
            append('\"')
        }
}
