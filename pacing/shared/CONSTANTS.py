DISTANCE = 'distance'
TARGET_DISTANCE = 'target_distance'
(MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY) = range(7)

# LEGEND KEYS
KOM = "KOM"
KOM_TRY = "KOM-TRY"
REST = "REST"
REST_OPT = "REST-OPT"
START = "START"
FINISH = "FINISH"
HAZARD = "HAZARD"

LEGEND = {
    KOM: '\u265a',
    KOM_TRY: "\u265e",
    REST: "\u2605",
    REST_OPT: "\u2606",
    START: "\U0001f3c1",
    FINISH: "\U0001f3c1",
    HAZARD: "\u2622"
}

LEGEND_DESCRIPTION = {
    KOM: "Go for KOM!",
    KOM_TRY: "Optional KOM!",
    REST: "Rest Stop",
    REST_OPT: "Optional Rest Stop",
    START: "Start",
    FINISH: "Finish",
}
