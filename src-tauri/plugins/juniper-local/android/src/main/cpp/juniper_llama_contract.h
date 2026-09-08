#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

namespace juniper_local {

constexpr std::size_t kMaximumMessagesJsonBytes = 512 * 1024;

inline bool is_valid_generation_parameters(int max_output, float temperature, int threads) {
    return max_output >= 1 && max_output <= 512 && std::isfinite(temperature) &&
           temperature >= 0.0f && temperature <= 2.0f && threads >= 2 && threads <= 4;
}

inline bool decode_utf8_code_point(
    std::string_view value,
    std::size_t offset,
    std::uint32_t & code_point,
    std::size_t & width) {
    if (offset >= value.size()) return false;
    const auto byte = [&](std::size_t index) {
        return static_cast<unsigned char>(value[index]);
    };
    const unsigned char first = byte(offset);
    if (first <= 0x7f) {
        code_point = first;
        width = 1;
        return true;
    }
    if ((first & 0xe0) == 0xc0) {
        width = 2;
        code_point = first & 0x1f;
    } else if ((first & 0xf0) == 0xe0) {
        width = 3;
        code_point = first & 0x0f;
    } else if ((first & 0xf8) == 0xf0) {
        width = 4;
        code_point = first & 0x07;
    } else {
        return false;
    }
    if (offset + width > value.size()) return false;
    for (std::size_t index = 1; index < width; ++index) {
        const unsigned char continuation = byte(offset + index);
        if ((continuation & 0xc0) != 0x80) return false;
        code_point = (code_point << 6) | (continuation & 0x3f);
    }
    const std::uint32_t minimum = width == 2 ? 0x80 : width == 3 ? 0x800 : 0x10000;
    return code_point >= minimum && code_point <= 0x10ffff &&
           (code_point < 0xd800 || code_point > 0xdfff);
}

inline std::size_t valid_utf8_prefix(const std::string & value) {
    std::size_t index = 0;
    while (index < value.size()) {
        std::uint32_t code_point = 0;
        std::size_t width = 0;
        if (!decode_utf8_code_point(value, index, code_point, width)) return index;
        index += width;
    }
    return index;
}

inline void append_utf8_code_point(std::string & output, std::uint32_t code_point) {
    if (code_point <= 0x7f) {
        output.push_back(static_cast<char>(code_point));
    } else if (code_point <= 0x7ff) {
        output.push_back(static_cast<char>(0xc0 | (code_point >> 6)));
        output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
    } else if (code_point <= 0xffff) {
        output.push_back(static_cast<char>(0xe0 | (code_point >> 12)));
        output.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
        output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
    } else {
        output.push_back(static_cast<char>(0xf0 | (code_point >> 18)));
        output.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3f)));
        output.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3f)));
        output.push_back(static_cast<char>(0x80 | (code_point & 0x3f)));
    }
}

inline std::string utf16_to_utf8(const std::u16string & value) {
    std::string output;
    output.reserve(value.size());
    for (std::size_t index = 0; index < value.size(); ++index) {
        std::uint32_t code_point = value[index];
        if (code_point >= 0xd800 && code_point <= 0xdbff && index + 1 < value.size() &&
            value[index + 1] >= 0xdc00 && value[index + 1] <= 0xdfff) {
            code_point = 0x10000 + ((code_point - 0xd800) << 10) + (value[++index] - 0xdc00);
        } else if (code_point >= 0xd800 && code_point <= 0xdfff) {
            code_point = 0xfffd;
        }
        append_utf8_code_point(output, code_point);
    }
    return output;
}

inline std::u16string utf8_to_utf16(const std::string & value) {
    std::u16string output;
    output.reserve(value.size());
    std::size_t index = 0;
    while (index < value.size()) {
        std::uint32_t code_point = 0;
        std::size_t width = 0;
        if (!decode_utf8_code_point(value, index, code_point, width)) {
            code_point = 0xfffd;
            width = 1;
        }
        if (code_point <= 0xffff) {
            output.push_back(static_cast<char16_t>(code_point));
        } else {
            code_point -= 0x10000;
            output.push_back(static_cast<char16_t>(0xd800 | (code_point >> 10)));
            output.push_back(static_cast<char16_t>(0xdc00 | (code_point & 0x3ff)));
        }
        index += width;
    }
    return output;
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
