from fastapi import FastAPI

from api.routes.calculator import v1_calculator

app = FastAPI()
app.include_router(v1_calculator.router)
