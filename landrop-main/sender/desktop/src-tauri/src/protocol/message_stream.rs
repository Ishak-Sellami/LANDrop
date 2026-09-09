// Message boundary: transport bytes -> frames -> codec -> protocol messages.
// This is where the abstract Transport meets the Phase 02 codec. It is
// transport-agnostic: callers feed bytes (e.g. from Transport::read) and read
// complete ControlMessages out the other side.

use super::framing::{encode_frame, FrameDecoder, FrameProblem, FrameResult, MAX_FRAME_PAYLOAD_BYTES};
use super::{decode_message, encode_message, ControlMessage, ErrorCode, Limits, ProtocolProblem};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonMessageResult {
    Message(ControlMessage),
    Incomplete,
    FrameError(FrameProblem),
    ProtocolError(ProtocolProblem),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageEncodeError {
    Protocol(ProtocolProblem),
    Frame(FrameProblem),
}

pub struct JsonMessageStream {
    decoder: FrameDecoder,
    limits: Limits,
}

impl JsonMessageStream {
    pub fn new(limits: Limits, max_frame_payload_bytes: usize) -> Self {
        Self { decoder: FrameDecoder::new(max_frame_payload_bytes), limits }
    }

    pub fn feed(&mut self, chunk: &[u8]) {
        self.decoder.feed(chunk);
    }

    pub fn read_message(&mut self) -> JsonMessageResult {
        match self.decoder.try_read_frame() {
            FrameResult::Incomplete => JsonMessageResult::Incomplete,
            FrameResult::Error(problem) => JsonMessageResult::FrameError(problem),
            FrameResult::Frame(payload) => {
                // Non-UTF-8 payload: normalize into the codec's malformed-JSON
                // problem rather than leaking a raw decoder error.
                let text = match std::str::from_utf8(&payload) {
                    Ok(text) => text,
                    Err(_) => {
                        return JsonMessageResult::ProtocolError(ProtocolProblem {
                            code: ErrorCode::InvalidRequest,
                            field: "json",
                        });
                    }
                };
                match decode_message(text, &self.limits) {
                    Ok(message) => JsonMessageResult::Message(message),
                    Err(problem) => JsonMessageResult::ProtocolError(problem),
                }
            }
        }
    }

    pub fn end_of_stream(&mut self) -> Result<(), FrameProblem> {
        self.decoder.end_of_stream()
    }

    pub fn buffered_bytes(&self) -> usize {
        self.decoder.buffered_bytes()
    }

    pub fn is_balanced(&self) -> bool {
        self.decoder.is_balanced()
    }
}

impl Default for JsonMessageStream {
    fn default() -> Self {
        Self::new(Limits::default(), MAX_FRAME_PAYLOAD_BYTES)
    }
}

// Encode a typed message into a single wire frame (JSON payload). The codec
// already bounds the JSON at max_json_bytes, which equals the frame payload
// limit, so a validated message always fits one frame.
pub fn encode_json_frame(message: &ControlMessage, limits: &Limits) -> Result<Vec<u8>, MessageEncodeError> {
    let json = encode_message(message, limits).map_err(MessageEncodeError::Protocol)?;
    encode_frame(json.as_bytes()).map_err(MessageEncodeError::Frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        ApplicationMetadata, ControlMessage, DeliveryRequest, ErrorCode, Presentation,
        PresentationMode, ProtocolVersion, RequestId, SessionId, Sha256, SenderProfile,
    };

    fn frame(text: &str) -> Vec<u8> {
        encode_frame(text.as_bytes()).unwrap()
    }

    #[test]
    fn decodes_shared_payloads_to_typed_messages() {
        let error_json = "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\",\"message\":\"Received file failed integrity verification.\"}";
        let mut stream = JsonMessageStream::default();
        stream.feed(&frame(error_json));
        match stream.read_message() {
            JsonMessageResult::Message(ControlMessage::Error(err)) => {
                assert_eq!(err.code, ErrorCode::IntegrityMismatch);
            }
            other => panic!("expected error message, got {:?}", other),
        }

        let accept_json = "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}";
        let mut stream = JsonMessageStream::default();
        stream.feed(&frame(accept_json));
        match stream.read_message() {
            JsonMessageResult::Message(ControlMessage::DeliveryResponse(resp)) => {
                assert_eq!(resp.decision, crate::protocol::Decision::Accept);
            }
            other => panic!("expected response, got {:?}", other),
        }

        let gui_json = "{\"type\":\"delivery_request\",\"protocol_version\":1,\"request_id\":\"req_01JTEST\",\"session_id\":\"sess_01JTEST\",\"presentation\":{\"mode\":\"GUI\"},\"sender\":{\"display_name\":\"ISHAQ CYBERTECH\"},\"application\":{\"name\":\"My Application\",\"version\":\"1.4.2\",\"description\":\"A local test application.\",\"package_name\":\"com.example.application\",\"size_bytes\":26004608,\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}}";
        let mut stream = JsonMessageStream::default();
        stream.feed(&frame(gui_json));
        match stream.read_message() {
            JsonMessageResult::Message(ControlMessage::DeliveryRequest(req)) => {
                assert_eq!(req.presentation.mode, PresentationMode::Gui);
                assert_eq!(req.application.identity.package_name, "com.example.application");
            }
            other => panic!("expected request, got {:?}", other),
        }
    }

    #[test]
    fn byte_by_byte_packet_emits_messages_in_order() {
        let a = "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\",\"message\":\"Received file failed integrity verification.\"}";
        let b = "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}";
        let mut packet = frame(a);
        packet.extend(frame(b));
        let mut stream = JsonMessageStream::default();
        for byte in &packet {
            stream.feed(&[*byte]);
        }
        let mut kinds = vec![];
        loop {
            match stream.read_message() {
                JsonMessageResult::Message(ControlMessage::Error(_)) => kinds.push("error"),
                JsonMessageResult::Message(ControlMessage::DeliveryResponse(_)) => kinds.push("response"),
                JsonMessageResult::Message(ControlMessage::DeliveryRequest(_)) => kinds.push("request"),
                JsonMessageResult::Incomplete => break,
                JsonMessageResult::FrameError(p) => panic!("unexpected frame error {:?}", p),
                JsonMessageResult::ProtocolError(p) => panic!("unexpected protocol error {:?}", p),
            }
        }
        assert_eq!(kinds, vec!["error", "response"]);
        assert_eq!(stream.end_of_stream(), Ok(()));
    }

    #[test]
    fn partial_final_header_is_incomplete_then_truncated() {
        let mut stream = JsonMessageStream::default();
        stream.feed(&frame("{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}"));
        assert!(matches!(stream.read_message(), JsonMessageResult::Message(_)));
        stream.feed(&[0x00, 0x00, 0x00]);
        assert_eq!(stream.read_message(), JsonMessageResult::Incomplete);
        assert_eq!(stream.end_of_stream(), Err(FrameProblem::Truncated));
    }

    #[test]
    fn oversized_length_is_frame_error() {
        let mut stream = JsonMessageStream::default();
        stream.feed(&[0x00, 0x02, 0x00, 0x00]);
        stream.feed(&[0xaa, 0xbb]);
        assert_eq!(
            stream.read_message(),
            JsonMessageResult::FrameError(FrameProblem::FrameTooLarge)
        );
    }

    #[test]
    fn empty_payload_maps_to_invalid_request() {
        let mut stream = JsonMessageStream::default();
        stream.feed(&[0x00, 0x00, 0x00, 0x00]);
        match stream.read_message() {
            JsonMessageResult::ProtocolError(p) => {
                assert_eq!(p.code, ErrorCode::InvalidRequest);
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[test]
    fn malformed_json_maps_to_invalid_request() {
        let mut stream = JsonMessageStream::default();
        stream.feed(&frame("{"));
        match stream.read_message() {
            JsonMessageResult::ProtocolError(p) => {
                assert_eq!(p.code, ErrorCode::InvalidRequest);
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[test]
    fn invalid_utf8_maps_to_invalid_request_json() {
        let mut stream = JsonMessageStream::default();
        stream.feed(&[0x00, 0x00, 0x00, 0x02, 0x80, 0xf1]);
        match stream.read_message() {
            JsonMessageResult::ProtocolError(p) => {
                assert_eq!(p.code, ErrorCode::InvalidRequest);
                assert_eq!(p.field, "json");
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[test]
    fn encode_round_trip() {
        let request = ControlMessage::DeliveryRequest(DeliveryRequest {
            protocol_version: ProtocolVersion(1),
            request_id: RequestId::new("req_01JTEST".to_string()).unwrap(),
            session_id: SessionId::new("sess_01JTEST".to_string()).unwrap(),
            presentation: Presentation { mode: PresentationMode::Gui },
            sender: SenderProfile { display_name: "ISHAQ CYBERTECH".to_string() },
            application: ApplicationMetadata {
                identity: crate::protocol::ApkIdentity {
                    package_name: "com.example.application".to_string(),
                    size_bytes: 26004608,
                    sha256: Sha256::new("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string()).unwrap(),
                },
                presentation: crate::protocol::ApplicationPresentation {
                    name: "My Application".to_string(),
                    version: "1.4.2".to_string(),
                    description: "A local test application.".to_string(),
                },
            },
        });
        let encoded = encode_json_frame(&request, &Limits::default()).unwrap();
        let mut stream = JsonMessageStream::default();
        stream.feed(&encoded);
        assert_eq!(stream.read_message(), JsonMessageResult::Message(request));
    }

    #[test]
    fn transport_integration() {
        use crate::protocol::transport::create_in_memory_duplex;
        use crate::protocol::Transport;

        let gui_json = "{\"type\":\"delivery_request\",\"protocol_version\":1,\"request_id\":\"req_01JTEST\",\"session_id\":\"sess_01JTEST\",\"presentation\":{\"mode\":\"GUI\"},\"sender\":{\"display_name\":\"ISHAQ CYBERTECH\"},\"application\":{\"name\":\"My Application\",\"version\":\"1.4.2\",\"description\":\"A local test application.\",\"package_name\":\"com.example.application\",\"size_bytes\":26004608,\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}}";
        let packet = frame(gui_json);

        let (mut left, mut right) = create_in_memory_duplex();
        left.write(&packet).unwrap();
        left.close();

        let mut stream = JsonMessageStream::default();
        loop {
            match right.read(4 + 64) {
                crate::protocol::TransportRead::Data(bytes) => stream.feed(&bytes),
                crate::protocol::TransportRead::End => break,
                other => panic!("unexpected transport read {:?}", other),
            }
        }
        match stream.read_message() {
            JsonMessageResult::Message(ControlMessage::DeliveryRequest(req)) => {
                assert_eq!(req.sender.display_name, "ISHAQ CYBERTECH");
            }
            other => panic!("expected message, got {:?}", other),
        }
        assert_eq!(stream.end_of_stream(), Ok(()));
    }
}