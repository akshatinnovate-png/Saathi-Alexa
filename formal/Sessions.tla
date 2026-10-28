---------------------------- MODULE Sessions ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS People, MaxSessions

Ids == 1..MaxSessions

VARIABLES members, totp, live, nextId, owner, mfa

vars == <<members, totp, live, nextId, owner, mfa>>

Init ==
  /\ members = People
  /\ totp = [p \in People |-> FALSE]
  /\ live = {}
  /\ nextId = 1
  /\ owner = [i \in Ids |-> CHOOSE p \in People : TRUE]
  /\ mfa = [i \in Ids |-> FALSE]

SignIn(p, withCode) ==
  /\ p \in members
  /\ nextId <= MaxSessions
  /\ totp[p] => withCode
  /\ live' = live \cup {nextId}
  /\ owner' = [owner EXCEPT ![nextId] = p]
  /\ mfa' = [mfa EXCEPT ![nextId] = withCode]
  /\ nextId' = nextId + 1
  /\ UNCHANGED <<members, totp>>

TurnOnTwoStep(p) ==
  /\ p \in members
  /\ ~totp[p]
  /\ totp' = [totp EXCEPT ![p] = TRUE]
  /\ UNCHANGED <<members, live, nextId, owner, mfa>>

ChangePassword(s) ==
  /\ s \in live
  /\ live' = {x \in live : owner[x] /= owner[s] \/ x = s}
  /\ UNCHANGED <<members, totp, nextId, owner, mfa>>

SignOutEverywhereElse(s) == ChangePassword(s)

SignOut(s) ==
  /\ s \in live
  /\ live' = live \ {s}
  /\ UNCHANGED <<members, totp, nextId, owner, mfa>>

Expire(s) == SignOut(s)

RemoveMember(p) ==
  /\ p \in members
  /\ Cardinality(members) > 1
  /\ members' = members \ {p}
  /\ live' = {x \in live : owner[x] /= p}
  /\ UNCHANGED <<totp, nextId, owner, mfa>>

Next ==
  \/ \E p \in People, c \in BOOLEAN : SignIn(p, c)
  \/ \E p \in People : TurnOnTwoStep(p) \/ RemoveMember(p)
  \/ \E s \in Ids : ChangePassword(s) \/ SignOutEverywhereElse(s) \/ SignOut(s) \/ Expire(s)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ members \subseteq People
  /\ live \subseteq Ids
  /\ nextId \in 1..(MaxSessions + 1)

RemovedPeopleHaveNoSessions == \A s \in live : owner[s] \in members

LiveSessionsWereIssued == \A s \in live : s < nextId

TwoStepIsNeverSkipped ==
  [][\A s \in Ids : (s \notin live /\ s \in live' /\ totp[owner'[s]]) => mfa'[s]]_vars

RevocationIsFinal == [][\A s \in Ids : (s < nextId /\ s \notin live) => s \notin live']_vars
=============================================================================
