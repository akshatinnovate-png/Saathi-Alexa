use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    waveInAddBuffer, waveInClose, waveInOpen, waveInPrepareHeader, waveInReset, waveInStart, waveInUnprepareHeader, waveOutClose, waveOutOpen, waveOutPrepareHeader, waveOutReset,
    waveOutUnprepareHeader, waveOutWrite, CALLBACK_EVENT, HWAVEIN, HWAVEOUT, WAVEFORMATEX, WAVEHDR, WAVE_FORMAT_PCM, WAVE_MAPPER,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

const WHDR_DONE: u32 = 0x1;

fn format(rate: u32) -> WAVEFORMATEX {
    WAVEFORMATEX { wFormatTag: WAVE_FORMAT_PCM as u16, nChannels: 1, nSamplesPerSec: rate, nAvgBytesPerSec: rate * 2, nBlockAlign: 2, wBitsPerSample: 16, cbSize: 0 }
}

pub enum Play {
    Pcm(Vec<u8>),
    Clear,
}

pub struct Levels {
    pub playing: AtomicBool,
    pub play_level: AtomicU32,
}

pub fn microphone(on_chunk: impl Fn(Vec<i16>) + Send + 'static, running: Arc<AtomicBool>) -> Result<(), String> {
    unsafe {
        let event: HANDLE = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
        let mut hwi = HWAVEIN::default();
        let fmt = format(16_000);
        let r = waveInOpen(Some(&mut hwi), WAVE_MAPPER, &fmt, event.0 as usize, 0, CALLBACK_EVENT);
        if r != 0 {
            let _ = CloseHandle(event);
            return Err(format!("The microphone could not be opened (code {r}). Check Settings > Privacy > Microphone > Let desktop apps access your microphone."));
        }
        const SAMPLES: usize = 640;
        let mut buffers: Vec<Box<[i16; SAMPLES]>> = (0..6).map(|_| Box::new([0i16; SAMPLES])).collect();
        let mut headers: Vec<Box<WAVEHDR>> = Vec::new();
        for b in buffers.iter_mut() {
            let mut h = Box::new(WAVEHDR { lpData: windows::core::PSTR(b.as_mut_ptr() as *mut u8), dwBufferLength: (SAMPLES * 2) as u32, ..Default::default() });
            waveInPrepareHeader(hwi, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
            waveInAddBuffer(hwi, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
            headers.push(h);
        }
        waveInStart(hwi);
        while running.load(Ordering::Relaxed) {
            WaitForSingleObject(event, 200);
            for (i, h) in headers.iter_mut().enumerate() {
                if h.dwFlags & WHDR_DONE != 0 {
                    let n = (h.dwBytesRecorded as usize / 2).min(SAMPLES);
                    if n > 0 {
                        on_chunk(buffers[i][..n].to_vec());
                    }
                    h.dwFlags &= !WHDR_DONE;
                    h.dwBytesRecorded = 0;
                    waveInAddBuffer(hwi, &mut **h, std::mem::size_of::<WAVEHDR>() as u32);
                }
            }
        }
        waveInReset(hwi);
        for h in headers.iter_mut() {
            waveInUnprepareHeader(hwi, &mut **h, std::mem::size_of::<WAVEHDR>() as u32);
        }
        waveInClose(hwi);
        let _ = CloseHandle(event);
        Ok(())
    }
}

pub fn speaker(rx: Receiver<Play>, levels: Arc<Levels>, running: Arc<AtomicBool>) -> Result<(), String> {
    unsafe {
        let event: HANDLE = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
        let mut hwo = HWAVEOUT::default();
        let fmt = format(24_000);
        let r = waveOutOpen(Some(&mut hwo), WAVE_MAPPER, &fmt, event.0 as usize, 0, CALLBACK_EVENT);
        if r != 0 {
            let _ = CloseHandle(event);
            return Err(format!("The speakers could not be opened (code {r})."));
        }
        let mut queue: VecDeque<(Box<WAVEHDR>, Vec<u8>)> = VecDeque::new();
        let reap = |queue: &mut VecDeque<(Box<WAVEHDR>, Vec<u8>)>| {
            while let Some((h, _)) = queue.front() {
                if h.dwFlags & WHDR_DONE == 0 {
                    break;
                }
                if let Some((mut h, _data)) = queue.pop_front() {
                    waveOutUnprepareHeader(hwo, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
                }
            }
        };
        while running.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(30)) {
                Ok(Play::Pcm(mut data)) => {
                    if data.len() % 2 == 1 {
                        data.pop();
                    }
                    if data.is_empty() {
                        continue;
                    }
                    let samples: Vec<i16> = data.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
                    levels.play_level.store(crate::actions::wav_rms(&samples) as u32, Ordering::Relaxed);
                    let mut h = Box::new(WAVEHDR { lpData: windows::core::PSTR(data.as_mut_ptr()), dwBufferLength: data.len() as u32, ..Default::default() });
                    waveOutPrepareHeader(hwo, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
                    waveOutWrite(hwo, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
                    queue.push_back((h, data));
                }
                Ok(Play::Clear) => {
                    waveOutReset(hwo);
                    for (mut h, _d) in queue.drain(..) {
                        waveOutUnprepareHeader(hwo, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            reap(&mut queue);
            levels.playing.store(!queue.is_empty(), Ordering::Relaxed);
            if queue.is_empty() {
                levels.play_level.store(0, Ordering::Relaxed);
            }
        }
        waveOutReset(hwo);
        for (mut h, _d) in queue.drain(..) {
            waveOutUnprepareHeader(hwo, &mut *h, std::mem::size_of::<WAVEHDR>() as u32);
        }
        waveOutClose(hwo);
        let _ = CloseHandle(event);
        Ok(())
    }
}
