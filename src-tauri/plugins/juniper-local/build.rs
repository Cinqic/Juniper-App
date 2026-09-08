fn main() {
    const COMMANDS: &[&str] = &[
        "loadModel",
        "pollStatus",
        "startGenerate",
        "pollEvent",
        "cancel",
        "unload",
        "memoryPressure",
    ];

    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build juniper-local-runtime plugin");
}
