#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct Report {
    pub no_dumps: bool,
    pub memory_locked: bool,
    pub syscall_filter: bool,
    pub mitigations: bool,
}

#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
mod imp {
    use super::Report;
    use seccompiler::{BpfProgram, SeccompAction, SeccompFilter, TargetArch};
    use std::collections::BTreeMap;

    pub fn early(report: &mut Report) {
        let core = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        let dumps_off = unsafe { libc::setrlimit(libc::RLIMIT_CORE, &core) } == 0;
        let undumpable = unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } == 0;
        report.no_dumps = dumps_off && undumpable;
        unsafe {
            libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
        }
    }

    pub fn lock(ptr: *const u8, len: usize) -> bool {
        unsafe { libc::mlock(ptr as *const libc::c_void, len) == 0 }
    }

    const ALLOWED: &[libc::c_long] = &[
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_readv,
        libc::SYS_writev,
        libc::SYS_close,
        libc::SYS_brk,
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mremap,
        libc::SYS_madvise,
        libc::SYS_mprotect,
        libc::SYS_futex,
        libc::SYS_getrandom,
        libc::SYS_clock_gettime,
        libc::SYS_clock_nanosleep,
        libc::SYS_sched_yield,
        libc::SYS_sigaltstack,
        libc::SYS_rt_sigprocmask,
        libc::SYS_rt_sigreturn,
        libc::SYS_rt_sigaction,
        libc::SYS_exit,
        libc::SYS_exit_group,
        libc::SYS_mlock,
        libc::SYS_munlock,
        libc::SYS_getpid,
        libc::SYS_gettid,
        libc::SYS_tgkill,
        libc::SYS_rseq,
        #[cfg(target_arch = "x86_64")]
        libc::SYS_poll,
        libc::SYS_ppoll,
        libc::SYS_fstat,
        libc::SYS_statx,
        libc::SYS_newfstatat,
    ];

    pub fn lockdown(report: &mut Report) -> Result<(), String> {
        let arch = TargetArch::try_from(std::env::consts::ARCH).map_err(|e| format!("{e:?}"))?;
        #[allow(clippy::unnecessary_cast)]
        let rules: BTreeMap<i64, Vec<seccompiler::SeccompRule>> = ALLOWED.iter().map(|n| (*n as i64, vec![])).collect();
        let filter = SeccompFilter::new(rules, SeccompAction::Errno(libc::EPERM as u32), SeccompAction::Allow, arch).map_err(|e| e.to_string())?;
        let program: BpfProgram = filter.try_into().map_err(|e: seccompiler::BackendError| e.to_string())?;
        seccompiler::apply_filter(&program).map_err(|e| e.to_string())?;
        report.syscall_filter = true;
        Ok(())
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod imp {
    use super::Report;
    use windows::Win32::System::Memory::VirtualLock;
    use windows::Win32::System::SystemServices::{PROCESS_MITIGATION_DYNAMIC_CODE_POLICY, PROCESS_MITIGATION_EXTENSION_POINT_DISABLE_POLICY, PROCESS_MITIGATION_IMAGE_LOAD_POLICY};
    use windows::Win32::System::Threading::{ProcessDynamicCodePolicy, ProcessExtensionPointDisablePolicy, ProcessImageLoadPolicy, SetProcessMitigationPolicy};

    pub fn early(report: &mut Report) {
        report.no_dumps = true;
        let mut ok = true;
        unsafe {
            let mut dynamic = PROCESS_MITIGATION_DYNAMIC_CODE_POLICY::default();
            dynamic.Anonymous.Flags = 1;
            ok &= SetProcessMitigationPolicy(ProcessDynamicCodePolicy, &dynamic as *const _ as *const _, std::mem::size_of_val(&dynamic)).is_ok();
            let mut ext = PROCESS_MITIGATION_EXTENSION_POINT_DISABLE_POLICY::default();
            ext.Anonymous.Flags = 1;
            ok &= SetProcessMitigationPolicy(ProcessExtensionPointDisablePolicy, &ext as *const _ as *const _, std::mem::size_of_val(&ext)).is_ok();
            let mut image = PROCESS_MITIGATION_IMAGE_LOAD_POLICY::default();
            image.Anonymous.Flags = 0b11;
            ok &= SetProcessMitigationPolicy(ProcessImageLoadPolicy, &image as *const _ as *const _, std::mem::size_of_val(&image)).is_ok();
        }
        report.mitigations = ok;
    }

    pub fn lock(ptr: *const u8, len: usize) -> bool {
        unsafe { VirtualLock(ptr as *const _, len).is_ok() }
    }

    pub fn lockdown(_report: &mut Report) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::Report;
    pub fn early(_report: &mut Report) {}
    pub fn lock(_ptr: *const u8, _len: usize) -> bool {
        false
    }
    pub fn lockdown(_report: &mut Report) -> Result<(), String> {
        Ok(())
    }
}

pub fn early(report: &mut Report) {
    imp::early(report)
}

pub fn lock_memory(ptr: *const u8, len: usize) -> bool {
    imp::lock(ptr, len)
}

pub fn lockdown(report: &mut Report) -> Result<(), String> {
    imp::lockdown(report)
}
