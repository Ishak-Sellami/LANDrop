package com.landrop.receiver.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Explicit field mapping: no reflection, Android classes, or serialization plugin.
object ProtocolJson {
    // Strict defaults also reject trailing commas; no experimental options needed.
    private val json = Json { isLenient = false }

    private inline fun <T> safely(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (problem: ProtocolProblem) {
        Result.failure(problem)
    } catch (_: SerializationException) {
        Result.failure(ProtocolProblem(ErrorCode.INVALID_REQUEST, "json"))
    } catch (_: IllegalArgumentException) {
        Result.failure(ProtocolProblem(ErrorCode.INVALID_REQUEST, "json"))
    }

    fun decode(input: String, limits: Limits = Limits()): Result<ControlMessage> = safely {
        checkInput(input, limits)
        // Like Rust's object-tree decoder, duplicate keys resolve to the last
        // value. Exact field sets and primitive types are checked below.
        val root = json.parseToJsonElement(input).objectValue()
        val message = when (root.string("type")) {
            "delivery_request" -> request(root)
            "delivery_response" -> {
                root.fields("type", "request_id", "decision")
                DeliveryResponse(RequestId(root.string("request_id")), Decision.valueOf(root.string("decision")))
            }
            "error" -> {
                root.fields("type", "request_id", "code", "message")
                ErrorMessage(RequestId(root.string("request_id")), ErrorCode.valueOf(root.string("code")), root.string("message"))
            }
            "transfer_progress" -> {
                root.fields("type", "transfer_id", "bytes_transferred", "total_bytes")
                TransferProgress(
                    TransferId(root.string("transfer_id")),
                    root.integer("bytes_transferred"),
                    root.integer("total_bytes"),
                )
            }
            "transfer_cancel" -> {
                root.fields("type", "transfer_id")
                TransferCancel(TransferId(root.string("transfer_id")))
            }
            else -> invalid("json")
        }
        message.validate(limits)
        message
    }

    private fun request(root: JsonObject): DeliveryRequest {
        root.fields("type", "protocol_version", "request_id", "session_id", "presentation", "sender", "application")
        val version = root.integer("protocol_version")
        if (version !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) invalid("json")
        val presentation = root.child("presentation").also { it.fields("mode") }
        val sender = root.child("sender").also { it.fields("display_name") }
        val app = root.child("application").also {
            it.fields("name", "version", "description", "package_name", "size_bytes", "sha256")
        }
        return DeliveryRequest(
            ProtocolVersion(version.toInt()), RequestId(root.string("request_id")), SessionId(root.string("session_id")),
            Presentation(PresentationMode.valueOf(presentation.string("mode"))),
            SenderProfile(sender.string("display_name")),
            ApplicationMetadata(
                ApkIdentity(app.string("package_name"), app.integer("size_bytes"), Sha256(app.string("sha256"))),
                ApplicationPresentation(app.string("name"), app.string("version"), app.string("description")),
            ),
        )
    }

    fun encode(message: ControlMessage, limits: Limits = Limits()): Result<String> = safely {
        message.validate(limits)
        val root = buildJsonObject {
            when (message) {
                is DeliveryRequest -> {
                    put("type", "delivery_request")
                    put("protocol_version", message.protocolVersion.value)
                    put("request_id", message.requestId.value)
                    put("session_id", message.sessionId.value)
                    put("presentation", buildJsonObject { put("mode", message.presentation.mode.name) })
                    put("sender", buildJsonObject { put("display_name", message.sender.displayName) })
                    put("application", buildJsonObject {
                        put("name", message.application.presentation.name)
                        put("version", message.application.presentation.version)
                        put("description", message.application.presentation.description)
                        put("package_name", message.application.identity.packageName)
                        put("size_bytes", message.application.identity.sizeBytes)
                        put("sha256", message.application.identity.sha256.value)
                    })
                }
                is DeliveryResponse -> {
                    put("type", "delivery_response")
                    put("request_id", message.requestId.value)
                    put("decision", message.decision.name)
                }
                is ErrorMessage -> {
                    put("type", "error")
                    put("request_id", message.requestId.value)
                    put("code", message.code.name)
                    put("message", message.message)
                }
                is TransferProgress -> {
                    put("type", "transfer_progress")
                    put("transfer_id", message.transferId.value)
                    put("bytes_transferred", message.bytesTransferred)
                    put("total_bytes", message.totalBytes)
                }
                is TransferCancel -> {
                    put("type", "transfer_cancel")
                    put("transfer_id", message.transferId.value)
                }
            }
        }
        root.toString().also { checkInput(it, limits) }
    }
}
