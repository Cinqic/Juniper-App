# Permission model

Tauri capabilities grant `core:default` plus the native dialog picker. No
blanket filesystem, shell, or remote-source permissions are enabled. Native
operations are narrow Rust commands:

- attachment registration validates file type, regular-file status, and a
  1 MiB size cap before assigning an opaque grant ID;
- attachment reads accept only a previously granted ID;
- credentials use an OS secure store on desktop and are never returned to the
  webview;
- provider requests are explicit and carry a visible local/remote profile;
- cancellation is owned by the user and is checked during streaming.

An assistant template, attachment, model output, MCP result, or provider
metadata cannot change this policy. A future shell/sidecar runtime must add a
dedicated capability and a separate review; it must not broaden `default.json`.
