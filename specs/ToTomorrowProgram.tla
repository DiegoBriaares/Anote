----------------------------- MODULE ToTomorrowProgram -----------------------------
EXTENDS FiniteSets

\* Abstract state-machine contract for the To Tomorrow automatic program.
\*
\* This spec intentionally avoids React, Zustand, SQLite, HTTP, and browser APIs.
\* The substitutable implementation boundary is:
\*   - eventDate/completed represent calendar memory cells,
\*   - enabled/activationTime represent persisted program rows,
\*   - currentTime represents the connected session clock,
\*   - tomorrowProgramParameter is the cascade trigger,
\*   - sessionOpen/sessionMessage represent the automatic activation protocol.

CONSTANTS EventIds, ProgramIds, Dates, Times, Today, Tomorrow, ActivationMessage

ASSUME /\ EventIds # {}
       /\ ProgramIds # {}
       /\ Today \in Dates
       /\ Tomorrow \in Dates
       /\ Today # Tomorrow

VARIABLES eventDate,
          completed,
          enabled,
          activationTime,
          currentTime,
          tomorrowProgramParameter,
          sessionOpen,
          sessionMessage,
          hasRun

vars == <<eventDate,
          completed,
          enabled,
          activationTime,
          currentTime,
          tomorrowProgramParameter,
          sessionOpen,
          sessionMessage,
          hasRun>>

TypeOK ==
    /\ eventDate \in [EventIds -> Dates]
    /\ completed \in [EventIds -> BOOLEAN]
    /\ enabled \in [ProgramIds -> BOOLEAN]
    /\ activationTime \in [ProgramIds -> Times]
    /\ currentTime \in Times
    /\ tomorrowProgramParameter \in BOOLEAN
    /\ sessionOpen \in BOOLEAN
    /\ sessionMessage \in { "", ActivationMessage }
    /\ hasRun \in [ProgramIds -> SUBSET Times]

Init ==
    /\ TypeOK
    /\ tomorrowProgramParameter = FALSE
    /\ sessionOpen = TRUE
    /\ sessionMessage = ""
    /\ hasRun = [p \in ProgramIds |-> {}]

ToTomorrowDateMap ==
    [e \in EventIds |->
        IF /\ eventDate[e] = Today
           /\ ~completed[e]
        THEN Tomorrow
        ELSE eventDate[e]]

SetProgram(p, time, en) ==
    /\ p \in ProgramIds
    /\ time \in Times
    /\ en \in BOOLEAN
    /\ enabled' = [enabled EXCEPT ![p] = en]
    /\ activationTime' = [activationTime EXCEPT ![p] = time]
    /\ UNCHANGED <<eventDate,
                  completed,
                  currentTime,
                  tomorrowProgramParameter,
                  sessionOpen,
                  sessionMessage,
                  hasRun>>

ClockTick(time) ==
    /\ time \in Times
    /\ currentTime' = time
    /\ UNCHANGED <<eventDate,
                  completed,
                  enabled,
                  activationTime,
                  tomorrowProgramParameter,
                  sessionOpen,
                  sessionMessage,
                  hasRun>>

SetTomorrowProgramParameterTrue ==
    /\ sessionOpen
    /\ tomorrowProgramParameter' = TRUE
    /\ UNCHANGED <<eventDate,
                  completed,
                  enabled,
                  activationTime,
                  currentTime,
                  sessionOpen,
                  sessionMessage,
                  hasRun>>

RunToTomorrowFromParameter ==
    /\ sessionOpen
    /\ tomorrowProgramParameter
    /\ eventDate' = ToTomorrowDateMap
    /\ tomorrowProgramParameter' = FALSE
    /\ completed' = completed
    /\ UNCHANGED <<enabled,
                  activationTime,
                  currentTime,
                  sessionOpen,
                  sessionMessage,
                  hasRun>>

AutomaticToTomorrow(p) ==
    /\ p \in ProgramIds
    /\ sessionOpen
    /\ enabled[p]
    /\ activationTime[p] = currentTime
    /\ ~tomorrowProgramParameter
    /\ currentTime \notin hasRun[p]
    /\ eventDate' = ToTomorrowDateMap
    /\ completed' = completed
    /\ tomorrowProgramParameter' = FALSE
    /\ sessionOpen' = FALSE
    /\ sessionMessage' = ActivationMessage
    /\ hasRun' = [hasRun EXCEPT ![p] = @ \cup {currentTime}]
    /\ UNCHANGED <<enabled, activationTime, currentTime>>

Next ==
    \/ \E p \in ProgramIds, time \in Times, en \in BOOLEAN:
        SetProgram(p, time, en)
    \/ \E time \in Times:
        ClockTick(time)
    \/ SetTomorrowProgramParameterTrue
    \/ RunToTomorrowFromParameter
    \/ \E p \in ProgramIds:
        AutomaticToTomorrow(p)

Spec ==
    Init /\ [][Next]_vars

\* Safety contracts for any implementation substituted under this abstraction.

CompletedNeverChanges ==
    completed' = completed

OnlyTodayIncompleteEventsMove ==
    \A e \in EventIds:
        eventDate'[e] # eventDate[e] =>
            /\ eventDate[e] = Today
            /\ ~completed[e]
            /\ eventDate'[e] = Tomorrow

CompletedEventsStayPut ==
    \A e \in EventIds:
        completed[e] => eventDate'[e] = eventDate[e]

AutomaticActivationClosesWithProtocolMessage ==
    /\ sessionOpen
    /\ sessionOpen' = FALSE
    =>
    /\ sessionMessage' = ActivationMessage
    /\ \E p \in ProgramIds:
        /\ enabled[p]
        /\ activationTime[p] = currentTime
        /\ currentTime \in hasRun'[p]

ParameterRunDoesNotCloseSession ==
    /\ tomorrowProgramParameter
    /\ eventDate' = ToTomorrowDateMap
    =>
    /\ sessionOpen' = sessionOpen
    /\ sessionMessage' = sessionMessage

AlwaysCompletedNeverChanges ==
    [][CompletedNeverChanges]_vars

AlwaysOnlyTodayIncompleteEventsMove ==
    [][OnlyTodayIncompleteEventsMove]_vars

AlwaysCompletedEventsStayPut ==
    [][CompletedEventsStayPut]_vars

AlwaysAutomaticActivationClosesWithProtocolMessage ==
    [][AutomaticActivationClosesWithProtocolMessage]_vars

AlwaysParameterRunDoesNotCloseSessionSilently ==
    [][ParameterRunDoesNotCloseSession]_vars

=============================================================================
