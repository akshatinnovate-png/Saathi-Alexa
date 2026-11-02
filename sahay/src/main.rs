#![cfg_attr(windows, windows_subsystem = "windows")]
#![cfg_attr(not(windows), allow(dead_code))]

mod actions;
mod agent;
mod config;
mod guides;
mod intent;
mod knowledge;
mod mover;
mod plan;
mod retry;
mod saathi;
mod web;
#[cfg(windows)]
mod win;

#[cfg(windows)]
fn main() {
    win::run();
}

#[cfg(not(windows))]
fn main() {
    let _ = (knowledge::parse_dataset(""), knowledge::template_plan(&[], ""), knowledge::as_hints(&[]), knowledge::similar(&[], "", 1), knowledge::to_line(&knowledge::Example { task: String::new(), steps: Vec::new(), say: String::new() }), guides::notes("", &[]), web::page_text("", 1), web::split_url("a.b"), web::summarise(&web::bing(""), 1), web::duckduckgo(""), intent::route("open youtube"), intent::first_video_id(""), plan::parse("wait 1"), agent::tools(), mover::resolve("x", &[]), retry::Fleet::new(1, Vec::new()), config::Config::default(), actions::vk("enter"), saathi::TOOLS);
    eprintln!("Sahay drives a Windows PC. Build it for Windows: cargo build --release -p sahay --target x86_64-pc-windows-msvc");
    std::process::exit(64);
}
