package com.landrop.receiver.protocol

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal fun JsonElement.objectValue(): JsonObject = this as? JsonObject ?: invalid("json")
internal fun JsonObject.fields(vararg names: String) {
    if (keys != names.toSet()) invalid("json")
}
internal fun JsonObject.string(name: String): String {
    val p = this[name] as? JsonPrimitive ?: invalid("json")
    if (!p.isString || !wellFormedUnicode(p.content)) invalid("json")
    return p.content
}
internal fun JsonObject.integer(name: String): Long {
    val p = this[name] as? JsonPrimitive ?: invalid("json")
    // serde_json represents -0 as a floating-point number, not an integer.
    if (p.isString || p.content == "-0" || !Regex("-?(0|[1-9][0-9]*)").matches(p.content)) invalid("json")
    return p.content.toLongOrNull() ?: invalid("json")
}
internal fun JsonObject.child(name: String): JsonObject = this[name]?.objectValue() ?: invalid("json")

// Bound nesting before parsing; kotlinx.serialization remains the JSON parser.
internal fun checkInput(input: String, limits: Limits) {
    if (!wellFormedUnicode(input)) invalid("json")
    if (input.toByteArray(Charsets.UTF_8).size > limits.maxJsonBytes) invalid("json.size")
    var depth = 0
    var quoted = false
    var escaped = false
    for (c in input) {
        if (quoted) {
            if (c.code < 0x20) invalid("json")
            if (escaped) escaped = false
            else if (c == '\\') escaped = true
            else if (c == '"') quoted = false
        } else {
            when (c) {
                '"' -> quoted = true
                '{', '[' -> { depth++; if (depth > 16) invalid("json.depth") }
                '}', ']' -> depth--
            }
        }
    }
}
