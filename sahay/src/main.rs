#![cfg_attr(windows, windows_subsystem = "windows")]
#![cfg_attr(not(windows), allow(dead_code))]

mod actions;
mod agent;
mod config;
mod mover;
mod retry;
mod saathi;
#[cfg(windows)]
mod win;

#[cfg(windows)]
fn main() {
    win::run();
}

#[cfg(not(windows))]
fn main() {
    let _ = (agent::tools(), mover::parse_point("@1,1"), retry::Rotation::new(1, 1, 1), config::Config::default(), actions::vk("enter"), saathi::TOOLS);
    eprintln!("Sahay drives a Windows PC. Build it for Windows: cargo build --release -p sahay --target x86_64-pc-windows-msvc");
    std::process::exit(64);
}
