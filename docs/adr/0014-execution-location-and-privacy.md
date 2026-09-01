# ADR-0014: Execution location and privacy labels

Status: accepted for the 0.2 release candidate

Provider transport and model execution are distinct. Juniper reports ON DEVICE,
LOCAL NETWORK, REMOTE, or UNKNOWN. Unknown is never rendered as local. A
provider failure never silently substitutes a remote provider, and telemetry is
permanently off.
