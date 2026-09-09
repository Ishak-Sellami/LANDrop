# LanDrop

### Secure Local Application Delivery for Android

LanDrop is a modern local-network application delivery system that allows users to send Android APK files from a desktop computer to a nearby Android device over Wi-Fi or a local LAN.

The project consists of two main components:

- **LanDrop Desktop** — the desktop controller and sender.
- **LanDrop Receiver** — the Android receiver and end-user component.

LanDrop is designed around **security, transparency, integrity verification, and user consent**.

---

## ✨ Features

- 📡 Local device discovery
- 📶 Wi-Fi-first communication
- 🔌 Ethernet/LAN support
- 📦 APK delivery
- 🖥️ Modern desktop interface
- 📱 Native Android receiver
- 🔐 Secure network communication
- #️⃣ SHA-256 APK integrity verification
- 👤 Explicit Android user approval
- 📊 Transfer progress and status
- ❌ Transfer cancellation and rejection handling
- 🧹 Temporary-file cleanup
- 🌙 Modern cybersecurity-inspired UI
- ☁️ No cloud backend required for the MVP

---

## 🏗️ Architecture

LanDrop uses a simple local-first architecture:

```text
                    LOCAL NETWORK
                Wi-Fi / Ethernet / LAN
                          │
             ┌────────────┴────────────┐
             │                         │
             ▼                         ▼
    ┌─────────────────┐       ┌─────────────────┐
    │ LanDrop Desktop │       │ LanDrop Receiver│
    │                 │       │                 │
    │   Controller    │◄─────►│ Android Client  │
    │     Sender      │       │    End User     │
    └─────────────────┘       └─────────────────┘
```

### LanDrop Desktop

The desktop application is responsible for:

- Discovering nearby LanDrop Receivers.
- Selecting a target Android device.
- Selecting an APK.
- Preparing application metadata.
- Calculating the APK SHA-256 hash.
- Sending delivery requests.
- Monitoring transfer progress.
- Reporting transfer results.

### LanDrop Receiver

The Android application is responsible for:

- Participating in local device discovery.
- Receiving delivery requests.
- Displaying sender and application information.
- Asking the Android user for approval.
- Downloading the APK.
- Verifying its integrity.
- Handing the verified APK to Android's package installer.

---

# 🔄 How It Works

## First-Time Setup

When the Android device does not have LanDrop Receiver installed, the initial setup follows the normal Android installation process:

```text
LanDrop Desktop
       │
       ▼
Discover Android Device
       │
       ▼
LanDrop Receiver Not Installed
       │
       ▼
Receiver APK Transfer
       │
       ▼
Android User Approval
       │
       ▼
Android Package Installer
       │
       ▼
LanDrop Receiver Installed
```

The receiver cannot provide application-level functionality before it is installed. Therefore, the first-time setup relies on legitimate Android installation mechanisms.

---

## Normal Application Delivery

Once LanDrop Receiver is installed:

```text
1. Discover device
       ↓
2. Select target
       ↓
3. Select APK
       ↓
4. Prepare application information
       ↓
5. Send delivery request
       ↓
6. Android user accepts
       ↓
7. Transfer APK
       ↓
8. Verify SHA-256
       ↓
9. Open Android Package Installer
       ↓
10. Android user confirms installation
```

The Android user remains in control of the final installation.

---

# 🔐 Security

Security is a core design principle of LanDrop.

### Integrity Verification

LanDrop uses SHA-256 to verify that the APK received by the Android device matches the APK that was prepared for transfer.

```text
Desktop APK
     │
     ▼
SHA-256
     │
     ▼
Secure Transfer
     │
     ▼
Received APK
     │
     ▼
SHA-256 Verification
     │
     ├── Match ──────► Continue
     │
     └── Mismatch ──► Stop
```

An APK that fails integrity verification MUST NOT be presented for installation.

### Secure Communication

LanDrop is designed to use established secure transport mechanisms for network communication.

The project does not implement custom cryptographic algorithms.

Future versions may introduce stronger device pairing and authentication.

---

# 🛡️ Security Boundaries

LanDrop is intentionally designed with strict security boundaries.

LanDrop does **not**:

- Require root access.
- Perform silent APK installation.
- Bypass Android's Package Installer.
- Execute arbitrary commands on Android.
- Provide a remote shell.
- Provide remote device control.
- Implement surveillance functionality.
- Use stealth persistence.
- Prevent normal application removal.
- Require a cloud backend for MVP operation.

LanDrop is an **application delivery system**, not a remote administration or surveillance tool.

---

# 🎯 Project Goals

The primary goals of LanDrop are:

1. Make local APK delivery simple.
2. Provide a modern and professional user experience.
3. Keep the Android user in control.
4. Protect transferred files against accidental modification.
5. Work primarily over local Wi-Fi.
6. Support standard Ethernet/LAN environments.
7. Avoid unnecessary cloud infrastructure.
8. Provide a modular architecture suitable for future expansion.

---

# 💻 Technology

## LanDrop Desktop

The preferred desktop technology stack is:

- **Tauri**
- **React**
- **TypeScript**
- **Rust**

The architecture should keep UI, networking, and protocol logic separated.

## LanDrop Receiver

The preferred Android technology stack is:

- **Kotlin**
- **Jetpack Compose**
- **Android SDK**
- Native Android networking APIs
- Native Android package installation APIs

---

# 🌐 Network Support

### MVP

LanDrop prioritizes:

```text
Wi-Fi
  ↓
Ethernet / Local LAN
```

The desktop and Android device should normally be connected to the same local network.

### Future

The architecture may later support:

```text
Wi-Fi
Ethernet/LAN
Tailscale
Other compatible network transports
```

Tailscale is intentionally excluded from the MVP.

---

# 🔮 Future Roadmap

Potential future features include:

- 🔗 Trusted-device pairing
- 🔑 Strong device authentication
- 🪪 Cryptographic device identities
- ✍️ APK digital-signature verification
- 📋 Transfer history
- 📦 Transfer queues
- 👥 Multiple simultaneous receivers
- 🌐 Optional Tailscale connectivity
- 📁 Additional file-transfer capabilities
- 🔒 Trusted sender management

These features are not required for the initial MVP.

---

# 📁 Project Structure

The planned repository structure is:

```text
LanDrop/
│
├── README.md
├── PROJECT_SPECIFICATION.md
│
├── sender/
│   └── desktop/
│
├── receiver/
│   └── android/
│
├── protocol/
│   └── protocol-spec.md
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   └── threat-model.md
│
└── LICENSE
```

---

# 📚 Documentation

| Document | Purpose |
|---|---|
| `README.md` | Project overview and getting started |
| `PROJECT_SPECIFICATION.md` | Primary engineering specification |
| `protocol/protocol-spec.md` | Network protocol specification |
| `docs/architecture.md` | Detailed architecture documentation |
| `docs/security.md` | Security design and requirements |
| `docs/threat-model.md` | Threat model and mitigations |

The most important document for development is:

**`PROJECT_SPECIFICATION.md`**

It acts as the engineering source of truth for the project.

---

# 🧪 Development Status

**Current Status: Specification / Pre-Development**

The project is currently being defined before implementation begins.

### Planned development stages

- [ ] Project foundation
- [ ] Desktop application foundation
- [ ] Android receiver foundation
- [ ] Local device discovery
- [ ] Receiver communication
- [ ] Delivery request workflow
- [ ] APK transfer
- [ ] SHA-256 verification
- [ ] Android installation handoff
- [ ] Error handling
- [ ] Security hardening
- [ ] UI/UX refinement
- [ ] MVP testing

---

# 🤝 Development Philosophy

LanDrop follows several core principles:

### Local First

The MVP should work without cloud infrastructure.

### Consent First

The Android user decides whether an application delivery request is accepted.

### Security by Design

Security requirements are defined before implementation rather than added afterward.

### Minimal Complexity

The project should use the simplest architecture that satisfies its requirements securely.

### Transparency

Users should understand:

- Who is sending the application.
- What application is being sent.
- What will happen after acceptance.
- Whether the file passed integrity verification.

### Modular Architecture

Desktop, Android, and protocol components should remain logically separated.

---

# ⚠️ Important Security Note

A SHA-256 match verifies file integrity, but it does **not** by itself prove that the sender is trustworthy.

Therefore:

```text
SHA-256
   =
File Integrity
```

but:

```text
Authentication / Digital Signature
   =
Stronger Sender Authenticity
```

Future versions of LanDrop may introduce trusted-device pairing and cryptographic authentication to provide stronger guarantees.

---

# 📄 License

License information will be added when the project's licensing decision is finalized.

---

# 🚀 Vision

LanDrop aims to become a clean, secure, and modern solution for transferring Android applications across trusted local networks.

The long-term vision is to provide a professional experience where:

```text
Select Device
      ↓
Select Application
      ↓
Review
      ↓
Send
      ↓
User Approves
      ↓
Secure Transfer
      ↓
Integrity Verification
      ↓
Android Installation
```

**Simple. Local. Transparent. Secure.**

---

## Project Identity

**LanDrop**

**LanDrop Desktop**

**LanDrop Receiver**