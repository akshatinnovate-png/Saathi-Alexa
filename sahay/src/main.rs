#![cfg_attr(windows, windows_subsystem = "windows")]
#![cfg_attr(not(windows), allow(dead_code))]

mod actions;
mod config;
mod protocol;
mod retry;
#[cfg(windows)]
mod win;

#[cfg(windows)]
fn main() {
    win::run();
}

#[cfg(not(windows))]
fn main() {
    let _ = (protocol::instructions("you", ""), retry::Rotation::new(1, 1, 1), config::Config::default(), actions::vk("enter"));
    eprintln!("Sahay drives a Windows PC. Build it for Windows: cargo build --release -p sahay --target x86_64-pc-windows-msvc");
    std::process::exit(64);
}
