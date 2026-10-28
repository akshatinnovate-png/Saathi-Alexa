#![deny(unsafe_code)]

extern crate alloc;

pub mod chain;
pub mod ffi;
pub mod policy;
pub mod session;

#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
mod wasm;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
