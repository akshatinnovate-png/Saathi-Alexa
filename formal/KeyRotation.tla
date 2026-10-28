---------------------------- MODULE KeyRotation ----------------------------
EXTENDS Naturals

CONSTANTS People, MaxEpoch

Epochs == 1..MaxEpoch

VARIABLES members, epoch, holders, removedAt, written

vars == <<members, epoch, holders, removedAt, written>>

Init ==
  /\ members = People
  /\ epoch = 1
  /\ holders = [e \in Epochs |-> IF e = 1 THEN People ELSE {}]
  /\ removedAt = [p \in People |-> 0]
  /\ written = {}

Remove(p) ==
  /\ p \in members
  /\ epoch < MaxEpoch
  /\ members' = members \ {p}
  /\ epoch' = epoch + 1
  /\ holders' = [holders EXCEPT ![epoch + 1] = members \ {p}]
  /\ removedAt' = [removedAt EXCEPT ![p] = epoch + 1]
  /\ UNCHANGED written

Invite(p) ==
  /\ p \notin members
  /\ members' = members \cup {p}
  /\ holders' = [e \in Epochs |-> IF e <= epoch THEN holders[e] \cup {p} ELSE holders[e]]
  /\ removedAt' = [removedAt EXCEPT ![p] = 0]
  /\ UNCHANGED <<epoch, written>>

Write ==
  /\ written' = written \cup {epoch}
  /\ UNCHANGED <<members, epoch, holders, removedAt>>

Next == \/ \E p \in People : Remove(p) \/ Invite(p)
        \/ Write

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ members \subseteq People
  /\ epoch \in Epochs
  /\ \A e \in Epochs : holders[e] \subseteq People

RemovedCannotReadNewData ==
  \A p \in People \ members : \A e \in written : e >= removedAt[p] => p \notin holders[e]

RemovedHoldNoNewKeys ==
  \A p \in People \ members : \A e \in Epochs : e >= removedAt[p] => p \notin holders[e]

MembersCanReadCurrent == \A p \in members : p \in holders[epoch]

FutureKeysDoNotExist == \A e \in Epochs : e > epoch => holders[e] = {}
=============================================================================
