# Security

This server controls the OBS instance configured by the user. Keep the OBS WebSocket password private and configure it through the MCP client's environment. The server does not read passwords from OBS configuration files, log them, or load `.env` files automatically. It redacts known credential fields and the configured password from JSON results and errors. Redaction is defense in depth, not a guarantee for arbitrary third-party plugin payloads or secrets visibly rendered inside screenshots.

`OBS_READ_ONLY=true` enforces inspection-only operation, including raw dispatch and batches. MCP annotations are guidance for clients; enforcement happens again at request dispatch. OBS's password grants broad control, so do not treat it as a scoped credential.

OBS operations may change the live broadcast, create output files, or open media/browser source URLs. Tools use OBS's documented API; there is no arbitrary shell command tool. Keep OBS local by default. For remote control, use a trusted network or a secured tunnel.

Report security issues privately to the repository owner through GitHub rather than publishing credentials in an issue. This project is independent of OBS Project and is not an official OBS product.
