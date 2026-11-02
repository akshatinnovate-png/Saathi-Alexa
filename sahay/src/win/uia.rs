use crate::actions::{Element, Rect};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationCacheRequest, IUIAutomationElement, IUIAutomationTreeWalker, UIA_BoundingRectanglePropertyId, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId, UIA_NamePropertyId,
};

pub struct Reader {
    automation: IUIAutomation,
}

fn kind(id: i32) -> &'static str {
    match id {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Link",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "Group",
        50028 => "DataGrid",
        50029 => "DataItem",
        50030 => "Document",
        50031 => "SplitButton",
        50032 => "Window",
        50033 => "Pane",
        50034 => "Header",
        50035 => "HeaderItem",
        50036 => "Table",
        50037 => "TitleBar",
        _ => "Element",
    }
}

fn interesting(kind: &str, named: bool) -> bool {
    match kind {
        "Button" | "CheckBox" | "ComboBox" | "Edit" | "Link" | "ListItem" | "MenuItem" | "RadioButton" | "Slider" | "Spinner" | "TabItem" | "TreeItem" | "DataItem" | "SplitButton" | "HeaderItem" => true,
        "Text" | "Image" | "Custom" | "Group" | "Document" | "Pane" => named,
        _ => false,
    }
}

impl Reader {
    pub fn new() -> Result<Self, String> {
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.map_err(|e| format!("UI Automation is not available: {e}"))?;
        Ok(Self { automation })
    }

    pub fn snapshot_within(&self, hwnd: windows::Win32::Foundation::HWND, screen: Rect, limit: usize, budget: std::time::Duration) -> Result<(String, Vec<Element>), String> {
        unsafe {
            let title = crate::win::system::window_title(hwnd);
            let cache = self.automation.CreateCacheRequest().map_err(|e| e.to_string())?;
            for p in [UIA_NamePropertyId, UIA_ControlTypePropertyId, UIA_BoundingRectanglePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId] {
                cache.AddProperty(p).map_err(|e| e.to_string())?;
            }
            let root = self.automation.ElementFromHandleBuildCache(hwnd, &cache).map_err(|e| format!("The window in front cannot be read: {e}"))?;
            let walker = self.automation.ControlViewWalker().map_err(|e| e.to_string())?;
            let mut walk = Walk { deadline: std::time::Instant::now() + budget, visited: 0, out: Vec::new(), seen: std::collections::HashSet::new(), screen, limit };
            walk.visit(&walker, &cache, &root, 0);
            Ok((title, walk.out))
        }
    }
}

struct Walk {
    deadline: std::time::Instant,
    visited: usize,
    out: Vec<Element>,
    seen: std::collections::HashSet<(&'static str, String, i32, i32)>,
    screen: Rect,
    limit: usize,
}

impl Walk {
    fn done(&self) -> bool {
        self.out.len() >= self.limit || self.visited > 5000 || std::time::Instant::now() > self.deadline
    }

    unsafe fn visit(&mut self, walker: &IUIAutomationTreeWalker, cache: &IUIAutomationCacheRequest, el: &IUIAutomationElement, depth: usize) {
        if self.done() || depth > 60 {
            return;
        }
        self.visited += 1;
        let offscreen = unsafe { el.CachedIsOffscreen() }.map(|b| b.as_bool()).unwrap_or(false);
        if offscreen && depth > 1 {
            return;
        }
        if depth > 0 {
            if let Ok(r) = unsafe { el.CachedBoundingRectangle() } {
                let rect = Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
                let (cx, cy) = rect.center();
                let on_screen = rect.right - rect.left >= 3 && rect.bottom - rect.top >= 3 && cx >= self.screen.left && cx < self.screen.right && cy >= self.screen.top && cy < self.screen.bottom;
                if on_screen {
                    let name = unsafe { el.CachedName() }.map(|b| b.to_string()).unwrap_or_default();
                    let k = kind(unsafe { el.CachedControlType() }.map(|c| c.0).unwrap_or(0));
                    if interesting(k, !name.trim().is_empty()) && self.seen.insert((k, name.clone(), rect.left / 4, rect.top / 4)) {
                        let enabled = unsafe { el.CachedIsEnabled() }.map(|b| b.as_bool()).unwrap_or(true);
                        self.out.push(Element { id: self.out.len() + 1, kind: k.to_string(), name, value: String::new(), rect, enabled });
                    }
                }
            }
        }
        let mut child = unsafe { walker.GetFirstChildElementBuildCache(el, cache) }.ok();
        while let Some(c) = child {
            if self.done() {
                return;
            }
            unsafe { self.visit(walker, cache, &c, depth + 1) };
            child = unsafe { walker.GetNextSiblingElementBuildCache(&c, cache) }.ok();
        }
    }
}
