#![forbid(unsafe_code)]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Role {
    Owner,
    Member,
    Neighbour,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Principal {
    Anonymous,
    Open { household: u32 },
    Device { household: u32 },
    User { household: Option<u32>, role: Option<Role> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Household,
    Circle,
    Caregiver,
    Family,
    Owner,
    SignedIn,
}

macro_rules! actions {
    ($($variant:ident => $name:literal : $level:ident),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        #[cfg_attr(kani, derive(kani::Arbitrary))]
        pub enum Action { $($variant),+ }

        impl Action {
            pub const ALL: &'static [Action] = &[$(Action::$variant),+];

            pub fn level(self) -> Level {
                match self { $(Action::$variant => Level::$level),+ }
            }

            pub fn name(self) -> &'static str {
                match self { $(Action::$variant => $name),+ }
            }

            pub fn parse(name: &str) -> Option<Action> {
                match name { $($name => Some(Action::$variant),)+ _ => None }
            }
        }
    };
}

actions! {
    Status => "status": Household,
    Summary => "summary": Household,
    Messages => "messages.read": Household,
    SendMessage => "messages.send": Household,
    VoiceNote => "messages.voice": Household,
    AlertAck => "alerts.ack": Household,
    Door => "door.read": Household,
    HomeRead => "home.read": Household,
    Events => "events": Household,
    AlexaTurn => "alexa.turn": Household,
    Assistant => "assistant": Household,
    Speak => "speak": Household,
    RingSimulate => "ring.simulate": Household,
    VaultRead => "vault.read": Circle,
    DemoReset => "demo.reset": Caregiver,
    Refill => "care.refill": Caregiver,
    Escort => "care.escort": Caregiver,
    Letter => "letter": Caregiver,
    HomeEdit => "home.edit": Caregiver,
    PairingCode => "devices.pair": Family,
    DeviceRequests => "devices.requests": Family,
    DeviceDecide => "devices.decide": Family,
    DevicesList => "devices.list": Family,
    DeviceRemove => "devices.remove": Family,
    MailStatus => "mail.status": Family,
    MailTest => "mail.test": Family,
    CareRead => "care.read": Family,
    CareEdit => "care.edit": Family,
    InvitesList => "invites.list": Family,
    AlexaKey => "alexa.key": Family,
    VaultKeys => "vault.keys": Family,
    Avatar => "avatar": SignedIn,
    Onboarding => "onboarding": SignedIn,
    SecuritySelf => "security.self": SignedIn,
    GmailDisconnect => "mail.disconnect": Owner,
    DoorbellRead => "doorbell.read": Owner,
    DoorbellManage => "doorbell.manage": Owner,
    ProfileEdit => "profile.edit": Owner,
    MemberRemove => "members.remove": Owner,
    Invite => "members.invite": Owner,
    InviteResend => "members.resend": Owner,
    AuditLog => "audit.read": Owner,
    VaultRotate => "vault.rotate": Owner,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Deny {
    NotSignedIn,
    OtherHousehold,
    NoHousehold,
    DeviceCannot,
    NeighbourCannot,
    OwnerOnly,
    NeedsAccount,
}

impl Deny {
    pub fn status(self) -> u16 {
        match self {
            Deny::NotSignedIn | Deny::NeedsAccount | Deny::NoHousehold => 401,
            _ => 403,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Deny::NotSignedIn => "not-signed-in",
            Deny::OtherHousehold => "other-household",
            Deny::NoHousehold => "no-household",
            Deny::DeviceCannot => "device-cannot",
            Deny::NeighbourCannot => "neighbour-cannot",
            Deny::OwnerOnly => "owner-only",
            Deny::NeedsAccount => "needs-account",
        }
    }
}

pub fn decide(principal: Principal, action: Action, household: u32) -> Result<(), Deny> {
    let level = action.level();
    match principal {
        Principal::Anonymous => Err(Deny::NotSignedIn),
        Principal::Open { household: own } => {
            if own != household {
                return Err(Deny::OtherHousehold);
            }
            match level {
                Level::Household | Level::Circle | Level::Caregiver => Ok(()),
                _ => Err(Deny::NeedsAccount),
            }
        }
        Principal::Device { household: own } => {
            if own != household {
                return Err(Deny::OtherHousehold);
            }
            match level {
                Level::Household | Level::Circle => Ok(()),
                _ => Err(Deny::DeviceCannot),
            }
        }
        Principal::User { household: own, role } => {
            if level == Level::SignedIn {
                return match own {
                    Some(h) if h != household => Err(Deny::OtherHousehold),
                    _ => Ok(()),
                };
            }
            let own = own.ok_or(Deny::NoHousehold)?;
            if own != household {
                return Err(Deny::OtherHousehold);
            }
            let role = role.ok_or(Deny::NoHousehold)?;
            match (level, role) {
                (Level::Household, _) => Ok(()),
                (_, Role::Neighbour) => Err(Deny::NeighbourCannot),
                (Level::Owner, Role::Member) => Err(Deny::OwnerOnly),
                _ => Ok(()),
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Scope {
    Elder,
    Family,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub struct Scopes {
    pub elder: bool,
    pub family: bool,
}

impl Scopes {
    pub fn has(self, scope: Scope) -> bool {
        match scope {
            Scope::Elder => self.elder,
            Scope::Family => self.family,
        }
    }
}

macro_rules! tools {
    ($($variant:ident => $name:literal : [$($scope:ident),+]),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        #[cfg_attr(kani, derive(kani::Arbitrary))]
        pub enum Tool { $($variant),+ }

        impl Tool {
            pub const ALL: &'static [Tool] = &[$(Tool::$variant),+];

            pub fn scopes(self) -> &'static [Scope] {
                match self { $(Tool::$variant => &[$(Scope::$scope),+]),+ }
            }

            pub fn name(self) -> &'static str {
                match self { $(Tool::$variant => $name),+ }
            }

            pub fn parse(name: &str) -> Option<Tool> {
                match name { $($name => Some(Tool::$variant),)+ _ => None }
            }
        }
    };
}

tools! {
    WhatDayIsIt => "what_day_is_it": [Elder],
    WhoIs => "who_is": [Elder],
    GetMedicationSchedule => "get_medication_schedule": [Elder],
    ConfirmMedicationTaken => "confirm_medication_taken": [Elder],
    DailyCheckIn => "daily_check_in": [Elder],
    AskFamilyForHelp => "ask_family_for_help": [Elder],
    GetFamilyMessages => "get_family_messages": [Elder],
    SendMessageToFamily => "send_message_to_family": [Elder],
    SaveMemoryStory => "save_memory_story": [Elder],
    ListMemoryStories => "list_memory_stories": [Elder],
    GetUpcomingAppointments => "get_upcoming_appointments": [Elder, Family],
    WhereIs => "where_is": [Elder, Family],
    FamilySummary => "family_summary": [Family],
    RecordRefill => "record_refill": [Family],
    ClaimAppointmentEscort => "claim_appointment_escort": [Family],
    WeeklyFamilyLetter => "weekly_family_letter": [Family],
    AcknowledgeAlert => "acknowledge_alert": [Family],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(kani, derive(kani::Arbitrary))]
pub enum Caller {
    Local,
    Token(Scopes),
}

pub fn may_call(caller: Caller, tool: Tool, exposed: bool) -> bool {
    match caller {
        Caller::Local => !exposed,
        Caller::Token(scopes) => tool.scopes().iter().any(|s| scopes.has(*s)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROLES: [Option<Role>; 4] = [None, Some(Role::Owner), Some(Role::Member), Some(Role::Neighbour)];

    fn principals() -> impl Iterator<Item = Principal> {
        let mut all = vec![Principal::Anonymous];
        for h in 0..3u32 {
            all.push(Principal::Open { household: h });
            all.push(Principal::Device { household: h });
            for role in ROLES {
                all.push(Principal::User { household: Some(h), role });
            }
        }
        for role in ROLES {
            all.push(Principal::User { household: None, role });
        }
        all.into_iter()
    }

    #[test]
    fn names_round_trip_and_are_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for a in Action::ALL {
            assert_eq!(Action::parse(a.name()), Some(*a));
            assert!(seen.insert(a.name()));
        }
        for t in Tool::ALL {
            assert_eq!(Tool::parse(t.name()), Some(*t));
        }
        assert_eq!(Action::parse("nope"), None);
    }

    #[test]
    fn exhaustive_matrix_obeys_the_rules() {
        for p in principals() {
            for a in Action::ALL {
                for h in 0..3u32 {
                    let out = decide(p, *a, h);
                    match (p, a.level()) {
                        (Principal::Anonymous, _) => assert_eq!(out, Err(Deny::NotSignedIn)),
                        (Principal::Device { household }, Level::Household | Level::Circle) if household == h => assert!(out.is_ok()),
                        (Principal::Device { .. }, _) => assert!(out.is_err()),
                        (Principal::User { role: Some(Role::Neighbour), household: Some(x) }, l) if x == h => {
                            assert_eq!(out.is_ok(), matches!(l, Level::Household | Level::SignedIn));
                        }
                        (Principal::User { role: Some(Role::Owner), household: Some(x) }, _) if x == h => assert!(out.is_ok()),
                        _ => {}
                    }
                }
            }
        }
    }

    #[test]
    fn neighbours_cannot_read_health_or_pair_devices() {
        let n = Principal::User { household: Some(1), role: Some(Role::Neighbour) };
        for a in [Action::CareRead, Action::CareEdit, Action::PairingCode, Action::DeviceDecide, Action::Letter, Action::AuditLog, Action::VaultKeys, Action::VaultRead] {
            assert_eq!(decide(n, a, 1), Err(Deny::NeighbourCannot));
        }
        assert!(decide(n, Action::AlertAck, 1).is_ok());
    }

    #[test]
    fn exposed_servers_refuse_local_callers() {
        for t in Tool::ALL {
            assert!(!may_call(Caller::Local, *t, true));
            assert!(may_call(Caller::Local, *t, false));
            assert!(!may_call(Caller::Token(Scopes { elder: false, family: false }), *t, false));
        }
        assert!(!may_call(Caller::Token(Scopes { elder: true, family: false }), Tool::FamilySummary, true));
        assert!(may_call(Caller::Token(Scopes { elder: false, family: true }), Tool::WhereIs, true));
    }
}

#[cfg(kani)]
mod proofs {
    use super::*;

    #[kani::proof]
    fn no_cross_household_access() {
        let p: Principal = kani::any();
        let a: Action = kani::any();
        let h: u32 = kani::any();
        if decide(p, a, h).is_ok() {
            match p {
                Principal::Anonymous => unreachable!(),
                Principal::Open { household } | Principal::Device { household } => assert!(household == h),
                Principal::User { household, .. } => assert!(household.map_or(a.level() == Level::SignedIn, |x| x == h)),
            }
        }
    }

    #[kani::proof]
    fn anonymous_is_always_refused() {
        let a: Action = kani::any();
        let h: u32 = kani::any();
        assert!(decide(Principal::Anonymous, a, h) == Err(Deny::NotSignedIn));
    }

    #[kani::proof]
    fn owner_actions_need_the_owner() {
        let p: Principal = kani::any();
        let a: Action = kani::any();
        let h: u32 = kani::any();
        kani::assume(a.level() == Level::Owner);
        if decide(p, a, h).is_ok() {
            assert!(matches!(p, Principal::User { role: Some(Role::Owner), .. }));
        }
    }

    #[kani::proof]
    fn devices_only_reach_household_actions() {
        let h: u32 = kani::any();
        let own: u32 = kani::any();
        let a: Action = kani::any();
        if decide(Principal::Device { household: own }, a, h).is_ok() {
            assert!(matches!(a.level(), Level::Household | Level::Circle));
        }
    }

    #[kani::proof]
    fn neighbours_only_see_household_actions() {
        let h: u32 = kani::any();
        let own: Option<u32> = kani::any();
        let a: Action = kani::any();
        if decide(Principal::User { household: own, role: Some(Role::Neighbour) }, a, h).is_ok() {
            assert!(matches!(a.level(), Level::Household | Level::SignedIn));
        }
    }

    #[kani::proof]
    fn family_actions_need_an_account() {
        let p: Principal = kani::any();
        let a: Action = kani::any();
        let h: u32 = kani::any();
        kani::assume(matches!(a.level(), Level::Family | Level::Owner | Level::SignedIn));
        if decide(p, a, h).is_ok() {
            assert!(matches!(p, Principal::User { .. }));
        }
    }

    #[kani::proof]
    fn roles_are_monotone() {
        let a: Action = kani::any();
        let h: u32 = kani::any();
        let own: Option<u32> = kani::any();
        let neighbour = decide(Principal::User { household: own, role: Some(Role::Neighbour) }, a, h).is_ok();
        let member = decide(Principal::User { household: own, role: Some(Role::Member) }, a, h).is_ok();
        let owner = decide(Principal::User { household: own, role: Some(Role::Owner) }, a, h).is_ok();
        assert!(!neighbour || member);
        assert!(!member || owner);
    }

    #[kani::proof]
    #[kani::unwind(4)]
    fn exposed_mcp_needs_a_matching_scope() {
        let c: Caller = kani::any();
        let t: Tool = kani::any();
        if may_call(c, t, true) {
            match c {
                Caller::Local => unreachable!(),
                Caller::Token(s) => assert!(t.scopes().iter().any(|x| s.has(*x))),
            }
        }
    }
}
