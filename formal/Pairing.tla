---------------------------- MODULE Pairing ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Tablet, Intruders, Emoji, Codes, MaxRequests

Devices == {Tablet} \cup Intruders
Requests == 1..MaxRequests
Status == {"pending", "approved", "denied", "expired"}

VARIABLES issued, redeemed, req, nextReq, sessions, inHand

vars == <<issued, redeemed, req, nextReq, sessions, inHand>>

NoRequest == [device |-> Tablet, emoji |-> CHOOSE e \in Emoji : TRUE, status |-> "none", claimed |-> FALSE]

TypeOK ==
  /\ issued \subseteq Codes
  /\ redeemed \subseteq Codes
  /\ nextReq \in 1..(MaxRequests + 1)
  /\ sessions \subseteq Devices
  /\ inHand \in [Devices -> SUBSET Requests]

Init ==
  /\ issued = {}
  /\ redeemed = {}
  /\ req = [r \in Requests |-> NoRequest]
  /\ nextReq = 1
  /\ sessions = {}
  /\ inHand = [d \in Devices |-> {}]

FamilyMakesCode(c) ==
  /\ c \notin issued
  /\ issued' = issued \cup {c}
  /\ UNCHANGED <<redeemed, req, nextReq, sessions, inHand>>

PendingEmoji == {req[r].emoji : r \in {x \in Requests : req[x].status = "pending"}}

Redeem(d, c, e) ==
  /\ c \in issued
  /\ c \notin redeemed
  /\ nextReq <= MaxRequests
  /\ e \notin PendingEmoji
  /\ redeemed' = redeemed \cup {c}
  /\ req' = [req EXCEPT ![nextReq] = [device |-> d, emoji |-> e, status |-> "pending", claimed |-> FALSE]]
  /\ inHand' = [inHand EXCEPT ![d] = @ \cup {nextReq}]
  /\ nextReq' = nextReq + 1
  /\ UNCHANGED <<issued, sessions>>

ShownOnTablet == {req[r].emoji : r \in {x \in inHand[Tablet] : req[x].status = "pending"}}

FamilyApproves(r) ==
  /\ req[r].status = "pending"
  /\ req[r].emoji \in ShownOnTablet
  /\ req' = [req EXCEPT ![r].status = "approved"]
  /\ UNCHANGED <<issued, redeemed, nextReq, sessions, inHand>>

FamilyRefuses(r) ==
  /\ req[r].status = "pending"
  /\ req' = [req EXCEPT ![r].status = "denied"]
  /\ UNCHANGED <<issued, redeemed, nextReq, sessions, inHand>>

Expire(r) ==
  /\ req[r].status = "pending"
  /\ req' = [req EXCEPT ![r].status = "expired"]
  /\ UNCHANGED <<issued, redeemed, nextReq, sessions, inHand>>

Claim(d, r) ==
  /\ r \in inHand[d]
  /\ req[r].device = d
  /\ req[r].status = "approved"
  /\ ~req[r].claimed
  /\ req' = [req EXCEPT ![r].claimed = TRUE]
  /\ sessions' = sessions \cup {d}
  /\ UNCHANGED <<issued, redeemed, nextReq, inHand>>

Next ==
  \/ \E c \in Codes : FamilyMakesCode(c)
  \/ \E d \in Devices, c \in Codes, e \in Emoji : Redeem(d, c, e)
  \/ \E r \in Requests : FamilyApproves(r) \/ FamilyRefuses(r) \/ Expire(r)
  \/ \E d \in Devices, r \in Requests : Claim(d, r)

Spec == Init /\ [][Next]_vars

IntrudersNeverGetIn == sessions \cap Intruders = {}

SessionsComeFromApprovals ==
  \A d \in sessions : \E r \in Requests : req[r].device = d /\ req[r].status = "approved" /\ req[r].claimed

CodesWorkOnce == Cardinality({r \in Requests : req[r].status /= "none"}) = Cardinality(redeemed)

RefusedNeverClaimed == \A r \in Requests : req[r].status \in {"denied", "expired"} => ~req[r].claimed

PendingEmojiDistinct ==
  \A r1, r2 \in Requests : (r1 /= r2 /\ req[r1].status = "pending" /\ req[r2].status = "pending") => req[r1].emoji /= req[r2].emoji
=============================================================================
