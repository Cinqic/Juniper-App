#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <string>
#include <utility>

namespace juniper_local {

constexpr std::size_t kMaximumMessagesJsonBytes = 512 * 1024;

inline bool is_valid_generation_parameters(int max_output, float temperature, int threads) {
    return max_output >= 1 && max_output <= 512 && std::isfinite(temperature) &&
           temperature >= 0.0f && temperature <= 2.0f && threads >= 2 && threads <= 4;
}

inline std::size_t valid_utf8_prefix(const std::string & value) {
    std::size_t index = 0;
    while (index < value.size()) {
        const unsigned char first = static_cast<unsigned char>(value[index]);
        std::size_t width = 0;
        if ((first & 0x80) == 0) width = 1;
        else if ((first & 0xe0) == 0xc0) width = 2;
        else if ((first & 0xf0) == 0xe0) width = 3;
        else if ((first & 0xf8) == 0xf0) width = 4;
        else return index;
        if (index + width > value.size()) return index;
        for (std::size_t offset = 1; offset < width; ++offset) {
            if ((static_cast<unsigned char>(value[index + offset]) & 0xc0) != 0x80) return index;
        }
        index += width;
    }
    return index;
}

class CancellationToken {
public:
    void reset() { value_.store(false); }
    void request() { value_.store(true); }
    void store(bool value) { value_.store(value); }
    bool load() const { return value_.load(); }

private:
    std::atomic_bool value_ = false;
};

template <typename T, typename Deleter>
class OwnedResource {
public:
    OwnedResource() = default;
    explicit OwnedResource(T * value) : value_(value) {}
    OwnedResource(const OwnedResource &) = delete;
    OwnedResource & operator=(const OwnedResource &) = delete;
    OwnedResource(OwnedResource && other) noexcept : value_(other.release()) {}
    OwnedResource & operator=(OwnedResource && other) noexcept {
        if (this != &other) reset(other.release());
        return *this;
    }
    ~OwnedResource() { reset(); }

    T * get() const { return value_; }
    explicit operator bool() const { return value_ != nullptr; }
    T * release() {
        T * value = value_;
        value_ = nullptr;
        return value;
    }
    void reset(T * value = nullptr) {
        if (value_ != nullptr) Deleter{}(value_);
        value_ = value;
    }

private:
    T * value_ = nullptr;
};

} // namespace juniper_local
