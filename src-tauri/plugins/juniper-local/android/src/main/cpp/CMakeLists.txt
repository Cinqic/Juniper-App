cmake_minimum_required(VERSION 3.31.6)

project("juniper-llama-jni" LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_SYSTEM_ARCH "ARM" CACHE STRING "" FORCE)
    set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)
elseif(ANDROID_ABI STREQUAL "x86_64")
    set(GGML_SYSTEM_ARCH "x86" CACHE STRING "" FORCE)
    set(GGML_CPU_KLEIDIAI OFF CACHE BOOL "" FORCE)
else()
    message(FATAL_ERROR "Juniper local runtime supports only arm64-v8a and x86_64; got ${ANDROID_ABI}")
endif()

# The 16 KiB linker settings are applied to every shared object produced by
# this project, including ggml backend variants loaded by the JNI library.
set(CMAKE_SHARED_LINKER_FLAGS
    "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384")

set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_WEBUI OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(FETCHCONTENT_QUIET OFF)

include(FetchContent)
set(JUNIPER_REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../../../../..")
set(JUNIPER_LLAMA_MANIFEST "${JUNIPER_REPO_ROOT}/config/llama-cpp.json")
if(NOT EXISTS "${JUNIPER_LLAMA_MANIFEST}")
    message(FATAL_ERROR "Juniper llama.cpp manifest is missing: ${JUNIPER_LLAMA_MANIFEST}")
endif()
file(READ "${JUNIPER_LLAMA_MANIFEST}" JUNIPER_LLAMA_MANIFEST_JSON)
string(REGEX MATCH "\"commit\"[ \t\r\n]*:[ \t\r\n]*\"([a-f0-9]+)\"" _manifest_commit_match
    "${JUNIPER_LLAMA_MANIFEST_JSON}")
if(NOT CMAKE_MATCH_1)
    message(FATAL_ERROR "Juniper llama.cpp manifest has no hexadecimal commit")
endif()
set(JUNIPER_LLAMA_CPP_COMMIT "${CMAKE_MATCH_1}")
set(JUNIPER_LLAMA_SOURCE_DIR "$ENV{JUNIPER_LLAMA_SOURCE_DIR}" CACHE PATH
    "Optional verified local llama.cpp checkout; FetchContent is used when unset")

if(JUNIPER_LLAMA_SOURCE_DIR AND EXISTS "${JUNIPER_LLAMA_SOURCE_DIR}/CMakeLists.txt")
    set(llama_cpp_SOURCE_DIR "${JUNIPER_LLAMA_SOURCE_DIR}")
    add_subdirectory("${llama_cpp_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/llama_cpp-build")
else()
    FetchContent_Declare(
        llama_cpp
        GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
        GIT_TAG ${JUNIPER_LLAMA_CPP_COMMIT}
        GIT_SHALLOW FALSE
    )
    FetchContent_MakeAvailable(llama_cpp)

    FetchContent_GetProperties(llama_cpp)
    if(NOT llama_cpp_POPULATED)
        message(FATAL_ERROR "llama.cpp source was not populated")
    endif()
endif()

execute_process(
    COMMAND git -C "${llama_cpp_SOURCE_DIR}" rev-parse HEAD
    OUTPUT_VARIABLE LLAMA_CPP_ACTUAL_COMMIT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE LLAMA_CPP_GIT_RESULT)
if(NOT LLAMA_CPP_GIT_RESULT EQUAL 0 OR NOT LLAMA_CPP_ACTUAL_COMMIT STREQUAL "${JUNIPER_LLAMA_CPP_COMMIT}")
    message(FATAL_ERROR "llama.cpp revision verification failed: ${LLAMA_CPP_ACTUAL_COMMIT}")
endif()

# The Android module supplies -fvisibility=hidden globally. Export the common
# helper API consumed by this JNI bridge from libllama-common.so.
if(TARGET llama-common)
    target_compile_options(llama-common PRIVATE -fvisibility=default)
endif()

add_library(juniper_llama_jni SHARED juniper_llama_jni.cpp)
target_compile_definitions(juniper_llama_jni PRIVATE GGML_SYSTEM_ARCH=${GGML_SYSTEM_ARCH})
target_compile_options(juniper_llama_jni PRIVATE -fvisibility=hidden -ffunction-sections -fdata-sections)
target_include_directories(juniper_llama_jni PRIVATE
    "${llama_cpp_SOURCE_DIR}"
    "${llama_cpp_SOURCE_DIR}/common"
    "${llama_cpp_SOURCE_DIR}/include"
    "${llama_cpp_SOURCE_DIR}/ggml/include"
    "${llama_cpp_SOURCE_DIR}/ggml/src")
target_link_options(juniper_llama_jni PRIVATE -Wl,--gc-sections)
target_link_libraries(juniper_llama_jni PRIVATE llama llama-common android log)
