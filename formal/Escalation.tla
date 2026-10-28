---------------------------- MODULE Escalation ----------------------------
EXTENDS Naturals

VARIABLES stage, acked, danger, mood, familyNudged

vars == <<stage, acked, danger, mood, familyNudged>>

Init ==
  /\ stage = "idle"
  /\ acked = FALSE
  /\ danger = FALSE
  /\ mood = "fine"
  /\ familyNudged = FALSE

SaysDanger(keepPrivate) ==
  /\ stage = "idle"
  /\ danger' = TRUE
  /\ stage' = "family"
  /\ UNCHANGED <<acked, mood, familyNudged>>

SaysSad(keepPrivate) ==
  /\ ~danger
  /\ mood' = IF keepPrivate THEN "private" ELSE "shared"
  /\ familyNudged' = (familyNudged \/ ~keepPrivate)
  /\ UNCHANGED <<stage, acked, danger>>

Advance ==
  /\ ~acked
  /\ stage \in {"family", "neighbour"}
  /\ stage' = IF stage = "family" THEN "neighbour" ELSE "emergency"
  /\ UNCHANGED <<acked, danger, mood, familyNudged>>

Acknowledge ==
  /\ stage \in {"family", "neighbour", "emergency"}
  /\ ~acked
  /\ acked' = TRUE
  /\ UNCHANGED <<stage, danger, mood, familyNudged>>

Next ==
  \/ \E p \in BOOLEAN : SaysDanger(p) \/ SaysSad(p)
  \/ Advance
  \/ Acknowledge

Spec == Init /\ [][Next]_vars /\ WF_vars(Advance)

DangerAlwaysAlerts == danger => stage /= "idle"

PrivacyIsKept == [][(mood' = "private") => (familyNudged' = familyNudged)]_vars

NeighbourOnlyForDanger == stage \in {"neighbour", "emergency"} => danger

HelpAlwaysArrives == danger ~> (acked \/ stage = "emergency")

NoSilentDowngrade == [][stage = "emergency" => stage' = "emergency"]_vars
=============================================================================
