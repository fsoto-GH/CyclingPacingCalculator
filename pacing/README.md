# 🚀 Running the Pacing API with Docker

This guide explains how to build, run, and manage the Pacing API using Docker and Docker Compose.

---

## 🧱 Docker Image Commands

### **Build the Docker image**
```bash
docker build -t cycling/pacing-api:latest .
```
- `-t cycling/pacing-api:latest` tags the image with a name (`cycling/pacing-api`) and version (`latest`).

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
- `-d` runs the container in detached mode.  
- `-p 8000:8000` maps container port 8000 → host port 8000.  
- `--name pacing-api` assigns a readable name.  
- `cycling/pacing-api:latest` specifies the image to run.

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
- `-d` runs in detached mode.  
- `--build` rebuilds images before starting.

### **Stop and remove containers**
```bash
docker compose down
```

### **View logs**
```bash
docker compose logs -f
```
- `-f` follows logs in real time.
