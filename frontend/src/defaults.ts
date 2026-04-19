import type { SplitForm, RestStopForm } from "./types";
import { makeDefaultDayHours } from "./types";
import { browserTimezone } from "./components/TimezoneSelect";

export const DEFAULT_REST_STOP: RestStopForm = {
  enabled: false,
  backup: false,
  name: "",
  address: "",
  alt: "",
  sameHoursEveryDay: true,
  allDays: makeDefaultDayHours(),
  perDay: [
    makeDefaultDayHours(),
    makeDefaultDayHours(),
    makeDefaultDayHours(),
    makeDefaultDayHours(),
    makeDefaultDayHours(),
    makeDefaultDayHours(),
    makeDefaultDayHours(),
  ],
};

function cloneRestStop(): RestStopForm {
  return {
    ...DEFAULT_REST_STOP,
    allDays: { ...DEFAULT_REST_STOP.allDays },
    perDay: DEFAULT_REST_STOP.perDay.map((d) => ({
      ...d,
    })) as RestStopForm["perDay"],
  };
}

export const DEFAULT_SPLIT: SplitForm = {
  distance: "",
  sub_split_mode: "even",
  sub_split_count: "1",
  sub_split_distance: "",
  last_sub_split_threshold: "20",
  sub_split_distances: "",
  rest_stop: cloneRestStop(),
  down_time: "",
  moving_speed: "",
  adjustment_time: "",
  differentTimezone: false,
  timezone: browserTimezone,
  tzManuallySet: false,
  notes: "",
};

export function makeDefaultSplit(): SplitForm {
  return {
    ...DEFAULT_SPLIT,
    rest_stop: cloneRestStop(),
  };
}
