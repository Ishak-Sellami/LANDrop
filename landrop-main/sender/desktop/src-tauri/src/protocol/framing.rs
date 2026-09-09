// Wire framing — 4-byte big-endian length prefix + JSON payload.
// The protocol spec does not define a frame structure (SPECIFICATION GAP,
// resolved here and fixed in the shared fixtures). max_payload_bytes reuses
// the codec's max_json_bytes (65536) so no new magic numbers appear.
// A framing problem is a LOCAL defect (corrupt/oversized/truncated stream),
// never a wire ErrorCode.

use std::collections::VecDeque;

pub const FRAME_LENGTH_BYTES: usize = 4;
// Mirrors Limits::default().max_json_bytes.
pub const MAX_FRAME_PAYLOAD_BYTES: usize = 65536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameProblem {
    FrameTooLarge,
    Truncated,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameResult {
    Frame(Vec<u8>),
    Incomplete,
    Error(FrameProblem),
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, FrameProblem> {
    if payload.len() > MAX_FRAME_PAYLOAD_BYTES {
        return Err(FrameProblem::FrameTooLarge);
    }
    let mut out = Vec::with_capacity(FRAME_LENGTH_BYTES + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

fn read_u32_be(bytes: &[u8]) -> u32 {
    let mut value: u32 = 0;
    for byte in &bytes[..FRAME_LENGTH_BYTES] {
        value = (value << 8) | (*byte as u32);
    }
    value
}

// Incremental frame assembler. Feed the stream in any chunk split; call
// try_read_frame() repeatedly until Incomplete; call end_of_stream() once the
// peer EOFs to surface a trailing Truncated frame (message boundaries are
// length-defined, so trailing bytes always mean a broken stream).
pub struct FrameDecoder {
    chunks: VecDeque<Vec<u8>>,
    buffered: usize,
    broken: Option<FrameProblem>,
    fed: usize,
    emitted_headers: usize,
    emitted_payload: usize,
    max_payload_bytes: usize,
}

impl FrameDecoder {
    pub fn new(max_payload_bytes: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            buffered: 0,
            broken: None,
            fed: 0,
            emitted_headers: 0,
            emitted_payload: 0,
            max_payload_bytes,
        }
    }

    pub fn total_fed_bytes(&self) -> usize {
        self.fed
    }

    pub fn emitted_frame_count(&self) -> usize {
        self.emitted_headers / FRAME_LENGTH_BYTES
    }

    pub fn emitted_payload_bytes(&self) -> usize {
        self.emitted_payload
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buffered
    }

    // Conservation invariant: fed == emitted_headers + emitted_payload + buffered.
    pub fn is_balanced(&self) -> bool {
        self.fed == self.emitted_headers + self.emitted_payload + self.buffered
    }

    pub fn feed(&mut self, chunk: &[u8]) {
        if chunk.is_empty() {
            return;
        }
        self.fed += chunk.len();
        self.chunks.push_back(chunk.to_vec());
        self.buffered += chunk.len();
    }

    fn peek(&self, n: usize) -> Option<Vec<u8>> {
        if self.buffered < n {
            return None;
        }
        let mut out = vec![0u8; n];
        let mut remaining = n;
        let mut chunk_index = 0;
        while remaining > 0 {
            let chunk = self.chunks.get(chunk_index)?;
            if chunk.is_empty() {
                chunk_index += 1;
                continue;
            }
            let take = remaining.min(chunk.len());
            out[n - remaining..n - remaining + take].copy_from_slice(&chunk[..take]);
            remaining -= take;
            if take == chunk.len() {
                chunk_index += 1;
            }
        }
        Some(out)
    }

    fn consume(&mut self, n: usize) {
        let mut remaining = n;
        while remaining > 0 {
            let front = self
                .chunks
                .pop_front()
                .unwrap_or_else(|| panic!("framing consume underrun (buffered={})", self.buffered));
            if front.len() <= remaining {
                remaining -= front.len();
            } else {
                let rest = front[remaining..].to_vec();
                self.chunks.push_front(rest);
                remaining = 0;
            }
        }
        self.buffered -= n;
    }

    pub fn try_read_frame(&mut self) -> FrameResult {
        if let Some(problem) = self.broken {
            return FrameResult::Error(problem);
        }
        let header = match self.peek(FRAME_LENGTH_BYTES) {
            Some(bytes) => bytes,
            None => return FrameResult::Incomplete,
        };
        let length = read_u32_be(&header) as usize;
        if length > self.max_payload_bytes {
            self.broken = Some(FrameProblem::FrameTooLarge);
            return FrameResult::Error(FrameProblem::FrameTooLarge);
        }
        if self.buffered < FRAME_LENGTH_BYTES + length {
            return FrameResult::Incomplete;
        }
        self.consume(FRAME_LENGTH_BYTES);
        let payload = self.peek(length).unwrap_or_default();
        self.consume(length);
        self.emitted_headers += FRAME_LENGTH_BYTES;
        self.emitted_payload += length;
        FrameResult::Frame(payload)
    }

    pub fn end_of_stream(&mut self) -> Result<(), FrameProblem> {
        if let Some(problem) = self.broken {
            return Err(problem);
        }
        if self.buffered > 0 {
            return Err(FrameProblem::Truncated);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(s: &str) -> Vec<u8> {
        s.as_bytes().to_vec()
    }

    fn from_hex(hex: &str) -> Vec<u8> {
        (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect()
    }

    fn frame(text: &str) -> Vec<u8> {
        encode_frame(bytes(text)).unwrap()
    }

    fn drain(packet: Vec<u8>) -> Vec<String> {
        let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
        decoder.feed(&packet);
        let mut out = vec![];
        loop {
            match decoder.try_read_frame() {
                FrameResult::Frame(payload) => out.push(String::from_utf8(payload).unwrap()),
                FrameResult::Incomplete => break,
                FrameResult::Error(p) => panic!("unexpected framing error {:?}", p),
            }
        }
        assert_eq!(decoder.end_of_stream(), Ok(()));
        out
    }

    #[test]
    fn payloads_round_trip_through_the_fixture_set() {
        let payloads = [
            ("empty", ""),
            ("error_integrity", "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\",\"message\":\"Received file failed integrity verification.\"}"),
            ("response_accept", "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}"),
            ("request_gui", "{\"type\":\"delivery_request\",\"protocol_version\":1,\"request_id\":\"req_01JTEST\",\"session_id\":\"sess_01JTEST\",\"presentation\":{\"mode\":\"GUI\"},\"sender\":{\"display_name\":\"ISHAQ CYBERTECH\"},\"application\":{\"name\":\"My Application\",\"version\":\"1.4.2\",\"description\":\"A local test application.\",\"package_name\":\"com.example.application\",\"size_bytes\":26004608,\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}}"),
        ];
        for (name, payload) in payloads {
            let encoded = encode_frame(bytes(payload)).unwrap();
            assert_eq!(encoded.len(), FRAME_LENGTH_BYTES + payload.len(), "size for {}", name);
            let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
            decoder.feed(&encoded);
            match decoder.try_read_frame() {
                FrameResult::Frame(decoded) => {
                    assert_eq!(String::from_utf8(decoded).unwrap(), payload, "payload {}", name);
                }
                other => panic!("expected frame for {}, got {:?}", name, other),
            }
        }
    }

    #[test]
    fn zero_length_frame_is_not_a_problem() {
        let encoded = encode_frame(b"").unwrap();
        assert_eq!(hex(&encoded), "00000000");
        let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
        decoder.feed(&encoded);
        assert_eq!(decoder.try_read_frame(), FrameResult::Frame(vec![]));
        assert_eq!(decoder.end_of_stream(), Ok(()));
    }

    #[test]
    fn max_boundary_is_exact() {
        assert!(encode_frame(&vec![0u8; MAX_FRAME_PAYLOAD_BYTES]).is_ok());
        assert_eq!(
            encode_frame(&vec![0u8; MAX_FRAME_PAYLOAD_BYTES + 1]),
            Err(FrameProblem::FrameTooLarge)
        );
    }

    #[test]
    fn two_back_to_back_frames_in_one_feed() {
        let a = "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}";
        let b = "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\",\"message\":\"ok\"}";
        let mut packet = frame(a);
        packet.extend(frame(b));
        assert_eq!(drain(packet), vec![a.to_string(), b.to_string()]);
    }

    #[test]
    fn any_byte_split_still_yields_the_frame() {
        let payload = "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}";
        let whole = frame(payload);
        for k in 0..=whole.len() {
            let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
            decoder.feed(&whole[..k]);
            loop {
                match decoder.try_read_frame() {
                    FrameResult::Frame(decoded) => {
                        assert_eq!(String::from_utf8(decoded).unwrap(), payload, "split {}", k);
                    }
                    FrameResult::Incomplete => break,
                    FrameResult::Error(p) => panic!("split {} error {:?}", k, p),
                }
            }
            decoder.feed(&whole[k..]);
            loop {
                match decoder.try_read_frame() {
                    FrameResult::Frame(decoded) => {
                        assert_eq!(String::from_utf8(decoded).unwrap(), payload, "split tail {}", k);
                    }
                    FrameResult::Incomplete => break,
                    FrameResult::Error(p) => panic!("split tail {} error {:?}", k, p),
                }
            }
            assert_eq!(decoder.end_of_stream(), Ok(()), "split {}", k);
        }
    }

    #[test]
    fn trailing_input_is_truncated() {
        for hex_input in ["aabb", "00000004aa"] {
            let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
            decoder.feed(&from_hex(hex_input));
            assert_eq!(decoder.try_read_frame(), FrameResult::Incomplete, "input {}", hex_input);
            assert_eq!(decoder.end_of_stream(), Err(FrameProblem::Truncated), "input {}", hex_input);
        }
    }

    #[test]
    fn empty_input_is_not_a_problem() {
        let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
        assert_eq!(decoder.try_read_frame(), FrameResult::Incomplete);
        assert_eq!(decoder.end_of_stream(), Ok(()));
    }

    #[test]
    fn oversized_and_wild_lengths_are_frame_too_large_and_stable() {
        for hex_input in ["00020000aabb", "ffffffff"] {
            let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
            decoder.feed(&from_hex(hex_input));
            assert_eq!(
                decoder.try_read_frame(),
                FrameResult::Error(FrameProblem::FrameTooLarge),
                "input {}",
                hex_input
            );
            // Deterministic: the error repeats and later input cannot change it.
            assert_eq!(
                decoder.try_read_frame(),
                FrameResult::Error(FrameProblem::FrameTooLarge),
                "input {} repeat",
                hex_input
            );
            assert_eq!(
                decoder.end_of_stream(),
                Err(FrameProblem::FrameTooLarge),
                "input {} eof",
                hex_input
            );
        }
    }

    #[test]
    fn conserves_bytes_across_byte_by_byte_feeds() {
        let a = "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}";
        let b = "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\",\"message\":\"ok\"}";
        let mut packet = frame(a);
        packet.extend(frame(b));
        let mut decoder = FrameDecoder::new(MAX_FRAME_PAYLOAD_BYTES);
        let mut emitted = vec![];
        for byte in &packet {
            decoder.feed(&[*byte]);
            loop {
                match decoder.try_read_frame() {
                    FrameResult::Frame(payload) => emitted.push(String::from_utf8(payload).unwrap()),
                    FrameResult::Incomplete => break,
                    FrameResult::Error(p) => panic!("unexpected framing error {:?}", p),
                }
            }
        }
        assert_eq!(emitted, vec![a.to_string(), b.to_string()]);
        assert_eq!(decoder.emitted_frame_count(), 2);
        assert_eq!(decoder.emitted_payload_bytes(), a.len() + b.len());
        assert!(decoder.is_balanced());
        assert_eq!(decoder.end_of_stream(), Ok(()));
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}