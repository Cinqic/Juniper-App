# ADR-0011: Model-agnostic runtime

Status: accepted for the 0.2 release candidate

Juniper treats assistants, providers, and model profiles as separate entities.
Providers discover and inspect model metadata at runtime, and an unknown
compatible model is usable through the provider adapter without a model-family
branch. Model names are metadata, never product identity.

Qwen, Llama, Gemma, Mistral, DeepSeek, and future families are qualification
inputs only. The default Juniper assistant has an optional model binding.
