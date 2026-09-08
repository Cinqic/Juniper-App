use serde::Serialize;

pub const LLAMA_CPP_REVISION: &str = "e107984bcffcfd701e82738092a2b000b6fda7a2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub id: String,
    pub name: String,
    pub maturity: String,
    pub state: String,
    pub version: String,
    pub source_revision: String,
    pub platforms: Vec<String>,
    pub architectures: Vec<String>,
    pub artifact_formats: Vec<String>,
    pub capabilities: Vec<String>,
    pub accelerator: String,
    pub installed: bool,
    pub reason: String,
    pub qualification: String,
}

struct Definition {
    id: &'static str,
    name: &'static str,
    version: &'static str,
    source_revision: &'static str,
    formats: &'static [&'static str],
    capabilities: &'static [&'static str],
    accelerator: &'static str,
    maturity: &'static str,
    reason: &'static str,
}

const DEFINITIONS: &[Definition] = &[
    Definition {
        id: "llama.cpp",
        name: "llama.cpp",
        version: LLAMA_CPP_REVISION,
        source_revision: LLAMA_CPP_REVISION,
        formats: &["GGUF"],
        capabilities: &["chat", "streaming", "cancellation", "cpu"],
        accelerator: "cpu",
        maturity: "stable",
        reason: "Juniper-owned loopback llama-server is the stable desktop path.",
    },
    Definition {
        id: "litert-lm",
        name: "LiteRT-LM",
        version: "0.16.1",
        source_revision: "v0.16.1",
        formats: &[".litertlm"],
        capabilities: &[],
        accelerator: "unknown",
        maturity: "unavailable",
        reason: "Upstream target metadata only; Juniper has no LiteRT-LM adapter or artifact.",
    },
    Definition {
        id: "executorch",
        name: "ExecuTorch",
        version: "1.4.1",
        source_revision: "v1.4.1",
        formats: &["PTE", "tokenizer/config bundle"],
        capabilities: &[],
        accelerator: "unknown",
        maturity: "unavailable",
        reason: "Upstream target metadata only; Juniper has no ExecuTorch adapter or artifact.",
    },
    Definition {
        id: "mlc-llm",
        name: "MLC LLM",
        version: "source-main",
        source_revision: "9fa644f54b04983adea4d0168f49fc6af4a893ba",
        formats: &["compiled MLC bundle"],
        capabilities: &[],
        accelerator: "unknown",
        maturity: "unavailable",
        reason: "Upstream target metadata only; Juniper has no MLC LLM adapter or compiled bundle.",
    },
    Definition {
        id: "onnxruntime-genai",
        name: "ONNX Runtime GenAI",
        version: "0.15.2",
        source_revision: "v0.15.2",
        formats: &["ONNX GenAI model bundle"],
        capabilities: &[],
        accelerator: "unknown",
        maturity: "unavailable",
        reason: "Upstream target metadata only; Juniper has no ONNX Runtime GenAI adapter or artifact.",
    },
];

fn platform_maturity(id: &str, platform: &str) -> &'static str {
    if id == "llama.cpp" && platform == "android" {
        "beta"
    } else {
        DEFINITIONS
            .iter()
            .find(|definition| definition.id == id)
            .map_or("unavailable", |definition| definition.maturity)
    }
}

fn architectures() -> Vec<String> {
    vec!["arm64-v8a", "aarch64", "arm64", "x86_64"]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

pub fn for_device(
    platform: &str,
    architecture: &str,
    packaged_llama: bool,
    native_llama: bool,
) -> Vec<RuntimeDescriptor> {
    let platform = if platform.contains("android") {
        "android"
    } else {
        platform
    };
    DEFINITIONS
        .iter()
        .map(|definition| {
            let known_architecture = architecture == "unknown"
                || ["arm64-v8a", "aarch64", "arm64", "x86_64"].contains(&architecture);
            let installed = if definition.id == "llama.cpp" {
                packaged_llama || native_llama
            } else {
                false
            };
            let available = installed && known_architecture;
            let maturity = platform_maturity(definition.id, platform).to_owned();
            let reason = if available && definition.id == "llama.cpp" && platform == "android" {
                "Beta until physical ARM64 execution is qualified.".to_owned()
            } else if available {
                definition.reason.to_owned()
            } else if !known_architecture {
                format!("The {architecture} architecture is not qualified for this runtime.")
            } else {
                definition.reason.to_owned()
            };
            let qualification = if available && maturity == "stable" {
                "qualified"
            } else if available {
                "package-only"
            } else {
                "not-qualified"
            };
            RuntimeDescriptor {
                id: definition.id.to_owned(),
                name: definition.name.to_owned(),
                maturity,
                state: if available {
                    "available"
                } else if !known_architecture {
                    "not-qualified"
                } else {
                    "unavailable"
                }
                .to_owned(),
                version: definition.version.to_owned(),
                source_revision: definition.source_revision.to_owned(),
                platforms: if definition.id == "llama.cpp" {
                    vec!["android", "linux", "windows"]
                        .into_iter()
                        .map(str::to_owned)
                        .collect()
                } else {
                    Vec::new()
                },
                architectures: if definition.id == "llama.cpp" {
                    architectures()
                } else {
                    Vec::new()
                },
                artifact_formats: definition
                    .formats
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                capabilities: definition
                    .capabilities
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                accelerator: definition.accelerator.to_owned(),
                installed,
                reason,
                qualification: qualification.to_owned(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_llama_is_beta_and_desktop_llama_is_stable() {
        let android = for_device("android", "arm64-v8a", false, true);
        let desktop = for_device("linux", "x86_64", true, false);
        assert_eq!(android[0].maturity, "beta");
        assert_eq!(desktop[0].maturity, "stable");
        assert_eq!(android[0].qualification, "package-only");
    }

    #[test]
    fn unavailable_optional_backends_are_not_reported_as_ready() {
        let runtimes = for_device("linux", "x86_64", false, false);
        assert!(runtimes.iter().all(|runtime| runtime.state != "available"));
        assert!(
            runtimes
                .iter()
                .any(|runtime| runtime.id == "onnxruntime-genai"
                    && runtime.maturity == "unavailable"
                    && runtime.platforms.is_empty()
                    && runtime.architectures.is_empty())
        );
    }
}
