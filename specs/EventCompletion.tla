----------------------------- MODULE EventCompletion -----------------------------
EXTENDS Naturals, Sequences, FiniteSets

\* Compact state-machine spec for the selected-day completion toggle.
\* The client may request a toggle immediately, but persisted completion only
\* changes after a successful server write.

CONSTANT EventIds

VARIABLES completed, pending, actionError

Init ==
    /\ completed \in [EventIds -> BOOLEAN]
    /\ pending = [id \in EventIds |-> FALSE]
    /\ actionError = ""

ToggleRequest(id) ==
    /\ id \in EventIds
    /\ ~pending[id]
    /\ pending' = [pending EXCEPT ![id] = TRUE]
    /\ completed' = completed
    /\ actionError' = ""

PersistSuccess(id) ==
    /\ id \in EventIds
    /\ pending[id]
    /\ pending' = [pending EXCEPT ![id] = FALSE]
    /\ completed' = [completed EXCEPT ![id] = ~@]
    /\ actionError' = ""

PersistFailure(id, msg) ==
    /\ id \in EventIds
    /\ pending[id]
    /\ msg \in STRING
    /\ pending' = [pending EXCEPT ![id] = FALSE]
    /\ completed' = completed
    /\ actionError' = msg

Next ==
    \E id \in EventIds:
        ToggleRequest(id)
        \/ PersistSuccess(id)
        \/ \E msg \in STRING: PersistFailure(id, msg)

CompletedChangesOnlyAfterSuccess ==
    \A id \in EventIds:
        completed[id] # completed'[id] => /\ pending[id] /\ ~pending'[id] /\ actionError' = ""

FailureDoesNotMutateCompletion ==
    \A id \in EventIds:
        actionError' # "" => completed'[id] = completed[id]

Spec ==
    Init /\ [][Next]_<<completed, pending, actionError>>

=============================================================================
