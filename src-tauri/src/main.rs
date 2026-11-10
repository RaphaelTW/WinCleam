#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod cleanup;

fn main() {
    backend::run();
}
