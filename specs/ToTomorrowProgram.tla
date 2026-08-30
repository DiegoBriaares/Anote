----------------------------- MODULE ToTomorrowProgram -----------------------------
EXTENDS FiniteSets, Naturals

\* Finite safety model for the server-owned Anote automatic-program boundary.
\* Scheduling arithmetic and SQLite behavior are tested by their concrete owners;
\* this model explores replay, status preservation, exact source selection and
\* notification/session ordering without representing browser clocks or storage.

CONSTANTS EventIds, ProgramIds, Dates,
          Pending, Completed, Failed,
          Past, Today, Tomorrow, Future,
          ActivationMessage

ASSUME /\ Cardinality(EventIds) >= 3
       /\ EventIds # {}
       /\ ProgramIds # {}
       /\ Dates = {Past, Today, Tomorrow, Future}
       /\ Past # Today
       /\ Today # Tomorrow
       /\ Tomorrow # Future
       /\ Pending # Completed
       /\ Completed # Failed
       /\ Pending # Failed

ePending == CHOOSE e \in EventIds: TRUE
eCompleted == CHOOSE e \in EventIds \ {ePending}: TRUE

VARIABLES eventDate,
          eventStatus,
          revision,
          enabled,
          dueSource,
          hasRun,
          runTarget,
          notification,
          sessionOpen,
          sessionMessage

vars == <<eventDate, eventStatus, revision, enabled, dueSource, hasRun,
          runTarget, notification, sessionOpen, sessionMessage>>

TypeOK ==
    /\ eventDate \in [EventIds -> Dates]
    /\ eventStatus \in [EventIds -> {Pending, Completed, Failed}]
    /\ revision \in [EventIds -> Nat \ {0}]
    /\ enabled \in [ProgramIds -> BOOLEAN]
    /\ dueSource \in [ProgramIds -> Dates]
    /\ hasRun \in [ProgramIds -> SUBSET Dates]
    /\ runTarget \in [ProgramIds -> [Dates -> Dates]]
    /\ notification \subseteq ProgramIds
    /\ sessionOpen \in BOOLEAN
    /\ sessionMessage \in {"", ActivationMessage}

Init ==
    /\ eventDate = [e \in EventIds |-> IF e = ePending THEN Past ELSE Today]
    /\ eventStatus = [e \in EventIds |->
          IF e = ePending THEN Pending
          ELSE IF e = eCompleted THEN Completed
          ELSE Failed]
    /\ revision = [e \in EventIds |-> 1]
    /\ enabled = [p \in ProgramIds |-> TRUE]
    /\ dueSource = [p \in ProgramIds |-> Past]
    /\ hasRun = [p \in ProgramIds |-> {}]
    /\ runTarget = [p \in ProgramIds |-> [d \in Dates |-> d]]
    /\ notification = {}
    /\ sessionOpen = TRUE
    /\ sessionMessage = ""

TargetFor(source) == IF source = Today THEN Tomorrow ELSE Today

MovedBy(source, target) ==
    [e \in EventIds |->
        IF /\ eventDate[e] = source
           /\ eventStatus[e] = Pending
        THEN target
        ELSE eventDate[e]]

RevisionAfter(source) ==
    [e \in EventIds |->
        IF /\ eventDate[e] = source
           /\ eventStatus[e] = Pending
        THEN revision[e] + 1
        ELSE revision[e]]

AutomaticRun(p) ==
    LET source == dueSource[p]
        target == TargetFor(source)
    IN  /\ p \in ProgramIds
        /\ enabled[p]
        /\ source \in {Past, Today}
        /\ source \notin hasRun[p]
        /\ eventDate' = MovedBy(source, target)
        /\ revision' = RevisionAfter(source)
        /\ hasRun' = [hasRun EXCEPT ![p] = @ \cup {source}]
        /\ runTarget' = [runTarget EXCEPT ![p][source] = target]
        /\ dueSource' = [dueSource EXCEPT ![p] = Tomorrow]
        /\ notification' = notification \cup {p}
        /\ UNCHANGED <<eventStatus, enabled, sessionOpen, sessionMessage>>

ManualRun(p) ==
    /\ p \in ProgramIds
    /\ Today \notin hasRun[p]
    /\ eventDate' = MovedBy(Today, Tomorrow)
    /\ revision' = RevisionAfter(Today)
    /\ hasRun' = [hasRun EXCEPT ![p] = @ \cup {Today}]
    /\ runTarget' = [runTarget EXCEPT ![p][Today] = Tomorrow]
    /\ UNCHANGED <<eventStatus, enabled, dueSource, notification,
                    sessionOpen, sessionMessage>>

RetryCommittedRun(p, source) ==
    /\ p \in ProgramIds
    /\ source \in hasRun[p]
    /\ UNCHANGED vars

SetEnabled(p, value) ==
    /\ p \in ProgramIds
    /\ value \in BOOLEAN
    /\ enabled' = [enabled EXCEPT ![p] = value]
    /\ UNCHANGED <<eventDate, eventStatus, revision, dueSource, hasRun,
                    runTarget, notification, sessionOpen, sessionMessage>>

ObserveAutomaticRun(p) ==
    /\ p \in notification
    /\ sessionOpen
    /\ notification' = notification \ {p}
    /\ sessionOpen' = FALSE
    /\ sessionMessage' = ActivationMessage
    /\ UNCHANGED <<eventDate, eventStatus, revision, enabled, dueSource,
                    hasRun, runTarget>>

Next ==
    \/ \E p \in ProgramIds: AutomaticRun(p)
    \/ \E p \in ProgramIds: ManualRun(p)
    \/ \E p \in ProgramIds, source \in Dates: RetryCommittedRun(p, source)
    \/ \E p \in ProgramIds, value \in BOOLEAN: SetEnabled(p, value)
    \/ \E p \in ProgramIds: ObserveAutomaticRun(p)

Spec == Init /\ [][Next]_vars

OnlyPendingSourceEventsMove ==
    \A e \in EventIds:
        eventDate'[e] # eventDate[e] => eventStatus[e] = Pending

TerminalEventsStayPut ==
    \A e \in EventIds:
        eventStatus[e] \in {Completed, Failed} => eventDate'[e] = eventDate[e]

MoveIncrementsRevisionExactlyOnce ==
    \A e \in EventIds:
        IF eventDate'[e] # eventDate[e]
        THEN revision'[e] = revision[e] + 1
        ELSE revision'[e] = revision[e]

RunLedgerMonotonic ==
    \A p \in ProgramIds: hasRun[p] \subseteq hasRun'[p]

SessionCloseHasAutomaticProtocol ==
    /\ sessionOpen
    /\ ~sessionOpen'
    => sessionMessage' = ActivationMessage

AlwaysOnlyPendingSourceEventsMove == [][OnlyPendingSourceEventsMove]_vars
AlwaysTerminalEventsStayPut == [][TerminalEventsStayPut]_vars
AlwaysMoveIncrementsRevisionExactlyOnce == [][MoveIncrementsRevisionExactlyOnce]_vars
AlwaysRunLedgerMonotonic == [][RunLedgerMonotonic]_vars
AlwaysSessionCloseHasAutomaticProtocol == [][SessionCloseHasAutomaticProtocol]_vars

=============================================================================
