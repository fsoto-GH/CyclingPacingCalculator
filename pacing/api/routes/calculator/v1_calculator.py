from fastapi import APIRouter, HTTPException

from pacing.api.routes.calculator.dto.course import Course
from pacing.api.routes.calculator.service.course_service import validate_course, course_to_dto
from pacing.calculator.models.details.course_detail import CourseDetail
from pacing.calculator.service.calculations.course_processor import process_course
from pacing.shared import CONSTANTS


router = APIRouter(prefix="/v1/cycling", tags=["cycling"])


@router.post("/calculator", response_model=CourseDetail)
def post_course_information(course: Course):
    # default to TARGET_DISTANCE
    if course.mode is None:
        course.mode = CONSTANTS.TARGET_DISTANCE

    validation_result = validate_course(course)

    if len(validation_result) > 0:
        raise HTTPException(status_code=400, detail=validation_result)

    course_dto = course_to_dto(course)

    try:
        processed_course = process_course(course_dto)
        return processed_course
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
