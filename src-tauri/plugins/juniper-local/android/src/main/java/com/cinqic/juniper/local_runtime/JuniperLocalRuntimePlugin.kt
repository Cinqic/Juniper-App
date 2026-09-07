package com.cinqic.juniper.local_runtime

import android.app.Activity
import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.math.max
import kotlin.math.min

@InvokeArg
class LoadModelArgs {
    lateinit var path: String
    var contextSize: Int = 2048
    var threads: Int = 2
    var expectedModelBytes: Long = 0
}

@InvokeArg
class StatusArgs {
    var requestId: String? = null
}

@InvokeArg
class GenerateArgs {
    lateinit var requestId: String
    lateinit var messagesJson: String
    var maxOutput: Int = 256
    var temperature: Double = 0.3
}

@InvokeArg
class EventArgs {
    lateinit var requestId: String
}

internal data class NativeEvent(
    val kind: String,
    val requestId: String,
    val text: String? = null,
    val code: String? = null,
    val message: String? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val durationMs: Long? = null,
)

private class NativeCallbacks(
    private val owner: EngineOwner,
) {
    fun onDelta(requestId: String, text: String) {
        owner.enqueue(NativeEvent("delta", requestId, text = text))
    }

    fun onTerminal(
        requestId: String,
        code: String?,
        message: String?,
        inputTokens: Int,
        outputTokens: Int,
        durationMs: Long,
    ) {
        owner.enqueue(
            NativeEvent(
                "done",
                requestId,
                code = code,
                message = message,
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                durationMs = durationMs,
            ),
        )
    }
}

/**
 * Process-scoped owner for the one allowed GGUF model. All model loads and
 * generations are serialized on a background coroutine; cancellation is an
 * atomic native flag so it can interrupt both prompt evaluation and decoding.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
internal object EngineOwner {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))
    private val events = ConcurrentHashMap<String, ConcurrentLinkedQueue<NativeEvent>>()
    @Volatile private var nativeHandle: Long = 0
    private var appContext: Context? = null
    private var callbacksRegistered = false
    @Volatile private var runtimeAvailable: Boolean = false
    @Volatile private var state: String = "unavailable"
    @Volatile private var loadedPath: String? = null
    @Volatile private var loadedBytes: Long? = null
    @Volatile private var loadedContextSize: Int? = null
    @Volatile private var activeRequest: String? = null
    @Volatile private var lifecycleGeneration: Long = 0
    @Volatile private var failureCode: String? = null
    @Volatile private var failureMessage: String? = null
    private val abi: String? = Build.SUPPORTED_ABIS.firstOrNull { it == "arm64-v8a" || it == "x86_64" }

    fun initialize(context: Context, nativeLibraryDir: String) {
        if (appContext == null) appContext = context.applicationContext
        if (!callbacksRegistered) {
            appContext?.registerComponentCallbacks(object : ComponentCallbacks2 {
                override fun onTrimMemory(level: Int) {
                    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) unload()
                }

                override fun onLowMemory() = unload()

                override fun onConfigurationChanged(newConfig: Configuration) = Unit
            })
            callbacksRegistered = true
        }
        if (nativeHandle != 0L) return
        nativeHandle = try {
            System.loadLibrary("juniper_llama_jni")
            loadPackagedCpuBackend()
            nativeCreate(nativeLibraryDir)
        } catch (_: UnsatisfiedLinkError) {
            0
        }
        runtimeAvailable = nativeHandle != 0L && abi != null
        if (runtimeAvailable) {
            state = "unavailable"
            failureCode = null
            failureMessage = null
        } else {
            setFailure(
                if (abi == null) "LOCAL_UNSUPPORTED_ABI" else "LOCAL_RUNTIME_UNAVAILABLE",
                if (abi == null) {
                    "This Android ABI is not packaged for the native local runtime."
                } else {
                    "The Android native library could not be loaded."
                },
            )
        }
    }

    private fun loadPackagedCpuBackend() {
        val candidates = when (abi) {
            "arm64-v8a" -> listOf(
                "ggml-cpu-android_armv9.2_2",
                "ggml-cpu-android_armv9.2_1",
                "ggml-cpu-android_armv9.0_1",
                "ggml-cpu-android_armv8.6_1",
                "ggml-cpu-android_armv8.2_2",
                "ggml-cpu-android_armv8.2_1",
                "ggml-cpu-android_armv8.0_1",
            )
            "x86_64" -> listOf("ggml-cpu-x64")
            else -> emptyList()
        }
        var loaded = false
        for (candidate in candidates) {
            try {
                System.loadLibrary(candidate)
                loaded = true
            } catch (_: UnsatisfiedLinkError) {
                // The C++ loader will apply the same ordered list and report
                // a clear runtime failure if no packaged backend is usable.
            }
        }
        if (!loaded && candidates.isNotEmpty()) {
            throw UnsatisfiedLinkError("No packaged CPU backend could be loaded")
        }
    }

    private data class MemorySnapshot(
        val totalBytes: Long,
        val availableBytes: Long,
        val lowMemory: Boolean,
    )

    private fun memorySnapshot(): MemorySnapshot? {
        val manager = appContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        return MemorySnapshot(info.totalMem, info.availMem, info.lowMemory)
    }

    private fun setFailure(code: String, message: String) {
        loadedPath = null
        loadedBytes = null
        loadedContextSize = null
        failureCode = code
        failureMessage = message
        state = "failed"
    }

    private fun preflightFailure(args: LoadModelArgs): Pair<String, String>? {
        if (abi == null) {
            return "LOCAL_UNSUPPORTED_ABI" to "This Android ABI is not packaged for the native local runtime."
        }
        val model = File(args.path)
        if (!model.isFile || !model.canRead()) {
            return "LOCAL_MODEL_NOT_READY" to "The verified managed model is not readable from app-private storage."
        }
        val dataRoot = appContext?.dataDir?.canonicalFile
        val canonicalModel = runCatching { model.canonicalFile }.getOrNull()
        if (dataRoot == null || canonicalModel == null ||
            !canonicalModel.path.startsWith(dataRoot.path + File.separator)
        ) {
            return "LOCAL_MODEL_NOT_READY" to "The managed model must remain in app-private storage."
        }
        val memory = memorySnapshot() ?: return null
        val modelBytes = max(args.expectedModelBytes, model.length())
        val contextBytes = args.contextSize.coerceIn(512, 2048).toLong() * 128L * 1024L
        val nativeOverhead = 256L * 1024L * 1024L
        val requiredBytes = modelBytes + contextBytes + nativeOverhead
        val osReserve = max(512L * 1024L * 1024L, memory.totalBytes / 4L)
        val safeBudget = max(0L, memory.totalBytes - osReserve)
        val availableBudget = min(memory.availableBytes, safeBudget)
        if (memory.lowMemory || requiredBytes > availableBudget) {
            return "LOCAL_MEMORY_UNSAFE" to
                "The model needs about ${requiredBytes / (1024L * 1024L)} MiB, but Android reports only " +
                "${availableBudget / (1024L * 1024L)} MiB safe for native loading."
        }
        return null
    }

    fun load(args: LoadModelArgs) {
        if (nativeHandle == 0L || !runtimeAvailable) {
            setFailure("LOCAL_RUNTIME_UNAVAILABLE", "The Android native runtime is unavailable for this ABI.")
            return
        }
        preflightFailure(args)?.let { (code, message) ->
            setFailure(code, message)
            return
        }
        val generation = lifecycleGeneration
        scope.launch {
            if (generation != lifecycleGeneration) return@launch
            state = "loading"
            failureCode = null
            failureMessage = null
            val contextSize = args.contextSize.coerceIn(512, 2048)
            val result = nativeLoad(nativeHandle, args.path, contextSize, args.threads.coerceIn(2, 4))
            if (generation != lifecycleGeneration) return@launch
            if (result == 0) {
                loadedPath = args.path
                loadedBytes = File(args.path).length()
                loadedContextSize = contextSize
                state = "ready"
            } else {
                setFailure(
                    when (result) {
                        1 -> "LOCAL_MODEL_NOT_READY"
                        2 -> "LOCAL_MODEL_TOO_LARGE"
                        3, 4, 7 -> "LOCAL_GGUF_REJECTED"
                        5 -> "LOCAL_CONTEXT_UNSUPPORTED"
                        6, 8 -> "LOCAL_MEMORY_UNSAFE"
                        9 -> "LOCAL_MODEL_LOAD_FAILED"
                        else -> "LOCAL_MODEL_LOAD_FAILED"
                    },
                    when (result) {
                        1 -> "The verified managed model is no longer readable."
                        2 -> "The managed model is larger than the Android native runtime limit."
                        3, 4, 7 -> "The managed file is not a compatible decoder GGUF model."
                        5 -> "The managed model does not support the required context size."
                        6, 8 -> "The native engine could not allocate safe model memory."
                        9 -> "The native engine could not load the compatible managed model."
                        else -> "The managed GGUF could not be loaded by the native engine."
                    },
                )
            }
        }
    }

    fun start(args: GenerateArgs) {
        if (nativeHandle == 0L || state != "ready") {
            enqueue(NativeEvent("done", args.requestId, code = "LOCAL_MODEL_NOT_READY", message = "The local model is not loaded."))
            return
        }
        if (activeRequest != null) {
            enqueue(NativeEvent("done", args.requestId, code = "LOCAL_RUNTIME_BUSY", message = "Another local generation is already running."))
            return
        }
        activeRequest = args.requestId
        events[args.requestId] = ConcurrentLinkedQueue()
        state = "busy"
        val generation = lifecycleGeneration
        scope.launch {
            if (generation != lifecycleGeneration) {
                enqueue(
                    NativeEvent(
                        "done",
                        args.requestId,
                        code = "LOCAL_MODEL_NOT_READY",
                        message = "The local model is no longer loaded.",
                    ),
                )
                activeRequest = null
                return@launch
            }
            try {
                nativeStartGenerate(
                    nativeHandle,
                    args.requestId,
                    args.messagesJson,
                    args.maxOutput.coerceIn(1, 512),
                    args.temperature.toFloat().coerceIn(0.0f, 2.0f),
                    NativeCallbacks(this@EngineOwner),
                )
            } catch (_: Throwable) {
                enqueue(NativeEvent("done", args.requestId, code = "NATIVE_GENERATION_FAILED", message = "The native engine failed during generation."))
            } finally {
                activeRequest = null
                if (generation == lifecycleGeneration && nativeHandle != 0L) state = "ready"
            }
        }
    }

    fun cancel(requestId: String) {
        if (nativeHandle != 0L && activeRequest == requestId) nativeCancel(nativeHandle, requestId)
    }

    fun poll(requestId: String): NativeEvent? {
        val queue = events[requestId] ?: return null
        val event = queue.poll()
        if (event?.kind == "done") events.remove(requestId, queue)
        return event
    }

    fun status(): JSObject = JSObject().apply {
        val memory = memorySnapshot()
        put("state", state)
        put("loadedPath", loadedPath)
        put("activeRequest", activeRequest)
        put("runtimeAvailable", runtimeAvailable)
        put("abi", abi)
        put("totalMemoryBytes", memory?.totalBytes)
        put("availableMemoryBytes", memory?.availableBytes)
        put("lowMemory", memory?.lowMemory)
        put(
            "memoryPressure",
            memory?.let {
                when {
                    it.lowMemory -> "high"
                    it.availableBytes * 2 >= it.totalBytes -> "low"
                    it.availableBytes * 5 >= it.totalBytes -> "medium"
                    else -> "high"
                }
            },
        )
        put("loadedBytes", loadedBytes)
        put("contextSize", loadedContextSize)
        put("failureCode", failureCode)
        put("failureMessage", failureMessage)
    }

    fun unload() {
        if (nativeHandle == 0L) return
        val generation = lifecycleGeneration + 1
        lifecycleGeneration = generation
        activeRequest?.let { nativeCancel(nativeHandle, it) }
        state = "unloading"
        scope.launch {
            nativeUnload(nativeHandle)
            if (generation != lifecycleGeneration) return@launch
            loadedPath = null
            loadedBytes = null
            loadedContextSize = null
            activeRequest = null
            state = "unavailable"
        }
    }

    fun enqueue(event: NativeEvent) {
        events.computeIfAbsent(event.requestId) { ConcurrentLinkedQueue() }.add(event)
    }

    private external fun nativeCreate(nativeLibraryDir: String): Long
    private external fun nativeLoad(handle: Long, path: String, contextSize: Int, threads: Int): Int
    private external fun nativeStartGenerate(
        handle: Long,
        requestId: String,
        messagesJson: String,
        maxOutput: Int,
        temperature: Float,
        callbacks: NativeCallbacks,
    ): Int
    private external fun nativeCancel(handle: Long, requestId: String)
    private external fun nativeUnload(handle: Long)
}

@TauriPlugin
class JuniperLocalRuntimePlugin(private val activity: Activity) : Plugin(activity) {
    init {
        EngineOwner.initialize(activity.applicationContext, activity.applicationInfo.nativeLibraryDir)
    }

    @Command
    fun loadModel(invoke: Invoke) {
        try {
            EngineOwner.load(invoke.parseArgs(LoadModelArgs::class.java))
            invoke.resolve(JSObject().apply { put("accepted", true) })
        } catch (error: Exception) {
            invoke.reject("LOCAL_RUNTIME_LOAD_FAILED: ${error.message ?: "The model could not be loaded."}")
        }
    }

    @Command
    fun pollStatus(invoke: Invoke) {
        invoke.resolve(EngineOwner.status())
    }

    @Command
    fun startGenerate(invoke: Invoke) {
        try {
            EngineOwner.start(invoke.parseArgs(GenerateArgs::class.java))
            invoke.resolve(JSObject().apply { put("accepted", true) })
        } catch (error: Exception) {
            invoke.reject("LOCAL_RUNTIME_GENERATION_FAILED: ${error.message ?: "Generation could not start."}")
        }
    }

    @Command
    fun pollEvent(invoke: Invoke) {
        val args = invoke.parseArgs(EventArgs::class.java)
        val event = EngineOwner.poll(args.requestId)
        val response = JSObject().apply {
            put("available", event != null)
            if (event != null) {
                put("kind", event.kind)
                put("requestId", event.requestId)
                put("text", event.text)
                put("code", event.code)
                put("message", event.message)
                put("inputTokens", event.inputTokens)
                put("outputTokens", event.outputTokens)
                put("durationMs", event.durationMs)
            }
        }
        invoke.resolve(response)
    }

    @Command
    fun cancel(invoke: Invoke) {
        val args = invoke.parseArgs(EventArgs::class.java)
        EngineOwner.cancel(args.requestId)
        invoke.resolve(JSObject().apply { put("accepted", true) })
    }

    @Command
    fun unload(invoke: Invoke) {
        EngineOwner.unload()
        invoke.resolve(JSObject().apply { put("accepted", true) })
    }

    @Command
    fun memoryPressure(invoke: Invoke) {
        EngineOwner.unload()
        invoke.resolve(JSObject().apply { put("accepted", true) })
    }

    override fun onStop() {
        // The model remains managed on disk but native allocations are released
        // when the activity leaves the foreground; the next send reloads safely.
        EngineOwner.unload()
        super.onStop()
    }

    override fun onDestroy() {
        EngineOwner.unload()
        super.onDestroy()
    }
}
