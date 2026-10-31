#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        let out = saathi_core::ffi::call(text);
        assert!(serde_json_check(&out));
    }
});

fn serde_json_check(out: &str) -> bool {
    out.starts_with('{') && out.ends_with('}')
}
