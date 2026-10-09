# Architecture

```text
MCP client (Codex, Claude Desktop, Cursor, other stdio clients)
    |
    | MCP over standard input/output
    v
Official MCP SDK server
    |-- focused workflows, resources and prompts
    |-- JSON Schema validation and read-only policy
    |-- generated OBS request catalog
    |-- bounded event history and background cue jobs
    v
Authenticated obs-websocket-js JSON connection
    |
    | OBS WebSocket 5
    v
OBS Studio
```

## Connection behavior

Startup does not require OBS to be running. The first OBS request negotiates authentication and retrieves `GetVersion.availableRequests`. Concurrent requests share one connection attempt. The next request reconnects after a disconnection. A mutation is never automatically replayed after failure. A request timeout closes the connection and reports that the action's outcome may be uncertain; agents must inspect before repeating it.

Schemas validate field types, required fields, extra properties and mechanically available numeric bounds. OBS remains the authority for mutually exclusive fields, source-specific settings, enum values and current operation state. All entries in a batch are validated before execution. Batches execute sequentially, report partial results and are not transactions.

## Workflow behavior

Scene templates reuse existing sources without changing their input settings. The tutorial, gaming and presentation presets use the same fullscreen-and-corner geometry; interview uses two halves. Names are unique and existing scenes are not overwritten. Normal failures attempt cleanup of only newly created scene/input objects. Timed-out operations do not trigger blind cleanup because creation or activation may have succeeded.

Layouts reset crop, rotation and mirroring and return the previous transform. `contain` preserves the entire source. `cover` uses `OBS_BOUNDS_SCALE_OUTER`; it may extend beyond the box, so do not promise clipping or a perfect half-screen fill.

Preflight inspects configuration and cumulative counters. It does not measure actual microphone signal, available disk space, image content or destination-platform readiness. Inspect screenshots and test audio separately.

## Events and cues

The connection subscribes to the regular OBS event categories. It does not subscribe to high-frequency volume meters. The event buffer is bounded and process-local. Event IDs reset on restart; `nextAfterId` supports polling. This is useful for state changes, not a durable audit log.

Cue jobs run sequentially in order of their delays from submission. They stop on the first failure and can be cancelled. Running requests cannot be recalled. Timers and results exist only while the MCP server is alive. A maximum of 200 retained jobs and 100 cues per job bounds memory. Disconnecting the MCP client shuts down the scheduler.

## Protocol provenance

Request names, categories, field types, optionality, bounds and version facts were generated from the [official obs-websocket protocol](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/docs/generated/protocol.json), commit `e28f84975984340e84fc4879cfc05741cc0afde1`. Tool prose is authored in this project. The bundled catalog includes operations up to obs-websocket 5.7.0; older OBS builds reject unavailable operations with a clear error.

## Limits

This release uses local stdio transport. It is not an HTTP server and does not include OAuth, transcription, automatic speaker detection, video editing or streaming-platform account setup. Those can be separate future integrations. Cross-platform automated tests cover the protocol and workflows with simulations; the initial live verification runs on Windows OBS 32.1.2.
