# LanDrop — System Architecture

**Project:** LanDrop  
**Desktop:** LanDrop Desktop  
**Android:** LanDrop Receiver  
**Architecture Version:** 1.0  
**Status:** Architecture Locked — Pre-Implementation

---

# 1. Architecture Goals

LanDrop is designed as a modular local-network delivery system.

Primary goals:

- Secure APK delivery
- Explicit user consent
- High transfer performance
- Clear separation of concerns
- Sender-controlled presentation
- Android platform compliance
- Extensible transport architecture
- Testability
- Maintainability

---

# 2. High-Level Architecture

```text
                         LanDrop Desktop
                              |
                 +------------+------------+
                 |                         |
          Presentation Layer        Application Layer
                 |                         |
          React / TypeScript       Delivery / Session
                 |                         |
                 +------------+------------+
                              |
                         Rust Core
                              |
                    Protocol / Transport
                              |
                         TLS 1.3
                              |
                         TCP / IP
                              |
                    Local Network
                              |
                         TLS 1.3
                              |
                    Protocol / Transport
                              |
                       Kotlin Core
                              |
                 +------------+------------+
                 |                         |
          Application Layer        Presentation Layer
                 |                         |
          Session / Transfer       Compose / Android UI
                 |                         |
                 +------------+------------+
                              |
                     Android Platform
```

---

# 3. Architectural Layers

Both applications follow:

```text
Presentation
     ↓
Application
     ↓
Protocol
     ↓
Transport
     ↓
Platform
```

Each layer has a defined responsibility.

---

# 4. Presentation Layer

The presentation layer is responsible only for displaying information and collecting user interaction.

It must not directly implement:

- TCP
- TLS
- APK streaming
- SHA-256 transfer verification
- Session state logic

---

# 5. Application Layer

The application layer coordinates:

- Sessions
- Delivery requests
- State transitions
- Transfer lifecycle
- Metadata
- User decisions
- Error handling

It acts as the main orchestration layer.

---

# 6. Protocol Layer

The protocol layer implements the LanDrop communication contract.

Responsibilities:

- Message serialization
- Message parsing
- Validation
- Protocol version
- Request/response handling
- State-related protocol events

The protocol layer must be UI-independent.

---

# 7. Transport Layer

Responsibilities:

- TCP
- TLS 1.3
- Connection lifecycle
- Read/write streams
- Timeouts
- Connection errors

Transport code must not know whether the Receiver is using GUI or Notification mode.

---

# 8. Sender Architecture

LanDrop Desktop:

```text
React UI
   ↓
Desktop Application Layer
   ↓
Rust Core
   ├── Discovery
   ├── Session Manager
   ├── Protocol
   ├── TLS Transport
   ├── APK Manager
   ├── Hashing
   └── Transfer Engine
   ↓
Operating System
```

---

# 9. Desktop Presentation

The Desktop UI should provide:

### Device Discovery

```text
Nearby Receivers
```

### Receiver Selection

```text
Device Name
IP Address
Protocol Version
Availability
```

### APK Selection

```text
Select APK
```

### Metadata

```text
Application Name
Icon
Version
Description
Package Name
Size
SHA-256
```

### Sender Profile

```text
Sender Display Name
```

### Presentation Mode

The Sender chooses:

```text
GUI
Notification
```

This setting belongs to the delivery being created.

It is not a Receiver preference.

---

# 10. Sender-Controlled Presentation Architecture

This is a core design rule.

The Desktop creates:

```text
DeliveryRequest
```

containing:

```text
presentation.mode
```

Example:

```text
DeliveryRequest
├── requestId
├── sessionId
├── sender
├── application
└── presentation
      └── mode = GUI
```

or:

```text
presentation
      └── mode = NOTIFICATION
```

The Receiver does not negotiate the presentation mode as a preference.

---

# 11. Receiver Architecture

LanDrop Receiver:

```text
Android UI
   ↓
Receiver Application Layer
   ↓
Session Manager
   ↓
Protocol
   ↓
Transfer Engine
   ↓
TLS Transport
   ↓
Android Network APIs
```

Additional Android integrations:

```text
NotificationManager
Package Installer
Application Storage
Lifecycle APIs
```

---

# 12. Receiver Presentation Dispatcher

The Receiver should contain a presentation dispatcher.

Conceptually:

```text
DeliveryRequest
      |
      v
PresentationDispatcher
      |
      +---- GUI Renderer
      |
      +---- Notification Renderer
```

Pseudo-logic:

```text
if request.presentation.mode == GUI:
    showGuiRequest(request)

if request.presentation.mode == NOTIFICATION:
    showNotificationRequest(request)
```

This dispatcher does not choose the mode.

It executes the mode selected by the Sender.

---

# 13. Why the Dispatcher Exists

The dispatcher prevents presentation logic from leaking into:

- Protocol code
- Transfer code
- Session code
- Security code

The system therefore remains:

```text
One protocol
+
One session model
+
One transfer engine
+
Multiple renderers
```

---

# 14. Delivery Domain Model

A Delivery object should conceptually contain:

```text
Delivery
├── requestId
├── sessionId
├── state
├── senderProfile
├── applicationMetadata
├── presentationMode
├── transferInfo
└── integrityInfo
```

---

# 15. Application Metadata Model

Separate:

```text
APK Identity
```

from:

```text
Presentation Metadata
```

Example:

```text
APK Identity
├── packageName
├── versionCode
├── actualVersionName
├── fileSize
└── sha256
```

Presentation:

```text
Presentation Metadata
├── applicationName
├── icon
├── version
└── description
```

This allows the Sender to customize how information is displayed without corrupting the actual APK identity.

---

# 16. Sender Profile Model

Separate Sender profile from application metadata.

```text
SenderProfile
└── displayName
```

Example:

```text
ISHAQ CYBERTECH
```

This should remain independent from:

```text
Application Name
Package Name
APK Identity
```

---

# 17. APK Manager

Desktop APK Manager responsibilities:

1. Select APK.
2. Validate file.
3. Read APK metadata.
4. Extract package name.
5. Extract version.
6. Extract application label.
7. Extract icon where possible.
8. Calculate size.
9. Calculate SHA-256.

The APK Manager must not perform the network transfer itself.

---

# 18. Transfer Engine

The Transfer Engine is responsible for:

- Streaming
- Buffering
- Progress
- Cancellation
- Transfer errors
- Resource cleanup

It should expose events such as:

```text
Started
Progress
Completed
Cancelled
Failed
```

---

# 19. Integrity Engine

The integrity layer calculates SHA-256.

Desktop:

```text
APK
 ↓
SHA-256
 ↓
Expected Digest
```

Receiver:

```text
Received APK
 ↓
SHA-256
 ↓
Actual Digest
```

Comparison:

```text
Expected == Actual
```

---

# 20. Temporary Storage Architecture

Receiver:

```text
App-controlled temporary directory
        |
        +── session-id
               |
               └── application.apk
```

No arbitrary network path may be accepted.

---

# 21. Session Manager

The Session Manager coordinates:

- Connection
- Session establishment
- Delivery request
- User decision
- Transfer
- Verification
- Installation handoff
- Completion

It owns the delivery state machine.

---

# 22. State Machine Ownership

The application/session layer owns:

```text
Delivery State
```

Presentation layers only observe the state.

For example:

```text
TRANSFERRING
```

can be rendered as:

```text
GUI progress screen
```

or:

```text
Notification progress
```

without changing the underlying state.

---

# 23. Presentation Independence

This is important:

```text
Presentation Mode
```

is metadata.

```text
Delivery State
```

is operational state.

They must not be merged.

Example:

```text
presentationMode = NOTIFICATION
deliveryState = TRANSFERRING
```

is valid.

---

# 24. Notification Architecture

The Notification Renderer is responsible for:

- Creating the Android notification
- Displaying concise delivery information
- Opening the request screen when interacted with
- Reflecting relevant delivery state

It must not:

- Install the APK directly
- Bypass consent
- Implement transport
- Implement hashing

---

# 25. GUI Architecture

The GUI Renderer is responsible for:

- Rendering application information
- Rendering Sender information
- Showing Accept/Reject
- Showing transfer state
- Showing integrity status
- Showing installation handoff status

It consumes the same Delivery model.

---

# 26. Shared Delivery View Model

Both renderers should receive the same logical data:

```text
DeliveryViewModel
```

Conceptually:

```text
DeliveryViewModel
├── application
├── sender
├── presentation
├── state
├── transfer
└── integrity
```

This prevents the GUI and Notification implementations from diverging.

---

# 27. Discovery Architecture

Desktop:

```text
mDNS Browser
     ↓
Receiver Discovery Model
     ↓
Device List
```

Receiver:

```text
LanDrop Service
     ↓
mDNS Advertisement
```

Discovery is separated from protocol communication.

---

# 28. Secure Connection Architecture

```text
Discovery
   ↓
TCP Connection
   ↓
TLS 1.3
   ↓
Protocol Negotiation
   ↓
Session
```

Discovery does not establish trust.

TLS protects communication.

Future authenticated pairing establishes persistent application-level trust.

---

# 29. Protocol/Transport Boundary

The protocol layer should operate against an abstract transport interface.

Conceptually:

```text
Transport
├── connect()
├── read()
├── write()
└── close()
```

The implementation may later support different transports without rewriting the protocol.

---

# 30. Future Transport Architecture

Potential:

```text
Local TCP
Tailscale
Other private network
```

All can feed:

```text
Same Protocol
Same Session
Same Delivery Model
Same Transfer Engine
```

---

# 31. Error Architecture

Errors should be divided into:

### Transport Errors

```text
TLS failure
Connection lost
Timeout
```

### Protocol Errors

```text
Invalid request
Unsupported protocol
Malformed message
```

### Transfer Errors

```text
File too large
Transfer timeout
Cancellation
```

### Integrity Errors

```text
Hash mismatch
```

### Platform Errors

```text
Installation unavailable
Package installer failure
```

The UI converts these into appropriate user-facing messages.

---

# 32. Security Architecture

Security boundaries exist at multiple layers.

```text
Discovery
   ↓
TLS
   ↓
Protocol Validation
   ↓
Session Validation
   ↓
User Consent
   ↓
Transfer Integrity
   ↓
Android Package Installation
```

No single layer is assumed to provide all security guarantees.

---

# 33. Threat Model Summary

Potential threats include:

- Malformed requests
- Oversized requests
- Unauthorized network access
- Connection interception
- Connection loss
- Data corruption
- Path traversal
- Replay
- Resource exhaustion
- Malicious APK content

Mitigations include:

- TLS 1.3
- Input validation
- Size limits
- Controlled temporary storage
- SHA-256 integrity verification
- Explicit user consent
- Android Package Installer
- Timeouts
- State-machine validation

---

# 34. Authentication Limitation

MVP architecture does not claim that every discovered Receiver is automatically trusted.

The system must clearly distinguish:

```text
Encrypted
```

from:

```text
Authenticated
```

Future pairing can add:

```text
Device Identity
Public Key
Trust Relationship
```

without redesigning the transfer architecture.

---

# 35. Security Logging

Important events:

```text
SESSION_CREATED
DELIVERY_REQUEST_SENT
DELIVERY_ACCEPTED
DELIVERY_REJECTED
TRANSFER_STARTED
TRANSFER_CANCELLED
TRANSFER_COMPLETED
INTEGRITY_VERIFIED
INTEGRITY_FAILED
INSTALLATION_HANDOFF
COMPLETED
FAILED
```

Sensitive values should not be logged unnecessarily.

---

# 36. Concurrency

The architecture should support multiple discovered Receivers.

MVP may restrict active transfers to a single transfer if that simplifies initial implementation.

However, the domain model should not assume that only one Receiver can ever exist.

Future:

```text
Sender
 |
 +---- Receiver A
 |
 +---- Receiver B
 |
 +---- Receiver C
```

---

# 37. Lifecycle Handling

Android lifecycle events must not corrupt the protocol state.

The Receiver must safely handle:

- Activity recreation
- Backgrounding
- Notification interaction
- Process lifecycle changes
- Network changes

Long-running transfer logic must be separated from UI lifecycle where Android permits.

---

# 38. Data Ownership

### Desktop owns

- Selected APK
- Sender customization
- Delivery creation
- Presentation-mode choice

### Receiver owns

- Local presentation
- User consent
- Temporary received file
- Integrity verification
- Android installation handoff

### Neither owns

- The other's internal UI state.

---

# 39. Critical Ownership Rule

The following ownership must never be inverted:

```text
Sender
  |
  +--> chooses presentation mode
```

NOT:

```text
Receiver
  |
  +--> chooses presentation mode
```

The Receiver only executes the presentation requested by the Sender.

---

# 40. Repository Architecture

```text
LanDrop/
│
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
│       ├── src/
│       ├── src-tauri/
│       ├── package.json
│       └── ...
│
└── receiver/
    └── android/
        ├── app/
        ├── gradle/
        └── ...
```

---

# 41. Dependency Boundaries

The following dependencies are forbidden:

```text
UI → Direct TCP
UI → Direct TLS
UI → Direct filesystem protocol logic
UI → Direct transfer engine
```

Instead:

```text
UI
 ↓
Application Layer
 ↓
Protocol / Transport
```

---

# 42. Testing Architecture

Each layer should be independently testable.

### Presentation

- Rendering
- User interactions
- State display

### Application

- State transitions
- Delivery lifecycle
- Cancellation

### Protocol

- Serialization
- Parsing
- Validation
- Version handling

### Transport

- TLS
- Connection lifecycle
- Timeouts

### Transfer

- Streaming
- Progress
- Cancellation

### Integrity

- SHA-256
- Mismatch handling

---

# 43. End-to-End Architecture

Complete flow:

```text
┌──────────────────────────────────────────┐
│              LanDrop Desktop             │
│                                          │
│  React UI                                │
│     │                                    │
│     ├── Select Receiver                  │
│     ├── Select APK                       │
│     ├── Customize Metadata               │
│     └── Choose GUI / Notification        │
│                  │                       │
│             Application Layer            │
│                  │                       │
│              Rust Core                   │
│                  │                       │
│          Protocol + TLS + TCP            │
└──────────────────┬───────────────────────┘
                   │
                   │ Local Network
                   │
┌──────────────────▼───────────────────────┐
│              LanDrop Receiver            │
│                                          │
│          TLS + TCP + Protocol            │
│                  │                       │
│            Session Manager               │
│                  │                       │
│          Presentation Dispatcher         │
│             │              │             │
│             ▼              ▼             │
│            GUI       Notification        │
│             │              │             │
│             └──────┬───────┘             │
│                    ▼                     │
│              User Consent                │
│                    │                     │
│              Transfer Engine             │
│                    │                     │
│              SHA-256 Verify              │
│                    │                     │
│          Android Package Installer       │
└──────────────────────────────────────────┘
```

---

# 44. Architectural Invariants

The following invariants must always remain true:

### Invariant 1

The Sender selects the presentation mode.

### Invariant 2

The Receiver renders the selected presentation mode.

### Invariant 3

GUI and Notification use the same Delivery Request.

### Invariant 4

Presentation mode does not alter the protocol.

### Invariant 5

Presentation mode does not alter transfer behavior.

### Invariant 6

Presentation mode does not alter security requirements.

### Invariant 7

APK installation remains subject to Android platform rules.

### Invariant 8

SHA-256 verification is mandatory before installation handoff.

### Invariant 9

Network filenames cannot control arbitrary filesystem paths.

### Invariant 10

UI code cannot directly own the network protocol.

---

# 45. Implementation Strategy

Implementation should proceed in controlled stages.

Do not generate the entire application in one AI coding prompt.

Recommended sequence:

```text
1. Repository foundation
2. Protocol types
3. State machine
4. Discovery
5. Secure transport
6. Receiver foundation
7. Desktop foundation
8. Delivery request
9. GUI renderer
10. Notification renderer
11. Transfer engine
12. Integrity verification
13. Android installation handoff
14. End-to-end integration
15. Security testing
```

Each phase should build and test before the next phase begins.

---

# 46. AI Development Rule

AI coding agents must treat:

```text
PROJECT_SPECIFICATION.md
protocol/protocol-spec.md
docs/architecture.md
```

as authoritative project documentation.

Agents must not:

- Invent alternative architectures
- Move presentation-mode authority to the Receiver
- Introduce a cloud backend into MVP
- Replace the protocol with ad-hoc communication
- Add root functionality
- Add shell execution
- Add silent installation
- Bypass Android security

If implementation details are ambiguous, the agent should preserve the architecture rather than silently redesign it.

---

# 47. Final Architecture Principle

LanDrop is fundamentally:

```text
A Sender-controlled local delivery protocol
with a platform-compliant Android Receiver
and multiple presentation renderers.
```

The central architecture is:

```text
                  SENDER
                    |
          Delivery Request
                    |
          Presentation Mode
             /            \
           GUI       NOTIFICATION
             \            /
              \          /
               RECEIVER
                   |
             User Consent
                   |
             APK Transfer
                   |
             SHA-256 Verify
                   |
          Android Installer
```

The presentation mode is selected by the Sender.

The Receiver does not select it.

The protocol remains unified.

The transfer engine remains unified.

The security model remains unified.

Only the presentation renderer changes.