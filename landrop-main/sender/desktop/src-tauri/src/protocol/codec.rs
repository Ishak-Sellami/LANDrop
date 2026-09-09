use super::{ControlMessage, Limits, ProtocolProblem, Validate};

// Bound nesting before parsing. This scan does not parse JSON; serde_json does.
fn check_input(input: &str, limits: &Limits) -> Result<(), ProtocolProblem> {
    if input.len() > limits.max_json_bytes { return Err(ProtocolProblem::invalid("json.size")); }
    let (mut depth, mut quoted, mut escaped) = (0i32, false, false);
    for c in input.chars() {
        if quoted {
            if escaped { escaped = false; }
            else if c == '\\' { escaped = true; }
            else if c == '"' { quoted = false; }
        } else {
            match c {
                '"' => quoted = true,
                '{' | '[' => { depth += 1; if depth > 16 { return Err(ProtocolProblem::invalid("json.depth")); } }
                '}' | ']' => depth -= 1,
                _ => {},
            }
        }
    }
    Ok(())
}

// Serde structs/enums can also accept sequence/externally-tagged forms.
// Protocol v1 requires objects for records and strings for enum fields.
fn check_wire_shape(value: &serde_json::Value) -> Result<(), ProtocolProblem> {
    let root = value.as_object().ok_or_else(|| ProtocolProblem::invalid("json"))?;
    let kind = root.get("type").and_then(|v| v.as_str());
    match kind {
        Some("delivery_request") => {
            for key in ["application", "sender", "presentation"] {
                if !root.get(key).is_some_and(|v| v.is_object()) {
                    return Err(ProtocolProblem::invalid("json"));
                }
            }
            match value.pointer("/presentation/mode") {
                Some(v) if v.is_string() => Ok(()),
                _ => Err(ProtocolProblem::invalid("json")),
            }
        }
        Some("delivery_response") => match root.get("decision") {
            Some(v) if v.is_string() => Ok(()),
            _ => Err(ProtocolProblem::invalid("json")),
        },
        Some("error") => match root.get("code") {
            Some(v) if v.is_string() => Ok(()),
            _ => Err(ProtocolProblem::invalid("json")),
        },
        Some("transfer_progress") => {
            if root.get("transfer_id").is_some_and(|v| v.is_string())
                && root.get("bytes_transferred").is_some_and(|v| v.is_i64() || v.is_u64())
                && root.get("total_bytes").is_some_and(|v| v.is_i64() || v.is_u64())
            {
                Ok(())
            } else {
                Err(ProtocolProblem::invalid("json"))
            }
        }
        Some("transfer_cancel") => {
            if root.get("transfer_id").is_some_and(|v| v.is_string()) {
                Ok(())
            } else {
                Err(ProtocolProblem::invalid("json"))
            }
        }
        _ => Err(ProtocolProblem::invalid("json")),
    }
}

/// Validated codec entry point; raw serde decoding alone does not apply limits.
pub fn decode_message(input: &str, limits: &Limits) -> Result<ControlMessage, ProtocolProblem> {
    check_input(input, limits)?;
    // Both codecs parse an object tree first. Duplicate object keys resolve to
    // the last value; unknown fields and wrong primitive types are rejected.
    let value: serde_json::Value = serde_json::from_str(input).map_err(|_| ProtocolProblem::invalid("json"))?;
    check_wire_shape(&value)?;
    let message: ControlMessage = serde_json::from_value(value).map_err(|_| ProtocolProblem::invalid("json"))?;
    message.validate(limits)?;
    Ok(message)
}
pub fn encode_message(message: &ControlMessage, limits: &Limits) -> Result<String, ProtocolProblem> {
    message.validate(limits)?;
    let json = serde_json::to_string(message).map_err(|_| ProtocolProblem::invalid("json"))?;
    check_input(&json, limits)?;
    Ok(json)
}
