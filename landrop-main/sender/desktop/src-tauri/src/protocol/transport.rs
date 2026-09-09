// Transport abstraction (architecture §29 / §30) — foundation only.
// Prevents UI/control code from assuming any concrete networking stack
// (direct TCP/TLS is deferred; see repo §41 Dependency Boundaries).
// The in-memory duplex pair is a deterministic TEST SEAM, not a product
// transport choice. No sockets, TLS, or mDNS here.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportErrorKind {
    ConnectionLost,
    Timeout,
    IoError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportFailure {
    pub kind: TransportErrorKind,
    pub message: String,
}

fn io_error(message: &str) -> TransportFailure {
    TransportFailure { kind: TransportErrorKind::IoError, message: message.to_string() }
}

// Read yields buffered bytes (Data), the peer's end of stream once drained
// (End), or no data right now without implying EOF (Empty).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportRead {
    Data(Vec<u8>),
    Empty,
    End,
    Error(TransportFailure),
}

pub trait Transport {
    fn connect(&mut self) -> Result<(), TransportFailure>;
    fn read(&mut self, max_bytes: usize) -> TransportRead;
    fn write(&mut self, bytes: &[u8]) -> Result<(), TransportFailure>;
    fn close(&mut self);
    /// True once close() has been called on this side.
    fn is_closed(&self) -> bool;
}

#[derive(Default)]
struct Shared {
    data: Vec<u8>,
    /// True once the peer that feeds this buffer has closed its side.
    peer_closed: bool,
}

pub struct InMemoryTransport {
    incoming: Rc<RefCell<Shared>>,
    outgoing: Rc<RefCell<Shared>>,
    closed: Cell<bool>,
}

impl InMemoryTransport {
    fn new(incoming: Rc<RefCell<Shared>>, outgoing: Rc<RefCell<Shared>>) -> Self {
        Self { incoming, outgoing, closed: Cell::new(false) }
    }
}

impl Transport for InMemoryTransport {
    fn connect(&mut self) -> Result<(), TransportFailure> {
        if self.closed.get() { Err(io_error("connect on closed transport")) } else { Ok(()) }
    }

    fn read(&mut self, max_bytes: usize) -> TransportRead {
        if self.closed.get() {
            return TransportRead::Error(io_error("read on closed transport"));
        }
        if max_bytes == 0 {
            return TransportRead::Error(io_error("read requires max_bytes > 0"));
        }
        let mut incoming = self.incoming.borrow_mut();
        if !incoming.data.is_empty() {
            let take = max_bytes.min(incoming.data.len());
            let out: Vec<u8> = incoming.data.drain(..take).collect();
            TransportRead::Data(out)
        } else if incoming.peer_closed {
            TransportRead::End
        } else {
            TransportRead::Empty
        }
    }

    fn write(&mut self, bytes: &[u8]) -> Result<(), TransportFailure> {
        if self.closed.get() {
            return Err(io_error("write on closed transport"));
        }
        self.outgoing.borrow_mut().data.extend_from_slice(bytes);
        Ok(())
    }

    fn close(&mut self) {
        if self.closed.get() {
            return;
        }
        self.closed.set(true);
        self.outgoing.borrow_mut().peer_closed = true;
    }

    fn is_closed(&self) -> bool {
        self.closed.get()
    }
}

// Deterministic in-memory pipe for tests and offline integration. left writes
// into the buffer right reads and vice versa; closing one end surfaces as
// End on the other once its buffer drains.
pub fn create_in_memory_duplex() -> (InMemoryTransport, InMemoryTransport) {
    let to_left = Rc::new(RefCell::new(Shared::default()));
    let to_right = Rc::new(RefCell::new(Shared::default()));
    let left = InMemoryTransport::new(to_left.clone(), to_right.clone());
    let right = InMemoryTransport::new(to_right, to_left);
    (left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Vec<u8> {
        s.as_bytes().to_vec()
    }

    fn data(read: TransportRead) -> Vec<u8> {
        match read {
            TransportRead::Data(bytes) => bytes,
            other => panic!("expected Data, found {:?}", other),
        }
    }

    #[test]
    fn delivers_writes_to_the_peer_in_order() {
        let (mut left, mut right) = create_in_memory_duplex();
        assert_eq!(left.connect(), Ok(()));
        assert_eq!(right.connect(), Ok(()));

        left.write(&text("aa")).unwrap();
        left.write(&text("bb")).unwrap();

        assert_eq!(String::from_utf8(data(right.read(16))).unwrap(), "aabb");
        assert_eq!(right.read(16), TransportRead::Empty);
    }

    #[test]
    fn empty_while_open_and_end_after_peer_closes() {
        let (mut left, mut right) = create_in_memory_duplex();
        assert_eq!(right.read(4), TransportRead::Empty);
        left.close();
        assert!(left.write(&text("x")).is_err());
        assert_eq!(right.read(4), TransportRead::End);
    }

    #[test]
    fn drains_buffered_data_before_reporting_end() {
        let (mut left, mut right) = create_in_memory_duplex();
        left.write(&text("payload")).unwrap();
        left.close();
        assert_eq!(String::from_utf8(data(right.read(64))).unwrap(), "payload");
        assert_eq!(right.read(64), TransportRead::End);
    }

    #[test]
    fn respects_max_bytes_and_preserves_bytes_across_reads() {
        let (mut left, mut right) = create_in_memory_duplex();
        left.write(&text("0123456789")).unwrap();
        assert_eq!(String::from_utf8(data(right.read(4))).unwrap(), "0123");
        assert_eq!(String::from_utf8(data(right.read(64))).unwrap(), "456789");
    }

    #[test]
    fn copies_writes_so_the_caller_may_reuse_its_buffer() {
        let (mut left, mut right) = create_in_memory_duplex();
        let mut buf = text("abc");
        left.write(&buf).unwrap();
        buf[0] = b'X'; // must not affect the transported copy
        assert_eq!(String::from_utf8(data(right.read(3))).unwrap(), "abc");
    }

    #[test]
    fn io_errors_against_the_closed_local_end() {
        let (mut left, mut right) = create_in_memory_duplex();
        left.write(&text("x")).unwrap();
        left.close();
        assert!(matches!(left.read(4), TransportRead::Error(_)));
        assert!(matches!(left.write(&text("y")), Err(_)));
        assert!(left.connect().is_err());
        assert!(left.is_closed());
        // The peer still sees data, then end.
        assert_eq!(String::from_utf8(data(right.read(4))).unwrap(), "x");
        assert_eq!(right.read(4), TransportRead::End);
    }

    #[test]
    fn rejects_a_zero_max_bytes() {
        let (mut left, _) = create_in_memory_duplex();
        assert!(matches!(left.read(0), TransportRead::Error(_)));
    }

    #[test]
    fn close_is_idempotent() {
        let (mut left, mut right) = create_in_memory_duplex();
        left.close();
        left.close();
        assert!(left.is_closed());
        right.close();
        right.close();
        // Reading on a locally-closed transport is an error, not EOF.
        assert!(matches!(right.read(1), TransportRead::Error(_)));
    }
}