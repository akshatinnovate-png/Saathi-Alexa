use alloc::vec::Vec;

#[no_mangle]
pub extern "C" fn saathi_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn saathi_free(ptr: *mut u8, cap: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, cap.max(1)) });
}

#[no_mangle]
pub unsafe extern "C" fn saathi_call(ptr: *const u8, len: usize) -> u64 {
    let input = unsafe { core::slice::from_raw_parts(ptr, len) };
    let text = core::str::from_utf8(input).unwrap_or("");
    let mut out = crate::ffi::call(text).into_bytes();
    out.shrink_to_fit();
    let (p, l) = (out.as_mut_ptr() as u64, out.len() as u64);
    core::mem::forget(out);
    (p << 32) | l
}
