# LanDrop Protocol Specification

**Protocol Name:** LanDrop Local Delivery Protocol  
**Protocol Version:** 1  
**Transport:** TCP + TLS 1.3  
**Application Format:** JSON control messages + binary streaming  
**Discovery:** mDNS / DNS-SD  
**Status:** Protocol Locked — Pre-Implementation

---

# 1. Purpose

The LanDrop Protocol defines the communication contract between:

- LanDrop Desktop
- LanDrop Receiver

The protocol provides a secure, stateful mechanism for delivering Android APK files over a local IP network.

The protocol is independent of the user interface.

The protocol MUST remain identical regardless of whether the Sender chooses:

```text
GUI
```

or:

```text
NOTIFICATION
```

presentation.

---

# 2. Fundamental Rule

The Sender determines the presentation mode.

The Receiver does not choose the presentation mode for a delivery.

The Sender includes the requested presentation mode in the delivery request.

Supported modes:

```text
GUI
NOTIFICATION
```

Example:

```json
{
  "presentation": {
    "mode": "GUI"
  }
}
```

or:

```json
{
  "presentation": {
    "mode": "NOTIFICATION"
  }
}
```

The Receiver renders the requested mode.

The Receiver remains responsible for enforcing:

- Android notification rules
- Android lifecycle restrictions
- User consent
- Package installation security
- Platform limitations

---

# 3. Transport Architecture

```text
Application
    |
JSON Control Plane
    |
Binary Transfer Plane
    |
TLS 1.3
    |
TCP
    |
IP Network
```

The protocol MUST NOT send APK binary data inside JSON.

---

# 4. Discovery

LanDrop uses mDNS/DNS-SD for local discovery.

Suggested service:

```text
_lanDrop._tcp.local
```

Example discovery information:

```text
service = _lanDrop._tcp.local
hostname = receiver-device.local
port = 45821
protocol_version = 1
device_name = Android Device
```

Discovery is informational only.

> Discovery does not authenticate a device.

---

# 5. Connection Establishment

The Sender:

1. Discovers a Receiver.
2. Resolves its network address.
3. Opens TCP.
4. Establishes TLS 1.3.
5. Validates the TLS connection.
6. Negotiates the LanDrop protocol version.
7. Creates a session.

Conceptual flow:

```text
DISCOVERY
   ↓
TCP CONNECT
   ↓
TLS 1.3
   ↓
PROTOCOL NEGOTIATION
   ↓
SESSION ESTABLISHMENT
```

---

# 6. Protocol Version

Current version:

```text
1
```

Messages must include a protocol version where required.

Unsupported versions result in:

```text
UNSUPPORTED_PROTOCOL
```

Future versions must preserve backward compatibility where practical.

---

# 7. Session Model

A session represents one Sender-to-Receiver interaction.

A session should have:

- `session_id`
- protocol version
- creation time
- expiration time
- Sender identity information
- Receiver identity information
- session state

Example:

```json
{
  "session_id": "sess_01J...",
  "protocol_version": 1
}
```

---

# 8. Delivery Request

The primary protocol object is the Delivery Request.

Conceptual schema:

```json
{
  "type": "delivery_request",
  "protocol_version": 1,
  "request_id": "req_01J...",
  "session_id": "sess_01J...",
  "presentation": {
    "mode": "GUI"
  },
  "sender": {
    "display_name": "ISHAQ CYBERTECH"
  },
  "application": {
    "name": "My Application",
    "version": "1.4.2",
    "description": "A local test application.",
    "package_name": "com.example.application",
    "size_bytes": 26004608,
    "sha256": "..."
  }
}
```

---

# 9. Presentation Object

The presentation object is controlled by the Sender.

Schema:

```json
{
  "presentation": {
    "mode": "GUI"
  }
}
```

Valid values:

```text
GUI
NOTIFICATION
```

Invalid values must produce:

```text
INVALID_REQUEST
```

The Receiver must not silently replace the requested mode with its own preferred mode.

If a platform restriction prevents the requested presentation from being used exactly as specified, the Receiver must handle the limitation safely and transparently rather than bypassing platform restrictions.

---

# 10. Sender Profile

Sender profile:

```json
{
  "sender": {
    "display_name": "ISHAQ CYBERTECH"
  }
}
```

The display name is presentation metadata.

It is NOT equivalent to cryptographic authentication.

A future protocol version may introduce a cryptographically authenticated Sender identity.

---

# 11. Application Metadata

Application metadata:

```json
{
  "application": {
    "name": "My Application",
    "version": "1.4.2",
    "description": "A local test application.",
    "package_name": "com.example.application",
    "size_bytes": 26004608,
    "sha256": "..."
  }
}
```

The following values are presentation-oriented:

- name
- version
- description

The following values should represent actual APK identity:

- package_name
- size_bytes
- sha256

---

# 12. APK Metadata Trust Model

The Sender should derive package identity and technical metadata from the selected APK.

The protocol should not assume that a manually entered package name is authoritative.

The Receiver may perform additional APK inspection before installation handoff.

---

# 13. Delivery Request Lifecycle

```text
REQUEST_SENT
       ↓
WAITING_FOR_DECISION
       |
       +---- REJECT ----> REJECTED
       |
       +---- ACCEPT ----> ACCEPTED
```

The Receiver must not start APK transfer before explicit acceptance.

---

# 14. Acceptance

The Receiver sends:

```json
{
  "type": "delivery_response",
  "request_id": "req_01J...",
  "decision": "ACCEPT"
}
```

The Sender then transitions to:

```text
ACCEPTED
```

---

# 15. Rejection

The Receiver sends:

```json
{
  "type": "delivery_response",
  "request_id": "req_01J...",
  "decision": "REJECT"
}
```

The Sender transitions to:

```text
REJECTED
```

No APK transfer may occur after rejection.

---

# 16. Transfer Preparation

After acceptance:

```text
ACCEPTED
    ↓
TRANSFER_PREPARING
    ↓
TRANSFERRING
```

The Sender prepares the binary stream.

The Receiver prepares temporary storage.

---

# 17. Binary Transfer

The APK is streamed as binary data.

Conceptually:

```text
Control message
      ↓
TRANSFER_READY
      ↓
Binary stream
      ↓
TRANSFER_COMPLETE
```

The implementation must use buffered streaming.

The entire APK must not be loaded into memory.

---

# 18. Transfer Metadata

Before streaming, the Sender should provide enough information for the Receiver to validate:

- Request ID
- File size
- SHA-256
- Filename/display name
- Application identity

The Receiver should verify that received bytes do not exceed the declared size.

---

# 19. Transfer Progress

Progress messages may contain:

```json
{
  "type": "transfer_progress",
  "transfer_id": "tr_01J...",
  "bytes_transferred": 14800000,
  "total_bytes": 26004608
}
```

The Receiver and Sender may calculate:

```text
percentage
speed
ETA
```

locally.

---

# 20. Transfer Completion

After the binary stream finishes:

```text
TRANSFERRING
      ↓
VERIFYING
```

The Receiver calculates SHA-256 independently.

---

# 21. Integrity Verification

Sender:

```text
SHA256(sender APK)
```

Receiver:

```text
SHA256(received APK)
```

Verification:

```text
sender_hash == receiver_hash
```

If equal:

```text
VERIFIED
```

If different:

```text
INTEGRITY_MISMATCH
```

Installation must be blocked when the hashes differ.

---

# 22. Important Security Limitation

SHA-256 verifies integrity of the received bytes against the expected digest.

It does not prove:

```text
"This Sender is trusted."
```

Therefore:

```text
Encryption != Authentication
Hash != Sender Authentication
Discovery != Trust
Display Name != Identity
```

Authenticated pairing is a future enhancement.

---

# 23. Installation Handoff

After successful verification:

```text
VERIFIED
    ↓
INSTALL_READY
    ↓
INSTALLATION_HANDOFF
```

The Receiver invokes Android's supported package installation mechanism.

LanDrop does not bypass Android Package Installer.

---

# 24. Cancellation

The Sender may request cancellation:

```json
{
  "type": "transfer_cancel",
  "transfer_id": "tr_01J..."
}
```

The Receiver must:

- Stop receiving.
- Close the stream.
- Remove partial data.
- Update state.
- Report cancellation when possible.

---

# 25. Request Expiration

Requests must have a finite lifetime.

If a Receiver does not respond within the configured request timeout:

```text
REQUEST_EXPIRED
```

The Sender must not wait indefinitely.

---

# 26. Transfer Timeout

Transfers must use inactivity timeouts.

A connection that remains established but transfers no data beyond the configured timeout should terminate safely.

Result:

```text
TRANSFER_TIMEOUT
```

---

# 27. Connection Loss

If the network connection disappears:

```text
CONNECTION_LOST
```

Partial APK data must not be considered installable.

The session transitions to:

```text
FAILED
```

or another explicitly defined recovery state.

---

# 28. Error Message

Conceptual structure:

```json
{
  "type": "error",
  "request_id": "req_01J...",
  "code": "INTEGRITY_MISMATCH",
  "message": "Received file failed integrity verification."
}
```

The `code` is machine-readable.

The `message` is human-readable.

---

# 29. Error Codes

```text
INVALID_REQUEST
UNSUPPORTED_PROTOCOL
REQUEST_EXPIRED
USER_REJECTED
TRANSFER_CANCELLED
TRANSFER_TIMEOUT
CONNECTION_LOST
FILE_TOO_LARGE
INVALID_METADATA
INTEGRITY_MISMATCH
INSTALLATION_UNAVAILABLE
INTERNAL_ERROR
```

---

# 30. State Machine

Full state model:

```text
DISCOVERING
    ↓
AVAILABLE
    ↓
CONNECTING
    ↓
SECURE_CHANNEL
    ↓
SESSION_ESTABLISHED
    ↓
REQUEST_SENT
    ↓
WAITING_FOR_DECISION
    ↓
ACCEPTED
    ↓
TRANSFER_PREPARING
    ↓
TRANSFERRING
    ↓
VERIFYING
    ↓
VERIFIED
    ↓
INSTALL_READY
    ↓
INSTALLATION_HANDOFF
    ↓
COMPLETED
```

Alternative states:

```text
REJECTED
FAILED
CANCELLED
```

---

# 31. Presentation State vs Delivery State

Presentation mode:

```text
GUI
NOTIFICATION
```

is NOT a delivery state.

For example:

```text
TRANSFERING
```

does not become different depending on presentation mode.

Instead:

```text
Delivery State = TRANSFERRING
Presentation Mode = GUI
```

or:

```text
Delivery State = TRANSFERRING
Presentation Mode = NOTIFICATION
```

This distinction is mandatory.

---

# 32. GUI Presentation Semantics

If:

```text
presentation.mode = GUI
```

the Receiver should open/render the LanDrop delivery UI.

The UI should consume the same Delivery Request object used by Notification Mode.

---

# 33. Notification Presentation Semantics

If:

```text
presentation.mode = NOTIFICATION
```

the Receiver should create an Android notification representing the delivery request.

The notification must not independently authorize installation.

User interaction must still lead to an explicit consent flow.

---

# 34. Shared Presentation Model

Both modes consume:

```text
DeliveryRequest
```

They do not create separate protocol messages.

Conceptually:

```text
DeliveryRequest
      |
      +------ GUI Renderer
      |
      +------ Notification Renderer
```

---

# 35. Message Validation

Every incoming message must be validated before processing.

Validation includes:

- Message type
- Protocol version
- Request ID
- Session ID
- Required fields
- Field lengths
- Enum values
- Numeric ranges
- Hash format
- File size
- Presentation mode

Invalid messages must be rejected safely.

---

# 36. Path Security

Network-provided filenames must never be directly concatenated into filesystem paths.

The implementation must reject or sanitize:

```text
../
..\
/
\
absolute paths
```

Temporary storage must remain inside the application's controlled directory.

---

# 37. Resource Exhaustion Protection

Implement limits for:

- Request size
- Metadata size
- Description length
- APK size
- Concurrent requests
- Concurrent transfers
- Request lifetime
- Transfer inactivity
- Buffer sizes

---

# 38. Replay Protection

MVP sessions should use unique:

```text
session_id
request_id
transfer_id
```

A future authenticated protocol version should add:

- Nonces
- Signed requests
- Device identity
- Replay detection

---

# 39. Authentication Roadmap

MVP:

```text
TLS encryption
+
local discovery
+
explicit user consent
```

Future:

```text
Authenticated pairing
+
persistent device identity
+
certificate/public-key trust
```

Authentication must be designed as an extension rather than tightly coupling it to the UI.

---

# 40. Protocol Extensibility

Future features must not break:

- Delivery Request
- Session model
- State machine
- Transfer model

Potential future additions:

- Authenticated pairing
- Multiple simultaneous receivers
- Resume support
- Transfer history
- Alternative transports
- Tailscale
- QR pairing

---

# 41. Protocol Security Rules

The protocol must never provide mechanisms for:

- Remote shell execution
- Arbitrary command execution
- Privilege escalation
- Silent installation
- Bypassing user consent
- Remote device takeover
- Hidden surveillance

---

# 42. Implementation Rule

The implementation must treat this specification as the protocol source of truth.

UI requirements must not modify the protocol.

Platform-specific restrictions must be implemented at the platform layer.

---

# 43. Final Protocol Principle

```text
Sender
  |
  | Delivery Request
  | presentation.mode = GUI / NOTIFICATION
  |
  v
Receiver
  |
  | Reads mode
  |
  +---- GUI Renderer
  |
  +---- Notification Renderer
  |
  v
User Consent
  |
  v
Transfer
  |
  v
SHA-256 Verification
  |
  v
Android Installation Handoff
```

The Sender chooses the presentation.

The Receiver renders it.

The protocol remains the same.

The security model remains the same.

The transfer mechanism remains the same.