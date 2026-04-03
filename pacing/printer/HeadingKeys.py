# DO NOT ALTER THE VALUES OF THESE CONSTANTS
# Altering the values match the keys used in SegmentDetail and SplitDetail dictionaries
DISTANCE = 'distance'
START_END = 'span'
MOVING_SPEED = 'moving_speed'
MOVING_TIME = 'moving_time'
DOWN_TIME = 'down_time'
PACE = 'pace'
START_TIME = 'start_time'
SPLIT_TIME = 'split_time'
ADJUSTMENT_TIME = 'adjustment_time'
ADJUSTMENT_START = 'adjustment_start'
ACTIVE_TIME = 'active_time'
END_TIME = 'end_time'

# for rest stop
REST_STOP_NAME = 'name'
REST_STOP_HOURS = 'hours'
REST_STOP_ADDRESS = 'address'
REST_STOP_ALT_URL = 'alt'

REST_STOP_DETAILS: set[str] = {
    REST_STOP_NAME,
    REST_STOP_HOURS,
    REST_STOP_ADDRESS,
    REST_STOP_ALT_URL,
}
