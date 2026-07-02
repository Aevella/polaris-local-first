# Polaris Documentation

This directory maps Polaris architecture, data boundaries, implementation plans,
and verification commands.

## Start Here

- [Polaris handbook](handbook/README.md): current-source guide for architecture,
  development, data/storage, module boundaries, and publication gates.
- [Deployment guide](../DEPLOYMENT.md): local development, static web hosting,
  backend origin setup, Worker example, and native wrapper builds.
- [Documentation pack](open-source/README.md): design intent, architecture, module, backend, and publication-boundary docs.
- [Data and storage handbook](handbook/DATA_AND_STORAGE.md): current fact-source, row ownership, backend, import, and verification contracts.
- [Publication gate](handbook/PUBLICATION_GATE.md): source, security, architecture, and channel gates.
- [Connect your own backend](connect-your-own-backend.md): selfhost/API origin setup, expected `/api` routes, CORS, relay security, and known missing handlers.

## Data Layer

- [Data source decisions](open-source/data-source-decisions.md)
- [Data integrity rules](data-integrity-rules.md)

## App Architecture

- [Architecture handbook](handbook/ARCHITECTURE.md)
- [Layout contract](layout-contract.md)
- [Memory and group chat intent](open-source/memory-and-group-chat-intent.md)

## Documentation Layers

When a document is meant for public readers, add it under `docs/open-source/` first. When a
document is meant to guide implementation work, add it under `docs/handbook/`.
Write docs as current-state explanation, not as implementation history.
