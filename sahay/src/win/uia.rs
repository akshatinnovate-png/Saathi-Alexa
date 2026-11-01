use crate::actions::{Element, Rect};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_BoundingRectanglePropertyId, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId, UIA_NamePropertyId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

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

    pub fn snapshot(&self, screen: Rect, limit: usize) -> Result<(String, Vec<Element>), String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            let title = crate::win::system::window_title(hwnd);
            let root = self.automation.ElementFromHandle(hwnd).map_err(|e| format!("The window in front cannot be read: {e}"))?;
            let cache = self.automation.CreateCacheRequest().map_err(|e| e.to_string())?;
            for p in [UIA_NamePropertyId, UIA_ControlTypePropertyId, UIA_BoundingRectanglePropertyId, UIA_IsEnabledPropertyId, UIA_IsOffscreenPropertyId] {
                cache.AddProperty(p).map_err(|e| e.to_string())?;
            }
            let condition = self.automation.ControlViewCondition().map_err(|e| e.to_string())?;
            let all = root.FindAllBuildCache(TreeScope_Descendants, &condition, &cache).map_err(|e| format!("The window's contents could not be listed: {e}"))?;
            let count = all.Length().unwrap_or(0).max(0) as usize;
            let mut out: Vec<Element> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for i in 0..count {
                if out.len() >= limit {
                    break;
                }
                let Ok(el) = all.GetElement(i as i32) else { continue };
                if el.CachedIsOffscreen().map(|b| b.as_bool()).unwrap_or(false) {
                    continue;
                }
                let Ok(r) = el.CachedBoundingRectangle() else { continue };
                let rect = Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
                if rect.right - rect.left < 3 || rect.bottom - rect.top < 3 {
                    continue;
                }
                let (cx, cy) = rect.center();
                if cx < screen.left || cx >= screen.right || cy < screen.top || cy >= screen.bottom {
                    continue;
                }
                let name = el.CachedName().map(|b| b.to_string()).unwrap_or_default();
                let k = kind(el.CachedControlType().map(|c| c.0).unwrap_or(0));
                if !interesting(k, !name.trim().is_empty()) {
                    continue;
                }
                if !seen.insert((k, name.clone(), rect.left / 4, rect.top / 4)) {
                    continue;
                }
                let enabled = el.CachedIsEnabled().map(|b| b.as_bool()).unwrap_or(true);
                out.push(Element { id: out.len() + 1, kind: k.to_string(), name, value: String::new(), rect, enabled });
            }
            Ok((title, out))
        }
    }
}
