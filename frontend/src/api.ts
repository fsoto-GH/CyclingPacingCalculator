import axios from "axios";
import type { CoursePayload, CourseDetail } from "./types";

export async function calculateCourse(
  payload: CoursePayload,
): Promise<CourseDetail> {
  const response = await axios.post<CourseDetail>(
    "/v1/cycling/calculator",
    payload,
  );
  return response.data;
}
