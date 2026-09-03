# ADR-0011: Model-agnostic runtime

Status: accepted for the 0.3 release candidate

Juniper treats assistants, providers, and model profiles as separate entities.
The Juniper local catalog supplies verified metadata for its curated models;
external providers still discover and inspect metadata at runtime. An unknown
compatible external model is usable through the provider adapter without a
model-family branch. Model names are metadata, never product identity.

Named model families and future families are qualification inputs only. The
default Juniper assistant has an optional model binding.
