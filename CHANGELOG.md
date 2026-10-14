# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-14

First public release.

### Added

- `generate_image` tool with three actions: `generate` (text-to-image),
  `edit` (image-to-image / inpainting with optional mask), and `batch`
  (one call, many prompts, bounded concurrency).
- `imagegen_config` tool (`get` / `set` / `models`) so the agent can inspect and
  change configuration from the conversation.
- In-conversation rendering of results: every image is returned as an `image`
  content block backed by a durable attachment, so it displays inline and can be
  downloaded. Original bytes are written to the workspace untouched.
- Plugin-page configuration form (base URL, API key, model, defaults, save
  directory) with a connectivity test that reports each step.
- Full parameter surface: `model`, `quality`, `resolution`, `aspect_ratio`,
  `count`, `save_dir`, `optimize_prompt`, `concurrency`.
- DSH bundle packaging (host half + web client half), so the plugin appears in
  the Plugins page under **Installed** and can be toggled like any other bundle.
- Development toolchain in `tools/`: bundle self-checks, an HTTP end-to-end check
  of the configuration routes, an installer that works without pnpm, a
  shape-aware uninstaller, and a publish gate that scans for leaked secrets.
- CI workflow running the bundle self-checks on Windows and Linux.

### Notes

- Configuration lives in `config.json` next to the installed package. It holds
  the API key, is excluded from the published tarball, and is never echoed back
  to the browser (the form only sees `***set***`).
