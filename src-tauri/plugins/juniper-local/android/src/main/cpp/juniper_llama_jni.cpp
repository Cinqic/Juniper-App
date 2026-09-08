#include <jni.h>
#include <android/log.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <vector>

#include "chat.h"
#include "common.h"
#include "ggml-backend.h"
#include "gguf.h"
#include "json.h"
#include "juniper_llama_contract.h"
#include "sampling.h"
#include "llama.h"

namespace {

void android_llama_log(enum ggml_log_level level, const char * text, void *) {
    if (text == nullptr || ((text[0] == '.' || text[0] == '\n') && text[1] == '\0')) return;
    if (level >= GGML_LOG_LEVEL_ERROR) __android_log_write(ANDROID_LOG_ERROR, "JuniperNative", text);
}

constexpr uint32_t kDefaultContext = 2048;
constexpr uint32_t kBatchSize = 256;
constexpr uint64_t kMaximumModelBytes = 2ULL * 1024ULL * 1024ULL * 1024ULL;
struct Engine {
    llama_model * model = nullptr;
    llama_context * context = nullptr;
    common_chat_templates_ptr templates;
    common_sampler * sampler = nullptr;
    juniper_local::CancellationToken cancelled;
    std::mutex mutex;
    std::mutex request_mutex;
    std::string active_request_id;
    std::string pending_cancel_request_id;

    ~Engine() { unload_locked(); }

    void unload_locked() {
        if (sampler != nullptr) {
            common_sampler_free(sampler);
            sampler = nullptr;
        }
        templates.reset();
        if (context != nullptr) {
            llama_free(context);
            context = nullptr;
        }
        if (model != nullptr) {
            llama_model_free(model);
            model = nullptr;
        }
        cancelled.store(false);
    }

    static bool abort_callback(void * data) {
        return static_cast<Engine *>(data)->cancelled.load();
    }

    void begin_request(const std::string & request_id) {
        std::lock_guard lock(request_mutex);
        active_request_id = request_id;
        cancelled.store(pending_cancel_request_id == request_id);
        if (pending_cancel_request_id == request_id) pending_cancel_request_id.clear();
    }

    void end_request(const std::string & request_id) {
        std::lock_guard lock(request_mutex);
        if (active_request_id == request_id) active_request_id.clear();
        if (pending_cancel_request_id == request_id) pending_cancel_request_id.clear();
        cancelled.store(false);
    }

    void request_cancel(const std::string & request_id) {
        std::lock_guard lock(request_mutex);
        if (request_id.empty()) {
            if (!active_request_id.empty()) cancelled.store(true);
            return;
        }
        if (active_request_id == request_id) {
            cancelled.store(true);
        } else {
            // Kotlin can accept a request before its coroutine enters JNI.
            // Preserve that cancellation for the matching native request.
            pending_cancel_request_id = request_id;
        }
    }

    static bool validate_gguf_metadata(const std::string & path) {
        gguf_init_params metadata_params{};
        metadata_params.no_alloc = true;
        metadata_params.ctx = nullptr;
        gguf_context * metadata = gguf_init_from_file(path.c_str(), metadata_params);
        if (metadata == nullptr) return false;

        const int64_t architecture_key = gguf_find_key(metadata, "general.architecture");
        const int64_t tokenizer_model_key = gguf_find_key(metadata, "tokenizer.ggml.model");
        const int64_t tokenizer_tokens_key = gguf_find_key(metadata, "tokenizer.ggml.tokens");
        const bool valid =
            gguf_get_version(metadata) == GGUF_VERSION &&
            gguf_get_n_tensors(metadata) > 0 &&
            architecture_key >= 0 &&
            gguf_get_kv_type(metadata, architecture_key) == GGUF_TYPE_STRING &&
            gguf_get_val_str(metadata, architecture_key) != nullptr &&
            gguf_get_val_str(metadata, architecture_key)[0] != '\0' &&
            tokenizer_model_key >= 0 &&
            gguf_get_kv_type(metadata, tokenizer_model_key) == GGUF_TYPE_STRING &&
            gguf_get_val_str(metadata, tokenizer_model_key) != nullptr &&
            tokenizer_tokens_key >= 0 &&
            gguf_get_kv_type(metadata, tokenizer_tokens_key) == GGUF_TYPE_ARRAY &&
            gguf_get_arr_n(metadata, tokenizer_tokens_key) > 0;
        gguf_free(metadata);
        return valid;
    }

    int load(const std::string & path, uint32_t requested_context, int32_t threads) {
        std::lock_guard lock(mutex);
        unload_locked();
        const auto load_started = std::chrono::steady_clock::now();
        __android_log_print(
            ANDROID_LOG_INFO,
            "JuniperNative",
            "native load begin: backends=%zu cpu=%s",
            ggml_backend_dev_count(),
            ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU) == nullptr ? "missing" : "present");
        struct stat model_stat {};
        if (::stat(path.c_str(), &model_stat) != 0 || !S_ISREG(model_stat.st_mode)) return 1;
        if (model_stat.st_size < 0 || static_cast<uint64_t>(model_stat.st_size) > kMaximumModelBytes) return 2;
        if (!validate_gguf_metadata(path)) return 3;

        llama_model_params model_params = llama_model_default_params();
        model_params.n_gpu_layers = 0;
        model = llama_model_load_from_file(path.c_str(), model_params);
        if (model == nullptr) {
            __android_log_write(ANDROID_LOG_ERROR, "JuniperNative", "native load failed inside llama_model_load_from_file");
            return 9;
        }
        __android_log_print(
            ANDROID_LOG_INFO,
            "JuniperNative",
            "native model weights loaded: elapsed_ms=%lld",
            static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - load_started).count()));
        if (!llama_model_has_decoder(model)) {
            unload_locked();
            return 4;
        }

        const uint32_t trained_context = llama_model_n_ctx_train(model);
        const uint32_t context_size = std::min(
            requested_context == 0 ? kDefaultContext : requested_context,
            trained_context == 0 ? kDefaultContext : trained_context);
        if (context_size < 512) {
            unload_locked();
            return 5;
        }

        llama_context_params context_params = llama_context_default_params();
        context_params.n_ctx = context_size;
        context_params.n_batch = kBatchSize;
        context_params.n_ubatch = kBatchSize;
        context_params.n_threads = std::clamp(threads, 2, 4);
        context_params.n_threads_batch = context_params.n_threads;
        context_params.abort_callback = abort_callback;
        context_params.abort_callback_data = this;
        context = llama_init_from_model(model, context_params);
        if (context == nullptr) {
            unload_locked();
            return 6;
        }

        templates = common_chat_templates_init(model, "");
        if (!templates) {
            unload_locked();
            return 7;
        }
        common_params_sampling sampling;
        sampling.temp = 0.3f;
        sampling.top_p = 0.95f;
        sampling.top_k = 40;
        sampler = common_sampler_init(model, sampling);
        if (sampler == nullptr) {
            unload_locked();
            return 8;
        }
        cancelled.store(false);
        __android_log_print(
            ANDROID_LOG_INFO,
            "JuniperNative",
            "native load ready: elapsed_ms=%lld context=%u threads=%d",
            static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - load_started).count()),
            context_size,
            context_params.n_threads);
        return 0;
    }

    static bool java_to_utf8(JNIEnv * env, jstring value, std::string & output) {
        if (value == nullptr) {
            output.clear();
            return true;
        }
        const jsize length = env->GetStringLength(value);
        const jchar * chars = env->GetStringChars(value, nullptr);
        if (chars == nullptr) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            return false;
        }
        std::u16string utf16;
        utf16.reserve(static_cast<std::size_t>(length));
        for (jsize index = 0; index < length; ++index) {
            utf16.push_back(static_cast<char16_t>(chars[index]));
        }
        env->ReleaseStringChars(value, chars);
        output = juniper_local::utf16_to_utf8(utf16);
        return true;
    }

    static jstring java_string(JNIEnv * env, const std::string & value) {
        const std::u16string utf16 = juniper_local::utf8_to_utf16(value);
        return env->NewString(
            reinterpret_cast<const jchar *>(utf16.data()), static_cast<jsize>(utf16.size()));
    }

    static bool emit_delta(JNIEnv * env, jobject callbacks, const std::string & request_id, const std::string & text) {
        jclass cls = env->GetObjectClass(callbacks);
        if (cls == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            return false;
        }
        jmethodID method = env->GetMethodID(cls, "onDelta", "(Ljava/lang/String;Ljava/lang/String;)V");
        if (method == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            env->DeleteLocalRef(cls);
            return false;
        }
        jstring request = java_string(env, request_id);
        jstring delta = java_string(env, text);
        if (request == nullptr || delta == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            if (request != nullptr) env->DeleteLocalRef(request);
            if (delta != nullptr) env->DeleteLocalRef(delta);
            env->DeleteLocalRef(cls);
            return false;
        }
        env->CallVoidMethod(callbacks, method, request, delta);
        const bool callback_failed = env->ExceptionCheck();
        if (callback_failed) env->ExceptionClear();
        env->DeleteLocalRef(request);
        env->DeleteLocalRef(delta);
        env->DeleteLocalRef(cls);
        return !callback_failed;
    }

    static bool emit_phase(JNIEnv * env, jobject callbacks, const std::string & request_id, const char * phase) {
        jclass cls = env->GetObjectClass(callbacks);
        if (cls == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            return false;
        }
        jmethodID method = env->GetMethodID(cls, "onPhase", "(Ljava/lang/String;Ljava/lang/String;)V");
        if (method == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            env->DeleteLocalRef(cls);
            return false;
        }
        jstring request = java_string(env, request_id);
        jstring phase_string = java_string(env, phase == nullptr ? "" : phase);
        if (request == nullptr || phase_string == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            if (request != nullptr) env->DeleteLocalRef(request);
            if (phase_string != nullptr) env->DeleteLocalRef(phase_string);
            env->DeleteLocalRef(cls);
            return false;
        }
        env->CallVoidMethod(callbacks, method, request, phase_string);
        const bool callback_failed = env->ExceptionCheck();
        if (callback_failed) env->ExceptionClear();
        env->DeleteLocalRef(request);
        env->DeleteLocalRef(phase_string);
        env->DeleteLocalRef(cls);
        return !callback_failed;
    }

    static bool emit_terminal(
        JNIEnv * env,
        jobject callbacks,
        const std::string & request_id,
        const char * code,
        const char * message,
        int input_tokens,
        int output_tokens,
        int64_t duration_ms) {
        jclass cls = env->GetObjectClass(callbacks);
        if (cls == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            return false;
        }
        jmethodID method = env->GetMethodID(
            cls,
            "onTerminal",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IIJ)V");
        if (method == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            env->DeleteLocalRef(cls);
            return false;
        }
        jstring request = java_string(env, request_id);
        jstring code_string = java_string(env, code == nullptr ? "" : code);
        jstring message_string = java_string(env, message == nullptr ? "" : message);
        if (request == nullptr || code_string == nullptr || message_string == nullptr || env->ExceptionCheck()) {
            if (env->ExceptionCheck()) env->ExceptionClear();
            if (request != nullptr) env->DeleteLocalRef(request);
            if (code_string != nullptr) env->DeleteLocalRef(code_string);
            if (message_string != nullptr) env->DeleteLocalRef(message_string);
            env->DeleteLocalRef(cls);
            return false;
        }
        env->CallVoidMethod(callbacks, method, request, code_string, message_string, input_tokens, output_tokens, duration_ms);
        const bool callback_failed = env->ExceptionCheck();
        if (callback_failed) env->ExceptionClear();
        env->DeleteLocalRef(request);
        env->DeleteLocalRef(code_string);
        env->DeleteLocalRef(message_string);
        env->DeleteLocalRef(cls);
        return !callback_failed;
    }

    int generate(
        JNIEnv * env,
        jobject callbacks,
        const std::string & request_id,
        const std::string & messages_json,
        int max_output,
        float temperature) {
        std::lock_guard lock(mutex);
        if (model == nullptr || context == nullptr || templates == nullptr) {
            emit_terminal(env, callbacks, request_id, "LOCAL_MODEL_NOT_READY", "The local model is not loaded.", 0, 0, 0);
            return 0;
        }
        cancelled.store(false);
        const auto started = std::chrono::steady_clock::now();
        int input_tokens = 0;
        int output_tokens = 0;
        auto finish = [&](const char * code, const char * message) {
            const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - started).count();
            __android_log_print(
                code == nullptr ? ANDROID_LOG_INFO : ANDROID_LOG_WARN,
                "JuniperNative",
                "native generation terminal: code=%s input_tokens=%d output_tokens=%d elapsed_ms=%lld",
                code == nullptr ? "ok" : code,
                input_tokens,
                output_tokens,
                static_cast<long long>(duration));
            emit_terminal(env, callbacks, request_id, code, message, input_tokens, output_tokens, duration);
        };

        begin_request(request_id);
        struct RequestScope {
            Engine * engine;
            const std::string & request_id;
            ~RequestScope() { engine->end_request(request_id); }
        } request_scope{this, request_id};
        if (cancelled.load()) {
            finish("REQUEST_CANCELLED", "Generation cancelled.");
            return 0;
        }

        try {
            if (messages_json.size() > juniper_local::kMaximumMessagesJsonBytes) {
                finish("PROMPT_TOO_LARGE", "The chat messages exceed the native input limit.");
                return 0;
            }
            if (!juniper_local::is_valid_generation_parameters(max_output, temperature, 2)) {
                finish("INVALID_PARAMETERS", "The generation parameters are outside the native limits.");
                return 0;
            }
            common_params_sampling sampling;
            sampling.temp = std::clamp(temperature, 0.0f, 2.0f);
            sampling.top_p = 0.95f;
            sampling.top_k = 40;
            if (sampler != nullptr) common_sampler_free(sampler);
            sampler = common_sampler_init(model, sampling);
            if (sampler == nullptr) {
                finish("NATIVE_MEMORY_ERROR", "The native engine could not initialize sampling.");
                return 0;
            }

            const common_json messages = common_json::parse(messages_json);
            common_chat_templates_inputs inputs;
            inputs.messages = common_chat_msgs_parse_oaicompat(messages);
            inputs.add_generation_prompt = true;
            inputs.use_jinja = true;
            const common_chat_params chat_params = common_chat_templates_apply(templates.get(), inputs);
            if (chat_params.prompt.empty()) {
                finish("PROMPT_FORMAT_FAILED", "The model chat template returned an empty prompt.");
                return 0;
            }

            auto tokens = common_tokenize(context, chat_params.prompt, true, true);
            input_tokens = static_cast<int>(tokens.size());
            const int output_limit = std::clamp(max_output, 1, 512);
            if (tokens.empty() || tokens.size() + static_cast<size_t>(output_limit) >= llama_n_ctx(context)) {
                finish("CONTEXT_TOO_LARGE", "The conversation is too large for this model's context.");
                return 0;
            }

            __android_log_print(
                ANDROID_LOG_INFO,
                "JuniperNative",
                "native prompt prepared: input_tokens=%d output_limit=%d",
                input_tokens,
                output_limit);

            llama_memory_clear(llama_get_memory(context), true);
            common_sampler_reset(sampler);
            llama_batch batch = llama_batch_init(kBatchSize, 0, 1);
            if (batch.token == nullptr) {
                finish("NATIVE_MEMORY_ERROR", "The native engine could not allocate a decode batch.");
                return 0;
            }
            const auto prefill_started = std::chrono::steady_clock::now();
            if (!emit_phase(env, callbacks, request_id, "prefill_started")) {
                llama_batch_free(batch);
                finish("NATIVE_CALLBACK_FAILED", "The application stopped receiving native output.");
                return 0;
            }
            for (size_t offset = 0; offset < tokens.size(); offset += kBatchSize) {
                if (cancelled.load()) {
                    llama_batch_free(batch);
                    finish("REQUEST_CANCELLED", "Generation cancelled.");
                    return 0;
                }
                common_batch_clear(batch);
                const size_t end = std::min(tokens.size(), offset + kBatchSize);
                for (size_t index = offset; index < end; ++index) {
                    common_batch_add(batch, tokens[index], static_cast<llama_pos>(index), {0}, index + 1 == tokens.size());
                }
                if (!emit_phase(env, callbacks, request_id, "prefill_batch")) {
                    llama_batch_free(batch);
                    finish("NATIVE_CALLBACK_FAILED", "The application stopped receiving native output.");
                    return 0;
                }
                const int result = llama_decode(context, batch);
                if (result != 0) {
                    llama_batch_free(batch);
                    finish(cancelled.load() ? "REQUEST_CANCELLED" : "PREFILL_FAILED", cancelled.load() ? "Generation cancelled." : "The model could not evaluate the prompt.");
                    return 0;
                }
            }
            if (!emit_phase(env, callbacks, request_id, "prefill_complete")) {
                llama_batch_free(batch);
                finish("NATIVE_CALLBACK_FAILED", "The application stopped receiving native output.");
                return 0;
            }
            __android_log_print(
                ANDROID_LOG_INFO,
                "JuniperNative",
                "native prefill complete: input_tokens=%d elapsed_ms=%lld",
                input_tokens,
                static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now() - prefill_started).count()));

            const llama_vocab * vocab = llama_model_get_vocab(model);
            std::string utf8_buffer;
            for (int index = 0; index < output_limit; ++index) {
                if (cancelled.load()) {
                    llama_batch_free(batch);
                    finish("REQUEST_CANCELLED", "Generation cancelled.");
                    return 0;
                }
                const llama_token token = common_sampler_sample(sampler, context, -1);
                common_sampler_accept(sampler, token, true);
                if (llama_vocab_is_eog(vocab, token)) break;
                common_batch_clear(batch);
                common_batch_add(batch, token, static_cast<llama_pos>(tokens.size() + index), {0}, true);
                const auto first_decode_started = std::chrono::steady_clock::now();
                const int result = llama_decode(context, batch);
                if (index == 0) {
                    __android_log_print(
                        ANDROID_LOG_INFO,
                        "JuniperNative",
                        "native first decode complete: result=%d elapsed_ms=%lld",
                        result,
                        static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - first_decode_started).count()));
                }
                if (result != 0) {
                    llama_batch_free(batch);
                    finish(cancelled.load() ? "REQUEST_CANCELLED" : "DECODE_FAILED", cancelled.load() ? "Generation cancelled." : "The model failed during decoding.");
                    return 0;
                }
                ++output_tokens;
                utf8_buffer += common_token_to_piece(context, token, false);
                const size_t valid = juniper_local::valid_utf8_prefix(utf8_buffer);
                if (valid > 0) {
                    if (cancelled.load()) {
                        llama_batch_free(batch);
                        finish("REQUEST_CANCELLED", "Generation cancelled.");
                        return 0;
                    }
                    if (!emit_delta(env, callbacks, request_id, utf8_buffer.substr(0, valid))) {
                        cancelled.store(true);
                        llama_batch_free(batch);
                        finish("NATIVE_CALLBACK_FAILED", "The application stopped receiving native output.");
                        return 0;
                    }
                    utf8_buffer.erase(0, valid);
                }
            }
            if (!utf8_buffer.empty() &&
                juniper_local::valid_utf8_prefix(utf8_buffer) == utf8_buffer.size()) {
                if (cancelled.load()) {
                    llama_batch_free(batch);
                    finish("REQUEST_CANCELLED", "Generation cancelled.");
                    return 0;
                }
                emit_delta(env, callbacks, request_id, utf8_buffer);
            }
            llama_batch_free(batch);
            finish(nullptr, nullptr);
        } catch (const std::exception &) {
            finish("PROMPT_FORMAT_FAILED", "The model chat messages could not be formatted.");
        }
        return 0;
    }
};

std::once_flag backend_once;
std::atomic_bool backend_ready = false;

bool load_android_cpu_backend(const std::string & native_library_dir) {
    if (native_library_dir.empty()) {
        return false;
    }

#if defined(__aarch64__)
    // Try the most capable packaged variant first. Each backend exposes a
    // runtime score and ggml_backend_load rejects variants unsupported by the
    // current CPU, leaving the baseline as a safe fallback.
    constexpr const char * cpu_backend_names[] = {
        "libggml-cpu-android_armv9.2_2.so",
        "libggml-cpu-android_armv9.2_1.so",
        "libggml-cpu-android_armv9.0_1.so",
        "libggml-cpu-android_armv8.6_1.so",
        "libggml-cpu-android_armv8.2_2.so",
        "libggml-cpu-android_armv8.2_1.so",
        "libggml-cpu-android_armv8.0_1.so",
    };
#elif defined(__x86_64__)
    constexpr const char * cpu_backend_names[] = { "libggml-cpu-x64.so" };
#else
    constexpr const char * cpu_backend_names[] = {};
#endif

    if (sizeof(cpu_backend_names) == 0) {
        __android_log_write(ANDROID_LOG_ERROR, "JuniperNative", "no packaged Android CPU backend name for this ABI");
        return false;
    }

    // Android may keep native libraries inside the APK instead of exposing
    // them as regular files under nativeLibraryDir. Kotlin preloads the
    // candidates by soname; loading the same soname here lets ggml resolve
    // the exported registration entry point without a filesystem path.
    for (const char * cpu_backend_name : cpu_backend_names) {
        ggml_backend_reg_t registration = ggml_backend_load(cpu_backend_name);
        if (registration == nullptr && !native_library_dir.empty()) {
            const std::string backend_file = native_library_dir + "/" + cpu_backend_name;
            registration = ggml_backend_load(backend_file.c_str());
        }
        if (registration != nullptr) {
            __android_log_print(
                ANDROID_LOG_INFO,
                "JuniperNative",
                "native CPU backend selected: file=%s registrations=%zu",
                cpu_backend_name,
                ggml_backend_reg_count());
            return true;
        }
    }
    __android_log_print(
        ANDROID_LOG_ERROR,
        "JuniperNative",
        "native CPU backend load failed: registrations=%zu",
        ggml_backend_reg_count());
    return false;
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeCreate(JNIEnv * env, jclass, jstring native_library_dir) {
    std::string backend_path;
    if (!Engine::java_to_utf8(env, native_library_dir, backend_path)) return 0;

    std::call_once(backend_once, [&backend_path] {
        llama_log_set(android_llama_log, nullptr);
        // With GGML_BACKEND_DL enabled, load the CPU variant shared objects
        // from Android's private native-library directory before init.
        // The directory is supplied by the app, never by model/user input.
        if (!backend_path.empty()) ggml_backend_load_all_from_path(backend_path.c_str());
        load_android_cpu_backend(backend_path);
        llama_backend_init();
        backend_ready.store(ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU) != nullptr);
        __android_log_print(
            backend_ready.load() ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR,
            "JuniperNative",
            "native CPU backend readiness: %s",
            backend_ready.load() ? "ready" : "missing");
    });
    if (!backend_ready.load()) return 0;
    return reinterpret_cast<jlong>(new Engine());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeLoad(
    JNIEnv * env, jclass, jlong handle, jstring path, jint context_size, jint threads) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine == nullptr) return 9;
    std::string path_value;
    if (!Engine::java_to_utf8(env, path, path_value)) return 1;
    const int result = engine->load(path_value, static_cast<uint32_t>(context_size), threads);
    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeStartGenerate(
    JNIEnv * env, jclass, jlong handle, jstring request_id, jstring messages_json, jint max_output, jfloat temperature, jobject callbacks) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine == nullptr) return 9;
    std::string request_value;
    std::string messages_value;
    if (!Engine::java_to_utf8(env, request_id, request_value) ||
        !Engine::java_to_utf8(env, messages_json, messages_value)) return 9;
    const int result = engine->generate(
        env, callbacks, request_value, messages_value, max_output, temperature);
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeCancel(JNIEnv * env, jclass, jlong handle, jstring request_id) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine != nullptr) {
        std::string request_value;
        if (!Engine::java_to_utf8(env, request_id, request_value)) request_value.clear();
        engine->request_cancel(request_value);
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeUnload(JNIEnv *, jclass, jlong handle) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine != nullptr) {
        engine->request_cancel("");
        std::lock_guard lock(engine->mutex);
        engine->unload_locked();
    }
}
