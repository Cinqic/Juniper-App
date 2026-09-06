#include <jni.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

#include "chat.h"
#include "common.h"
#include "ggml-backend.h"
#include "gguf.h"
#include "json.h"
#include "sampling.h"
#include "llama.h"

namespace {

constexpr uint32_t kDefaultContext = 2048;
constexpr uint32_t kBatchSize = 256;
constexpr uint64_t kMaximumModelBytes = 2ULL * 1024ULL * 1024ULL * 1024ULL;

struct Engine {
    llama_model * model = nullptr;
    llama_context * context = nullptr;
    common_chat_templates_ptr templates;
    common_sampler * sampler = nullptr;
    std::atomic_bool cancelled = false;
    std::mutex mutex;

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
        std::error_code fs_error;
        const auto status = std::filesystem::status(path, fs_error);
        if (fs_error || !std::filesystem::is_regular_file(status)) return 1;
        if (std::filesystem::file_size(path, fs_error) > kMaximumModelBytes) return 2;
        if (!validate_gguf_metadata(path)) return 3;

        llama_model_params model_params = llama_model_default_params();
        model = llama_model_load_from_file(path.c_str(), model_params);
        if (model == nullptr) return 3;
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
        return 0;
    }

    static size_t valid_utf8_prefix(const std::string & value) {
        size_t index = 0;
        while (index < value.size()) {
            const unsigned char first = static_cast<unsigned char>(value[index]);
            size_t width = 0;
            if ((first & 0x80) == 0) width = 1;
            else if ((first & 0xe0) == 0xc0) width = 2;
            else if ((first & 0xf0) == 0xe0) width = 3;
            else if ((first & 0xf8) == 0xf0) width = 4;
            else return index;
            if (index + width > value.size()) return index;
            for (size_t offset = 1; offset < width; ++offset) {
                if ((static_cast<unsigned char>(value[index + offset]) & 0xc0) != 0x80) return index;
            }
            index += width;
        }
        return index;
    }

    static jstring java_string(JNIEnv * env, const std::string & value) {
        return env->NewStringUTF(value.c_str());
    }

    static bool emit_delta(JNIEnv * env, jobject callbacks, const std::string & request_id, const std::string & text) {
        jclass cls = env->GetObjectClass(callbacks);
        jmethodID method = env->GetMethodID(cls, "onDelta", "(Ljava/lang/String;Ljava/lang/String;)V");
        if (method == nullptr) return false;
        jstring request = java_string(env, request_id);
        jstring delta = java_string(env, text);
        env->CallVoidMethod(callbacks, method, request, delta);
        env->DeleteLocalRef(request);
        env->DeleteLocalRef(delta);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return false;
        }
        return true;
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
        jmethodID method = env->GetMethodID(
            cls,
            "onTerminal",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IIJ)V");
        if (method == nullptr) return false;
        jstring request = java_string(env, request_id);
        jstring code_string = java_string(env, code == nullptr ? "" : code);
        jstring message_string = java_string(env, message == nullptr ? "" : message);
        env->CallVoidMethod(callbacks, method, request, code_string, message_string, input_tokens, output_tokens, duration_ms);
        env->DeleteLocalRef(request);
        env->DeleteLocalRef(code_string);
        env->DeleteLocalRef(message_string);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return false;
        }
        return true;
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
            emit_terminal(env, callbacks, request_id, code, message, input_tokens, output_tokens, duration);
        };

        try {
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

            llama_memory_clear(llama_get_memory(context), true);
            common_sampler_reset(sampler);
            llama_batch batch = llama_batch_init(kBatchSize, 0, 1);
            if (batch.token == nullptr) {
                finish("NATIVE_MEMORY_ERROR", "The native engine could not allocate a decode batch.");
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
                const int result = llama_decode(context, batch);
                if (result != 0) {
                    llama_batch_free(batch);
                    finish(cancelled.load() ? "REQUEST_CANCELLED" : "PREFILL_FAILED", cancelled.load() ? "Generation cancelled." : "The model could not evaluate the prompt.");
                    return 0;
                }
            }

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
                const int result = llama_decode(context, batch);
                if (result != 0) {
                    llama_batch_free(batch);
                    finish(cancelled.load() ? "REQUEST_CANCELLED" : "DECODE_FAILED", cancelled.load() ? "Generation cancelled." : "The model failed during decoding.");
                    return 0;
                }
                ++output_tokens;
                utf8_buffer += common_token_to_piece(context, token, false);
                const size_t valid = valid_utf8_prefix(utf8_buffer);
                if (valid > 0) {
                    if (!emit_delta(env, callbacks, request_id, utf8_buffer.substr(0, valid))) {
                        cancelled.store(true);
                        llama_batch_free(batch);
                        finish("NATIVE_CALLBACK_FAILED", "The application stopped receiving native output.");
                        return 0;
                    }
                    utf8_buffer.erase(0, valid);
                }
            }
            if (!utf8_buffer.empty() && valid_utf8_prefix(utf8_buffer) == utf8_buffer.size()) {
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

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeCreate(JNIEnv * env, jclass, jstring native_library_dir) {
    const char * path = native_library_dir == nullptr ? nullptr : env->GetStringUTFChars(native_library_dir, nullptr);
    std::string backend_path = path == nullptr ? "" : path;
    if (path != nullptr) env->ReleaseStringUTFChars(native_library_dir, path);

    std::call_once(backend_once, [&backend_path] {
        llama_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
        // With GGML_BACKEND_DL enabled, load the CPU variant shared objects
        // from Android's private native-library directory before init.
        // The directory is supplied by the app, never by model/user input.
        if (!backend_path.empty()) ggml_backend_load_all_from_path(backend_path.c_str());
        llama_backend_init();
    });
    return reinterpret_cast<jlong>(new Engine());
}

extern "C" JNIEXPORT jint JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeLoad(
    JNIEnv * env, jclass, jlong handle, jstring path, jint context_size, jint threads) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine == nullptr) return 9;
    const char * path_chars = env->GetStringUTFChars(path, nullptr);
    const int result = engine->load(path_chars == nullptr ? "" : path_chars, static_cast<uint32_t>(context_size), threads);
    if (path_chars != nullptr) env->ReleaseStringUTFChars(path, path_chars);
    return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeStartGenerate(
    JNIEnv * env, jclass, jlong handle, jstring request_id, jstring messages_json, jint max_output, jfloat temperature, jobject callbacks) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine == nullptr) return 9;
    const char * request_chars = env->GetStringUTFChars(request_id, nullptr);
    const char * messages_chars = env->GetStringUTFChars(messages_json, nullptr);
    const int result = engine->generate(
        env,
        callbacks,
        request_chars == nullptr ? "" : request_chars,
        messages_chars == nullptr ? "" : messages_chars,
        max_output,
        temperature);
    if (request_chars != nullptr) env->ReleaseStringUTFChars(request_id, request_chars);
    if (messages_chars != nullptr) env->ReleaseStringUTFChars(messages_json, messages_chars);
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeCancel(JNIEnv *, jclass, jlong handle, jstring) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine != nullptr) engine->cancelled.store(true);
}

extern "C" JNIEXPORT void JNICALL
Java_com_cinqic_juniper_local_1runtime_EngineOwner_nativeUnload(JNIEnv *, jclass, jlong handle) {
    auto * engine = reinterpret_cast<Engine *>(handle);
    if (engine != nullptr) {
        engine->cancelled.store(true);
        std::lock_guard lock(engine->mutex);
        engine->unload_locked();
    }
}
