import uvicorn
from fastapi import FastAPI
from routes.calculator import v1_calculator

app = FastAPI()
app.include_router(v1_calculator.router)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)