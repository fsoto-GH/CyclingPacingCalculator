# 🚴‍♂️ CyclingPacingCalculator
## 🧠 Why I Built This
 
Multi-day ultra-endurance cycling events don't have a simple finish time. Your speed decays as fatigue accumulates. Sleep windows eat into your clock. Rest stops, aid stations, and segments with different terrain all compound into a final elapsed time that is nearly impossible to estimate in your head.

Before Mishigami 2025—a 1,121-mile race across Michigan—I needed a way to model different pacing strategies and understand the tradeoffs. How fast could I afford to start? How much would a 3-hour sleep window cost me versus a 1-hour nap? What happens if my average speed drops by 1 mph in the final 200 miles?

I built this calculator to answer those questions. It powered my race plan for Mishigami, where I finished 2nd place—the first Chicagoan ever to complete the race in under 4 days.

While the race is over, I plan to continue enhancing this project. I'd live to ultimately have:
-  A nice front-end to quickly modify inputs
-  GPX route support to split and visualize the route
-  Allow for GPX route analysis (insights into elevation gain&mdash;hilly segments or splits) to aid in planning
-  A way to, on-the-fly, find and select rest stops to ultimately export

This repository contains my implementation of a cycling pacing calculator.
- **A Dockerized API** that can be deployed and consumed by other applications.
- **A standalone Python package** that exposes the core pacing logic without requiring the API.

---

## 📦 Using the Calculator as a Python Package

You don’t need to run the API to use the pacing logic. The core functionality lives in the [`calculator` package](./pacing/calculator), which contains all pacing‑related computations. It works alongside the [`printer` package](./pacing/printer), which formats results into clean, human‑readable output.

To see how to use these packages directly, check out the [`examples/` directory](./pacing/examples). It includes runnable scripts demonstrating:

- How to compute pacing strategies  
- How to print results using the printer utilities  
- A rough draft of my Mishigami Challenge pacing plan  

If you want to run the examples locally, install dependencies from the project root:

```
pip install -r requirements.txt
```

---

# 🚀 Running the Pacing API with Docker

This section explains how to build, run, and manage the Pacing API using Docker and Docker Compose.

---

## 🧱 Docker Image Commands

### **Build the Docker image**
```bash
docker build -t cycling/pacing-api:latest .
```
- Tags the image as `cycling/pacing-api:latest`.

### **Build without cache**
```bash
docker build --no-cache -t cycling/pacing-api:latest .
```
- Forces Docker to rebuild every layer from scratch.

---

## 🐳 Docker Container Commands

### **Run the container**
```bash
docker run -d -p 8000:8000 --name pacing-api cycling/pacing-api:latest
```
- `-d` runs in detached mode  
- `-p 8000:8000` maps container → host port  
- `--name pacing-api` assigns a readable name  
- `cycling/pacing-api:latest` selects the image  

### **Stop the container**
```bash
docker stop pacing-api
```

### **Start the container**
```bash
docker start pacing-api
```

---

## 🧩 Docker Compose Commands

### **Start services (build if needed)**
```bash
docker compose up -d --build
```
- `-d` runs in detached mode  
- `--build` rebuilds images before starting  

### **Stop and remove containers**
```bash
docker compose down
```

### **View logs**
```bash
docker compose logs -f
```
- `-f` follows logs in real time  

## 🧭 Using Swagger UI

The API includes interactive documentation powered by Swagger.

Once the container is running, open:

```
http://localhost:8000/docs
```

From there, you can:

- Explore all endpoints  
- View request/response models  
- Execute POST requests directly in the browser  


## 📬 Posting to the Calculator Endpoint

Once the API is running (via Docker or Docker Compose), you can send requests to the calculator endpoint to compute pacing strategies programmatically.

### **Base URL**
```
http://localhost:8000
```

### **Calculator Endpoint**
```bash 
http://localhost:8000/v1/cycling/calculator
```

---

## 🧮 POST to the Calculator

The main calculator endpoint accepts a JSON payload describing the calculation mode and the required inputs. 

### **Example JSON Body**
```json
{
	"segments": [
        {
            "splits": [
                {
                    "distance": 40,
                    "sub_split_mode": "fixed",
                    "sub_split_distance": 20
                }
            ],
            "sleep_time": 3600
        }
    ],
    "mode": "distance",
    "init_moving_speed": 20,
    "min_moving_speed": 16.0,
    "down_time_ratio": 0.05,
    "split_decay": 0.25,
    "start_time": "2026-03-04T08:10:00"
}
```

### **Example Response**
```json
{
    "segment_details": [
        {
            "split_details": [
                {
                    "distance": 40.0,
                    "start_time": "2026-03-04T08:10:00",
                    "end_time": "2026-03-04T10:10:00",
                    "moving_speed": 20.0,
                    "moving_time": "0d  2h  0m  0.00s",
                    "down_time": "0d  0h  0m  0.00s",
                    "split_time": "0d  2h  0m  0.00s",
                    "active_time": "0d  2h  0m  0.00s",
                    "pace": 20.0,
                    "start_distance": 0.0,
                    "sub_splits": [
                        {
                            "distance": 20.0,
                            "start_time": "2026-03-04T08:10:00",
                            "end_time": "2026-03-04T09:10:00",
                            "moving_speed": 20.0,
                            "moving_time": "0d  1h  0m  0.00s",
                            "down_time": "0d  0h  0m  0.00s",
                            "split_time": "0d  1h  0m  0.00s",
                            "active_time": "0d  1h  0m  0.00s",
                            "pace": 20.0,
                            "start_distance": 0.0,
                            "span": [
                                0.0,
                                20.0
                            ]
                        },
                        {
                            "distance": 20.0,
                            "start_time": "2026-03-04T09:10:00",
                            "end_time": "2026-03-04T10:10:00",
                            "moving_speed": 20.0,
                            "moving_time": "0d  1h  0m  0.00s",
                            "down_time": "0d  0h  0m  0.00s",
                            "split_time": "0d  1h  0m  0.00s",
                            "active_time": "0d  1h  0m  0.00s",
                            "pace": 20.0,
                            "start_distance": 20.0,
                            "span": [
                                20.0,
                                40.0
                            ]
                        }
                    ],
                    "adjustment_start": "2026-03-04T10:10:00",
                    "adjustment_time": "0d  0h  0m  0.00s",
                    "rest_stop": null,
                    "span": [
                        0.0,
                        40.0
                    ]
                }
            ],
            "start_time": "2026-03-04T08:10:00",
            "end_time": "2026-03-04T10:10:00",
            "end_moving_speed": 19.75,
            "distance": 40.0,
            "start_distance": 0.0,
            "moving_time": "0d  2h  0m  0.00s",
            "down_time": "0d  0h  0m  0.00s",
            "sleep_time": "0d  1h  0m  0.00s",
            "adjustment_time": "0d  0h  0m  0.00s",
            "moving_speed": null,
            "adjustment_start": null,
            "name": null,
            "elapsed_time": "0d  3h  0m  0.00s",
            "active_time": "0d  2h  0m  0.00s",
            "span": [
                0.0,
                40.0
            ],
            "pace": 20.0,
            "moving_time_hours": 2.0,
            "down_time_hours": 0.0,
            "adjustment_time_hours": 0.0,
            "elapsed_time_hours": 3.0,
            "active_time_hours": 2.0,
            "sleep_time_hours": 1.0
        }
    ],
    "start_time": "2026-03-04T08:10:00",
    "end_time": "2026-03-04T11:10:00",
    "elapsed_time": "0d  3h  0m  0.00s",
    "moving_time": "0d  2h  0m  0.00s",
    "down_time": "0d  0h  0m  0.00s",
    "sleep_time": "0d  1h  0m  0.00s",
    "adjustment_time": "0d  0h  0m  0.00s",
    "start_distance": 0.0,
    "distance": 40.0,
    "adjustment_time_hours": 0.0,
    "elapsed_time_hours": 3.0,
    "down_time_hours": 0.0,
    "moving_time_hours": 2.0,
    "sleep_time_hours": 1.0
}
```

(Your actual response fields will depend on your calculator logic.)

---
