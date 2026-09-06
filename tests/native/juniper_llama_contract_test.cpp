#include <cassert>
#include <limits>
#include <string>

#include "juniper_llama_contract.h"

namespace {

struct FakeNativeResource {
    int * release_count;
};

struct FakeNativeRelease {
    void operator()(FakeNativeResource * resource) const {
        ++*resource->release_count;
        delete resource;
    }
};

} // namespace

int main() {
    using juniper_local::CancellationToken;
    using juniper_local::OwnedResource;

    assert(juniper_local::is_valid_generation_parameters(1, 0.0f, 2));
    assert(juniper_local::is_valid_generation_parameters(512, 2.0f, 4));
    assert(!juniper_local::is_valid_generation_parameters(0, 0.3f, 2));
    assert(!juniper_local::is_valid_generation_parameters(513, 0.3f, 2));
    assert(!juniper_local::is_valid_generation_parameters(
        16, std::numeric_limits<float>::quiet_NaN(), 2));
    assert(!juniper_local::is_valid_generation_parameters(16, 0.3f, 1));

    const std::string valid = "hello \xF0\x9F\x8C\x8D";
    assert(juniper_local::valid_utf8_prefix(valid) == valid.size());
    assert(juniper_local::valid_utf8_prefix("hello \xF0\x9F") == 6);
    assert(juniper_local::valid_utf8_prefix("hello \xC2x") == 6);

    CancellationToken cancellation;
    assert(!cancellation.load());
    cancellation.request();
    assert(cancellation.load());
    cancellation.reset();
    assert(!cancellation.load());

    int release_count = 0;
    {
        OwnedResource<FakeNativeResource, FakeNativeRelease> first(
            new FakeNativeResource{&release_count});
        OwnedResource<FakeNativeResource, FakeNativeRelease> second(std::move(first));
        assert(!first);
        assert(second);
        second.reset();
        assert(release_count == 1);
        second.reset();
    }
    assert(release_count == 1);
    return 0;
}
