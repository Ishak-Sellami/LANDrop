//! Protocol v1 data only. No UI, I/O, authentication, or state transitions.
mod codec;
mod connection;
mod delivery;
mod discovery;
mod enums;
mod framing;
mod identifiers;
mod integrity;
mod message_stream;
mod models;
mod secure_channel;
mod session;
mod session_establishment;
mod state_machine;
mod transport;
mod validation;

#[cfg(test)]
mod tests;

pub use codec::{decode_message, encode_message};
pub use connection::*;
pub use delivery::*;
pub use discovery::*;
pub use enums::*;
pub use framing::*;
pub use identifiers::*;
pub use integrity::*;
pub use message_stream::*;
pub use models::*;
pub use secure_channel::*;
pub use session::*;
pub use session_establishment::*;
pub use state_machine::*;
pub use transport::*;
pub use validation::{Limits, ProtocolProblem, Validate};
