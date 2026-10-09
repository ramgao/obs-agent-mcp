# OBS Agent MCP

[![CI](https://github.com/ramgao/obs-agent-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ramgao/obs-agent-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-43853d.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Protocol-MCP-111111.svg)](https://modelcontextprotocol.io/)

**An AI production assistant for OBS Studio.** Build recording scenes, adjust sources, control audio, capture previews, operate recordings and streams, and automate timed cues from an MCP-compatible agent.

> “Create a tutorial scene with my screen and webcam, add a title, check the setup, and show me a preview.”

88 tools in the default curated mode. 168 tools in full mode. Access to all 147 bundled, documented OBS requests in either mode through validated discovery and dispatch. Four live resources and two guided prompts.

## What it does

- **Scenes and layouts:** create, rename and remove scenes; arrange, crop, scale, hide, lock, reorder and duplicate items; apply fullscreen, corner and interview layouts.
- **Capture sources:** create screen, window, camera, image, text, browser and media inputs using the source types and device settings available in your OBS installation.
- **Audio:** mute, volume, synchronization, monitoring, tracks, balance and filters through the OBS API.
- **Production:** recording with confirmed state changes, streaming, replay buffer, virtual camera, transitions and Studio Mode.
- **Visual verification:** return scene or source screenshots as native MCP images that vision-capable agents can inspect.
- **Agent workflows:** scene templates with a dry-run plan, recording preflight, sequential batches, request discovery, event history and cancellable timed cues.
- **Reliable connections:** lazy authentication, reconnect on the next request, capability checks, request timeouts and actionable errors. Failed mutations are never silently replayed.

This is an independent community project, not an official OBS product. It uses the [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [OBS WebSocket 5](https://github.com/obsproject/obs-websocket). The server needs no paid AI API key; your MCP client supplies the agent.

## Quick start

### 1. Enable OBS control

Requires **Node.js 22+** and **OBS Studio 28+** with WebSocket 5. Use a current OBS release for the widest feature coverage.

In OBS, open **Tools → WebSocket Server Settings**:

1. Enable the WebSocket server.
2. Keep authentication enabled and copy your server password.
3. Use port **4455**, or set `OBS_URL` to your chosen address.

Finish any first-run wizard or blocking OBS dialog before using recording controls. Configure output encoding, stream destination and replay-buffer duration in OBS as needed.

### 2. Add the server to your MCP client

Paste this into **Claude Desktop**'s MCP configuration or **Cursor**'s `mcp.json`, then replace the password placeholder:

```json
{
  "mcpServers": {
    "obs": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/ramgao/obs-agent-mcp/releases/download/v1.0.1/ramgao-obs-agent-mcp-1.0.1.tgz"
      ],
      "env": {
        "OBS_URL": "ws://127.0.0.1:4455",
        "OBS_PASSWORD": "REPLACE_WITH_YOUR_OBS_WEBSOCKET_PASSWORD",
        "OBS_TOOL_MODE": "curated"
      }
    }
  }
}
```

Restart or reconnect your client, then ask: **“Check OBS and show me the current scene.”** The first launch downloads the release package; subsequent launches use npm's cache. The package is distributed through GitHub Releases, not the npm registry.

<details>
<summary>Codex configuration</summary>

Add this to `~/.codex/config.toml`, replacing the password:

```toml
[mcp_servers.obs]
command = "npx"
args = ["-y", "https://github.com/ramgao/obs-agent-mcp/releases/download/v1.0.1/ramgao-obs-agent-mcp-1.0.1.tgz"]
startup_timeout_sec = 60
tool_timeout_sec = 60

[mcp_servers.obs.env]
OBS_URL = "ws://127.0.0.1:4455"
OBS_PASSWORD = "REPLACE_WITH_YOUR_OBS_WEBSOCKET_PASSWORD"
OBS_TOOL_MODE = "curated"
```

Alternatively, register it with the CLI:

```sh
codex mcp add obs --env OBS_PASSWORD=YOUR_OBS_PASSWORD -- npx -y https://github.com/ramgao/obs-agent-mcp/releases/download/v1.0.1/ramgao-obs-agent-mcp-1.0.1.tgz
```

See the [official Codex MCP configuration guide](https://developers.openai.com/codex/mcp).

</details>

<details>
<summary>Install once, or build from source</summary>

Install the release globally:

```sh
npm install -g https://github.com/ramgao/obs-agent-mcp/releases/download/v1.0.1/ramgao-obs-agent-mcp-1.0.1.tgz
```

Then use `"command": "obs-agent-mcp"` with `"args": []` in your MCP client. On Windows, if your client cannot resolve npm's executable wrappers, use `node` with the absolute path to the installed `dist/cli.js` instead. This also avoids a package download during client startup.

Build from source:

```sh
git clone https://github.com/ramgao/obs-agent-mcp.git
cd obs-agent-mcp
npm ci
npm run build
```

Configure the client with `"command": "node"` and `"args": ["/absolute/path/to/obs-agent-mcp/dist/cli.js"]`, retaining the same environment block.

</details>

### 3. Check the connection

With `OBS_PASSWORD` set in your terminal environment:

```sh
npx -y https://github.com/ramgao/obs-agent-mcp/releases/download/v1.0.1/ramgao-obs-agent-mcp-1.0.1.tgz doctor
```

`doctor` reports connection, version, output state and capabilities. `config` prints the client configuration template. `--help` lists all settings. Default startup serves MCP over standard input/output; log messages go to stderr.

## Agent workflow examples

### Prepare a tutorial

1. `obs_status` and `obs_get_input_list` discover the current setup.
2. If needed, discover source kinds and device property choices, then create inputs with `obs_add_source`.
3. `obs_build_scene` with `dryRun: true` previews the plan.
4. Build the scene, then call `obs_screenshot` to inspect the composition.
5. Run `obs_preflight`, check actual microphone signal in OBS, and start recording when requested.

```json
{
  "sceneName": "Coding Tutorial",
  "template": "tutorial",
  "primarySource": "Screen Capture",
  "secondarySource": "Webcam",
  "microphoneSource": "Microphone",
  "title": "Build with me",
  "dryRun": true
}
```

Source names must already exist. Templates do not guess which display, camera or microphone you intended, and do not activate the scene unless `activate: true` is supplied.

### Schedule a scene change

Call `obs_schedule_cues` with:

```json
{
  "name": "Five-minute break",
  "cues": [
    { "delayMs": 0, "requestType": "SetCurrentProgramScene", "requestData": { "sceneName": "Break" } },
    { "delayMs": 300000, "requestType": "SetCurrentProgramScene", "requestData": { "sceneName": "Main" } }
  ]
}
```

Read progress with `obs_list_cues`; cancel by ID with `obs_cancel_cues`. Cue jobs live only while the MCP server process stays connected and running.

### Use an advanced operation

`obs_list_requests` with `query: "balance"` returns the schema for `SetInputAudioBalance`. Then call:

```json
{
  "requestType": "SetInputAudioBalance",
  "requestData": { "inputName": "Microphone", "inputAudioBalance": 0.5 }
}
```

Use `supportedOnly: true` during discovery to filter for your OBS version. Requests advertised by third-party extensions but absent from the bundled catalog are not accepted as arbitrary raw operations; documented `CallVendorRequest` provides the OBS plugin extension path.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBS_URL` | `ws://127.0.0.1:4455` | OBS WebSocket endpoint; `wss://` is supported. |
| `OBS_PASSWORD` | unset | OBS WebSocket password. |
| `OBS_TOOL_MODE` | `curated` | `curated` exposes 88 focused tools; `full` exposes 168. |
| `OBS_READ_ONLY` | `false` | Enforce inspection-only operation, including dispatcher and batch calls. |
| `OBS_TIMEOUT_MS` | `10000` | Per-connection/request and recording-state wait timeout, 1000–60000 ms. |
| `OBS_EVENT_BUFFER_SIZE` | `200` | Retained events, 1–2000. |

Environment variables must be supplied by the client or shell. `.env.example` documents them; `.env` files are **not automatically loaded**.

## Resources and prompts

| Resource | Content |
| --- | --- |
| `obs://status` | Outputs, scenes, version and performance. |
| `obs://scenes` | Scene list and current selection. |
| `obs://requests` | Complete bundled request schemas. |
| `obs://events` | Bounded event history from this process. |

Prompts: **`prepare-recording`** accepts a `brief`; **`diagnose-obs`** accepts a `problem`. Clients differ in how they present prompts and resources.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `OBS_UNAVAILABLE` | Open OBS, enable WebSocket and check the port in `OBS_URL`. |
| Authentication failed | Copy the password from OBS WebSocket settings into `OBS_PASSWORD`. |
| `UNSUPPORTED_REQUEST` | Discover with `supportedOnly: true`, or update OBS. |
| `INVALID_ARGUMENTS` | Read the request schema; use exact source names and item IDs. |
| Recording state timeout | Finish blocking OBS dialogs and check recording settings. Inspect the state before repeating a command. |
| Replay buffer unavailable | Enable and configure Replay Buffer in OBS output settings. |
| Capture source is black | Inspect the capture device/window properties and OS capture permissions. The server cannot create a missing device. |
| First launch times out | Allow download time, raise the client's startup timeout, or install once and use a local executable. |

## Testing and scope

```sh
npm run verify
npm run docs:tools
npm audit --omit=dev
```

Automated tests cover real MCP negotiation, authenticated WebSocket connections, concurrent connection setup, reconnects, validation, timeouts without mutation replay, read-only policy, batch failures, scene cleanup, layouts, event retention and cue execution/cancellation. CI runs on Windows, macOS and Linux with Node.js 22 and 24.

Live acceptance testing uses **Windows OBS 32.1.2**, an isolated portable profile and synthetic sources. It exercises scenes, screenshots, layouts, cues, recording and transitions. Public streaming, physical capture hardware, macOS/Linux live OBS, automatic transcription and AI speaker detection are outside that acceptance check.

See the [tool reference](docs/tools.md), [live validation](docs/validation.md), [architecture and limits](docs/architecture.md), [contributing guide](CONTRIBUTING.md) and [security notes](SECURITY.md).

## License

[MIT](LICENSE). OBS Studio is a separate application with its own license. OBS names and marks belong to their respective owners.
