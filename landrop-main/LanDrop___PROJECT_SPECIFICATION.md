# LanDrop — Project Specification

**Project Name:** LanDrop  
**Desktop Component:** LanDrop Desktop  
**Android Component:** LanDrop Receiver  
**Specification Version:** 1.0  
**Protocol Version:** 1  
**Status:** Architecture Locked — Pre-Implementation

---

## 1. Project Overview

LanDrop is a secure, consent-based local network application for delivering Android APK files from a desktop computer to an Android device over a trusted local network.

The system is designed around one primary principle:

> **The Sender controls the delivery request and determines how that request is presented to the Receiver.**

The Sender can choose between two presentation modes:

1. **GUI Mode**
2. **Notification Mode**

The Receiver does not independently choose the presentation mode. It receives the Sender's delivery request, reads the requested presentation mode, and renders the request accordingly while still enforcing Android platform security and user-consent requirements.

LanDrop is intentionally designed as a local-first system.

The MVP does not require a cloud backend.

Supported network environments:

- Wi-Fi
- Ethernet/LAN
- Local networks where both devices can communicate directly

Future transports such as Tailscale may be considered separately and are not part of the MVP architecture.

---

# 2. Core Objective

LanDrop provides a reliable workflow for:

1. Discovering an available Android receiver on the local network.
2. Selecting a target device.
3. Selecting an APK file.
4. Extracting and validating APK metadata.
5. Allowing the Sender to customize presentation metadata.
6. Selecting the delivery presentation mode.
7. Establishing a secure connection.
8. Sending a delivery request.
9. Waiting for explicit Receiver consent.
10. Streaming the APK.
11. Verifying the transferred file using SHA-256.
12. Handing the verified APK to Android's official package installation mechanism.
13. Requiring the normal Android installation confirmation where required.
14. Reporting the final delivery state to the Sender.

The system must prioritize:

- Security
- Explicit user consent
- Integrity
- Reliability
- Performance
- Clear state management
- Modern UX
- Maintainable architecture

---

# 3. Security Boundary

LanDrop is a legitimate file-delivery application.

The MVP must NOT implement:

- Silent APK installation
- Bypassing Android Package Installer
- Root access
- Privilege escalation
- Arbitrary shell execution
- Remote command execution
- Remote administration
- Hidden persistence
- Anti-uninstall mechanisms
- Device takeover
- Credential collection
- Covert surveillance
- Hidden microphone recording
- Hidden camera capture
- Exploit delivery
- Security-control bypassing
- Unauthorized access to the Receiver device

The Receiver must remain a normal Android application subject to Android's security model.

The user must remain in control of installation.

---

# 4. System Components

LanDrop consists of two primary components.

## 4.1 LanDrop Desktop

LanDrop Desktop is the Sender application.

Responsibilities:

- Discover Receivers.
- Display available Receivers.
- Select a Receiver.
- Select an APK.
- Extract APK metadata.
- Validate APK metadata.
- Calculate APK SHA-256.
- Allow the Sender to customize presentation metadata.
- Select presentation mode.
- Establish secure communication.
- Create delivery requests.
- Track delivery state.
- Stream APK data.
- Display transfer progress.
- Handle cancellation.
- Display verification results.
- Display installation-handoff status.

Technology:

- Tauri
- React
- TypeScript
- Rust

---

## 4.2 LanDrop Receiver

LanDrop Receiver is the Android application installed on the destination device.

Responsibilities:

- Advertise its availability on the local network.
- Accept secure LanDrop connections.
- Parse delivery requests.
- Validate protocol messages.
- Validate requested presentation mode.
- Render the presentation requested by the Sender.
- Ask the local user for explicit consent.
- Receive the APK.
- Stream the APK to temporary storage.
- Calculate SHA-256 independently.
- Compare the received hash with the Sender-provided hash.
- Block installation when integrity verification fails.
- Hand the verified APK to Android's official package installer.
- Report delivery state to the Sender.

Technology:

- Kotlin
- Jetpack Compose
- Android SDK
- Kotlin Coroutines / Flow where appropriate

---

# 5. Fundamental Architectural Principle

## UI Is Not the Protocol

The protocol must not be designed around a particular UI.

The system has:

- One delivery protocol.
- One delivery request model.
- One session model.
- One transfer engine.
- One security model.
- Multiple presentation modes.

The presentation mode is an attribute of the Sender's delivery request.

Conceptually:

```text
Sender
  |
  | Delivery Request
  | + Application Metadata
  | + Sender Profile
  | + Presentation Mode
  |
  v
Receiver
  |
  +--> GUI Presentation
  |
  +--> Notification Presentation
```

The protocol remains identical regardless of presentation mode.

---

# 6. Sender-Controlled Presentation

This is a mandatory architectural requirement.

The Sender determines how the Receiver should present a delivery request.

Supported values:

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

The Receiver MUST NOT expose a persistent configuration such as:

```text
Delivery Presentation:
  GUI
  Notification
```

as the authority for selecting the presentation mode.

The Receiver may internally support both rendering mechanisms, but the active mode for a delivery is determined by the Sender's request.

The Receiver may still apply Android platform constraints. For example, a notification may open a full request screen when the user interacts with it.

---

# 7. Application Metadata

The Sender can customize the presentation metadata associated with a delivery.

Supported metadata:

- Application Name
- Application Icon
- Version
- Description
- Sender Display Name

Example:

```text
Application Name:
My Application

Version:
1.4.2

Description:
A local test application.

Sender:
ISHAQ CYBERTECH
```

The same metadata must be available to both presentation modes.

---

# 8. APK-Derived Metadata

Where possible, metadata must be extracted from the actual APK rather than blindly trusting user-entered values.

The Sender should inspect:

- Package name
- Version name
- Version code
- Application label
- Application icon
- APK file size
- SHA-256 hash

The Sender may customize the presentation values shown to the Receiver, but the system should retain the actual APK-derived identity internally.

For example:

```text
Actual APK identity:
package = com.example.application
versionCode = 42

Presentation identity:
name = My Application
version = 1.4.2
description = Test application
```

The package name should be treated as APK-derived identity and validated against the selected APK.

---

# 9. Sender Profile

Sender identity is separate from application identity.

Example:

```text
Sender Display Name:
ISHAQ CYBERTECH
```

This identifies the person, organization, or Sender profile initiating the delivery.

It must not be confused with:

- APK package name
- Application name
- Application developer identity
- Cryptographic identity

---

# 10. Delivery Presentation Modes

## 10.1 GUI Mode

In GUI mode, the Receiver presents a full LanDrop delivery interface.

The interface should be capable of displaying:

- Application icon
- Application name
- Version
- Description
- Package name
- APK size
- Sender display name
- Transfer/integrity information
- Accept button
- Reject button

Example conceptual interface:

```text
┌────────────────────────────────────┐
│              LanDrop               │
│                                    │
│          [ Application Icon ]      │
│                                    │
│          My Application            │
│          Version 1.4.2             │
│                                    │
│  Description:                      │
│  A local test application.         │
│                                    │
│  Package: com.example.application  │
│  Size: 24.8 MB                     │
│                                    │
│  Sender: ISHAQ CYBERTECH           │
│                                    │
│       [ Reject ]   [ Accept ]      │
└────────────────────────────────────┘
```

---

## 10.2 Notification Mode

In notification mode, the Receiver initially presents the delivery request through an Android notification.

The notification should contain concise information such as:

- Application name
- Sender name
- Version
- Short description where appropriate
- LanDrop branding

Example:

```text
LanDrop

ISHAQ CYBERTECH wants to send:
My Application v1.4.2

Tap to review the delivery request.
```

The notification is only a presentation mechanism.

It must not bypass user consent.

Tapping the notification should open the appropriate Receiver request UI where the user can review and approve or reject the delivery.

---

# 11. Presentation Mode Does Not Change the Protocol

The following remain identical regardless of mode:

- Discovery
- Connection
- TLS
- Session establishment
- Delivery request structure
- Metadata model
- Acceptance/rejection
- Transfer
- Progress reporting
- SHA-256 verification
- Cancellation
- Installation handoff
- Error handling
- State machine

Only the presentation layer changes.

---

# 12. End-to-End Delivery Flow

```text
1. Receiver starts
        |
        v
2. Receiver advertises LanDrop service
        |
        v
3. Desktop discovers Receiver
        |
        v
4. Sender selects Receiver
        |
        v
5. Sender selects APK
        |
        v
6. Sender extracts APK metadata
        |
        v
7. Sender customizes presentation metadata
        |
        v
8. Sender chooses GUI or Notification
        |
        v
9. Sender calculates SHA-256
        |
        v
10. Secure connection established
        |
        v
11. Delivery Request sent
        |
        v
12. Receiver presents request
        |
        +------ Reject ------> REJECTED
        |
        v
13. User accepts
        |
        v
14. APK transfer begins
        |
        v
15. Receiver calculates SHA-256
        |
        v
16. Integrity verification
        |
        +------ FAIL -------> FAILED
        |
        v
17. VERIFIED
        |
        v
18. Android Package Installer handoff
        |
        v
19. User completes Android installation
        |
        v
20. COMPLETED
```

---

# 13. Delivery State Machine

The delivery state machine is:

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

Alternative terminal states:

```text
REJECTED
FAILED
CANCELLED
```

---

# 14. Integrity Model

The Sender calculates:

```text
SHA-256(APK)
```

The Receiver independently calculates:

```text
SHA-256(received APK)
```

The Receiver compares both values.

If:

```text
sender_hash == receiver_hash
```

the file passes integrity verification.

If:

```text
sender_hash != receiver_hash
```

installation MUST NOT proceed.

Important:

> SHA-256 provides file integrity verification. It does not authenticate the Sender.

Sender authentication is a separate security concern.

---

# 15. Secure Transport

MVP transport:

```text
TCP
  +
TLS 1.3
  +
HTTPS-style application protocol
```

The application should use standard cryptographic and TLS implementations provided by the platform/runtime.

LanDrop must not implement custom cryptographic algorithms.

Encryption protects data in transit.

However:

> TLS encryption by itself does not automatically establish application-level trust between an unknown Sender and Receiver.

A future authenticated pairing mechanism may be introduced.

---

# 16. Discovery

The preferred MVP discovery mechanism is:

```text
mDNS / DNS-SD
```

Suggested service:

```text
_lanDrop._tcp.local
```

Discovery metadata may include:

- Device display name
- LanDrop version
- Protocol version
- Service port
- Capability information

Discovery information must not be treated as authentication.

---

# 17. Network Support

MVP priority:

1. Wi-Fi
2. Ethernet/LAN

The architecture should not assume that the network is always Wi-Fi.

The core protocol operates over IP connectivity.

Future transport mechanisms may be added without rewriting the delivery/session model.

---

# 18. APK Transfer

APK files must be transferred as binary streams.

The APK must NOT be embedded inside JSON.

Control plane:

```text
JSON messages
```

Data plane:

```text
Binary APK stream
```

This separation improves:

- Performance
- Memory usage
- Reliability
- Large-file handling
- Protocol clarity

---

# 19. Transfer Progress

The Sender should receive enough information to display:

- Bytes transferred
- Total bytes
- Percentage
- Transfer speed
- Estimated remaining time where possible
- Current state

Example:

```text
Receiving...

14.8 MB / 24.8 MB

59%

18.4 MB/s
```

---

# 20. Cancellation

The Sender may cancel an active transfer.

Cancellation must:

1. Stop the stream.
2. Close the active transfer.
3. Delete the partial APK where possible.
4. Release resources.
5. Update the session state to `CANCELLED`.
6. Notify the other side when possible.

A cancelled or incomplete APK must never be handed to the Android installer.

---

# 21. Temporary Storage

Received APKs must initially be stored in application-controlled temporary storage.

Conceptual structure:

```text
temporary/
    <session-id>/
        application.apk
```

The network-provided filename must never be trusted as an unrestricted filesystem path.

The implementation must prevent:

- Path traversal
- Absolute-path injection
- Directory escape
- Arbitrary filesystem writes

Temporary files should be cleaned after:

- Successful installation handoff
- Rejection
- Cancellation
- Integrity failure
- Expiration
- Fatal transfer failure

---

# 22. Input Validation

All network messages must be validated.

Validation includes:

- Protocol version
- Message type
- Required fields
- Field lengths
- Metadata limits
- Request IDs
- Session IDs
- Hash format
- File size
- Presentation mode
- State transitions

Malformed messages must result in controlled errors.

Malformed input must never crash the Receiver.

---

# 23. Resource Limits

The implementation should enforce configurable limits for:

- Maximum metadata size
- Maximum description length
- Maximum application name length
- Maximum sender display name length
- Maximum APK size
- Maximum concurrent sessions
- Maximum concurrent transfers
- Request expiration
- Transfer inactivity timeout

These limits protect both applications from resource exhaustion.

---

# 24. Error Codes

Standard error codes:

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

Errors should be machine-readable while the UI displays user-friendly messages.

---

# 25. First-Time Receiver Bootstrap

If LanDrop Receiver is not installed on the Android device, it cannot provide custom LanDrop receiving functionality.

Therefore, first-time setup may use a bootstrap flow where the Receiver APK itself is transferred through an available Android-supported mechanism.

However:

- The Receiver APK must be installed through normal Android mechanisms.
- User consent is required.
- LanDrop must not silently install itself.
- LanDrop must not bypass Package Installer restrictions.

Once LanDrop Receiver is installed, subsequent deliveries can use the LanDrop protocol.

---

# 26. Android Installation Handoff

After successful integrity verification:

```text
VERIFIED
    ↓
INSTALL_READY
    ↓
INSTALLATION_HANDOFF
```

The Receiver hands the APK to Android's supported package installation mechanism.

LanDrop does not directly replace or bypass Android's package installer.

The final installation outcome may depend on:

- Android version
- Device configuration
- User settings
- Package installer behavior
- Unknown-source/install permissions where applicable
- APK compatibility
- Signature/update rules

---

# 27. Package Identity

The package name should be extracted from the APK and retained as actual application identity.

Example:

```text
Package:
com.example.application
```

The Sender should not treat an arbitrary network-supplied package name as authoritative.

The Receiver should validate the received APK metadata where technically practical before installation handoff.

---

# 28. Architecture Layers

Both applications follow the same conceptual layering:

```text
Presentation Layer
        ↓
Application / Session Layer
        ↓
Protocol Layer
        ↓
Secure Transport Layer
        ↓
Platform / OS Layer
```

Responsibilities must remain separated.

The UI must not directly implement the transport protocol.

The transport layer must not contain UI logic.

The protocol layer must not depend on Compose or React.

---

# 29. Repository Structure

```text
LanDrop/
├── README.md
├── PROJECT_SPECIFICATION.md
│
├── protocol/
│   └── protocol-spec.md
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   └── threat-model.md
│
├── sender/
│   └── desktop/
│
└── receiver/
    └── android/
```

---

# 30. Desktop Technology

```text
Tauri
React
TypeScript
Rust
```

Suggested responsibilities:

### React / TypeScript

- UI
- Device list
- APK selection
- Metadata editor
- Presentation-mode selector
- Delivery state
- Transfer progress
- Logs/status

### Rust

- Secure local networking
- Discovery integration
- Protocol implementation
- TLS transport
- APK streaming
- Hashing
- Session management where appropriate
- OS integration

---

# 31. Android Technology

```text
Kotlin
Jetpack Compose
Android SDK
Coroutines
Flow
```

Suggested responsibilities:

### Compose

- Delivery request UI
- GUI presentation
- Status UI
- Installation handoff UI

### Android Platform

- Notifications
- Package installation handoff
- Application storage
- Network APIs
- Lifecycle management

### Kotlin Application Layer

- Session management
- Protocol handling
- Transfer engine
- State machine
- Validation
- Integrity verification

---

# 32. Performance Requirements

LanDrop should avoid unnecessary memory usage.

APK transfer must be streaming-based.

The implementation should:

- Avoid loading entire APKs into RAM.
- Use buffered streams.
- Report progress incrementally.
- Avoid unnecessary copies.
- Release resources after transfer.
- Support large APKs within configured limits.

---

# 33. Reliability Requirements

The system must gracefully handle:

- Receiver disappearing
- Wi-Fi disconnect
- Ethernet disconnect
- TLS failure
- Timeout
- User rejection
- User cancellation
- Partial transfer
- Hash mismatch
- Installation failure
- Malformed requests
- Application restart

The system must never assume that a network connection remains available.

---

# 34. Logging

Logs should be structured and useful for debugging.

Recommended categories:

```text
DISCOVERY
SESSION
PROTOCOL
TRANSFER
INTEGRITY
INSTALLATION
SECURITY
ERROR
```

Sensitive information must not be unnecessarily logged.

---

# 35. Future Authentication

The MVP may establish encrypted communication without complete persistent device authentication.

A future version should support authenticated pairing.

Possible mechanisms may include:

- QR-code pairing
- Public-key identity
- Certificate pinning
- Short authentication codes
- Persistent device trust

Authentication must be added without changing the core delivery state model.

---

# 36. Future Transport Abstraction

The protocol should not be tightly coupled to mDNS or a specific physical network.

Future transports may include:

- Tailscale
- Other private networks
- Direct connection
- Alternative discovery mechanisms

The same delivery/session model should remain reusable.

---

# 37. Testing Requirements

Before production readiness, testing must cover:

### Unit Tests

- Metadata validation
- Hash calculation
- State transitions
- Request parsing
- Error handling
- Path validation
- Presentation mode validation

### Integration Tests

- Discovery
- TLS connection
- Session establishment
- Request delivery
- Acceptance/rejection
- APK transfer
- Cancellation
- Hash verification
- Installation handoff

### Failure Tests

- Connection loss
- Timeout
- Corrupted transfer
- Invalid metadata
- Oversized request
- Malformed JSON
- Invalid state transition
- Duplicate request
- Expired request

### Presentation Tests

Verify that the same delivery request data can be rendered through:

```text
GUI
NOTIFICATION
```

without changing the underlying protocol or transfer behavior.

---

# 38. Development Phases

## Phase 0 — Specification

- Project specification
- Protocol specification
- Architecture
- Security model
- Threat model

## Phase 1 — Protocol Foundation

- Message schemas
- Session model
- State machine
- Validation
- Error model

## Phase 2 — Receiver Foundation

- Android project
- Network service
- Discovery
- Secure transport
- Session handling

## Phase 3 — Sender Foundation

- Tauri application
- Device discovery
- Connection management
- APK selection
- Metadata extraction

## Phase 4 — Delivery System

- Delivery requests
- GUI mode
- Notification mode
- Accept/reject
- Streaming transfer
- Progress

## Phase 5 — Integrity & Installation

- SHA-256
- Verification
- Temporary storage
- Android installation handoff

## Phase 6 — Integration

- End-to-end LAN delivery
- Failure handling
- Cancellation
- Recovery

## Phase 7 — Security Testing

- Protocol fuzzing
- Invalid-message testing
- Resource exhaustion testing
- Path traversal testing
- State-machine testing
- TLS validation

---

# 39. Definition of Done

The MVP is considered functionally complete when:

1. LanDrop Receiver can advertise itself.
2. LanDrop Desktop can discover it.
3. Sender can select an APK.
4. Sender can inspect APK metadata.
5. Sender can customize presentation metadata.
6. Sender can select GUI or Notification mode.
7. Sender can establish a secure session.
8. Receiver renders the requested presentation mode.
9. Receiver asks for explicit consent.
10. Sender can detect acceptance/rejection.
11. APK transfer is streamed.
12. Transfer progress is visible.
13. Cancellation works.
14. Receiver independently calculates SHA-256.
15. Hash mismatch blocks installation.
16. Verified APK is handed to Android's package installer.
17. Both sides maintain consistent delivery state.
18. Network failures are handled gracefully.
19. Invalid requests cannot crash the applications.
20. GUI and Notification modes use the same delivery protocol.

---

# 40. Final Architectural Rule

The most important rule in LanDrop is:

> **The Sender decides how a delivery request is presented. The Receiver renders that requested presentation while enforcing platform security and user consent.**

There is:

- One Sender.
- One Receiver.
- One delivery protocol.
- One session model.
- One transfer engine.
- One security model.
- Two presentation modes.

```text
                    LanDrop Desktop
                         Sender
                           |
                           |
                  Delivery Request
                           |
              +------------+------------+
              |                         |
       presentation.mode          application
              |                     metadata
              |                         |
              +------------+------------+
                           |
                           v
                    LanDrop Receiver
                           |
                  Reads requested mode
                           |
                 +---------+---------+
                 |                   |
                GUI            NOTIFICATION
                 |                   |
                 +---------+---------+
                           |
                     User Decision
                           |
                    Accept / Reject
                           |
                         Accept
                           |
                    APK Transfer
                           |
                    SHA-256 Verify
                           |
                  Android Installer
```

**This document is the project-level source of truth.**