# Validation

The initial release passed 23 automated tests locally on Node.js 24 and Windows. The repository's CI matrix runs the same checks on Node.js 22 and 24 across Windows, macOS and Linux.

Live acceptance passed against an isolated Windows OBS Studio 32.1.2 instance with obs-websocket 5.7.3. The [acceptance report](acceptance.json) records the checks. All content was synthetic: color sources, a text title and a looping silent WAV. No public stream, display capture, webcam capture or microphone recording was started.

The test negotiated MCP over stdio and exercised scene planning/creation, item transforms, visibility, native screenshot responses, audio controls, preflight, timed cues, recording start/pause/resume/stop, saved-file existence, event history and Studio Mode transitions. The [preview image](scene-preview.png) is the actual image returned by the MCP server.

The test holds the recording pause for one second before resuming. OBS frontend and encoder transitions are asynchronous; the recording workflow verifies a stable state before returning. For rapid controls or a timeout, inspect state before retrying. Output behavior also depends on your installed encoders and OBS profile.

Physical capture devices, public streaming and live OBS on macOS/Linux are not covered by this acceptance test. The zero-vulnerability dependency audit is a point-in-time check, not a permanent guarantee.
