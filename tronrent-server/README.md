# Tronrent Server

A JavaScript backend service that implements a queue system for processing hash and target address pairs.

## Features

- API endpoint to receive and queue hash and target address pairs
- MongoDB storage for queue items
- Scheduled processing of queue items
- Third-party API integration for processing queue items
- Duplicate detection to prevent repeated processing

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (or Docker for containerized setup)

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/yourusername/tronrent-server.git
   cd tronrent-server
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```
   PORT=4000
   MONGODB_URI=mongodb://localhost:27017/tronrent
   THIRD_PARTY_API_URL=https://example.com/api/process
   ```

   Replace the `THIRD_PARTY_API_URL` with the actual third-party service URL.

## Docker Setup

### Using Docker Compose (Recommended)

This project includes Docker Compose configuration for easy setup of both the application and MongoDB.

1. Start both MongoDB and the application:

   ```
   docker-compose up -d
   ```

   This will start MongoDB on port 27017 and the application on port 4000.

2. To stop all services:

   ```
   docker-compose down
   ```

### Using Docker for MongoDB Only

If you prefer to run only MongoDB in Docker and the application directly on your host:

1. Start MongoDB container:

   ```
   docker run -d \
     --name tronrent-mongodb \
     -p 27017:27017 \
     -v mongodb_data:/data/db \
     mongo:latest
   ```

2. Update your `.env` file to use the MongoDB container:

   ```
   MONGODB_URI=mongodb://localhost:27017/tronrent
   ```

3. Start the application:

   ```
   npm start
   ```

### Docker Commands Reference

- View running containers:

  ```
  docker ps
  ```

- View container logs:

  ```
  docker logs tronrent-mongodb
  ```

- Stop and remove MongoDB container:

  ```
  docker stop tronrent-mongodb
  docker rm tronrent-mongodb
  ```

- Access MongoDB shell inside the container:
  ```
  docker exec -it tronrent-mongodb mongosh
  ```

## Usage

### Starting the Server

```
node app.js
```

Or with nodemon for development:

```
npm run dev
```

### API Endpoints

#### Add to Queue

```
POST /api/queue
```

Request body:

```json
{
  "hash": "021a6da88e118989de2bd0f31c147eb0bbc7091db227cc14186809f41b064076",
  "targetAddress": "TEDsu2JsMyNRXZRZsP1YTEgfiEaFkvvSZ8"
}
```

Response:

```json
{
  "success": true,
  "message": "Item added to queue successfully",
  "item": {
    "hash": "021a6da88e118989de2bd0f31c147eb0bbc7091db227cc14186809f41b064076",
    "targetAddress": "TEDsu2JsMyNRXZRZsP1YTEgfiEaFkvvSZ8",
    "status": "pending",
    "response": null,
    "createdAt": "2023-06-01T12:00:00.000Z",
    "updatedAt": "2023-06-01T12:00:00.000Z",
    "_id": "..."
  }
}
```

#### Get Queue Items

```
GET /api/queue
```

Optional query parameters:

- `status`: Filter by status (pending, processing, completed, failed)

Response:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "...",
      "hash": "021a6da88e118989de2bd0f31c147eb0bbc7091db227cc14186809f41b064076",
      "targetAddress": "TEDsu2JsMyNRXZRZsP1YTEgfiEaFkvvSZ8",
      "status": "pending",
      "response": null,
      "createdAt": "2023-06-01T12:00:00.000Z",
      "updatedAt": "2023-06-01T12:00:00.000Z"
    }
  ]
}
```

#### Manually Process Queue

```
POST /api/queue/process
```

Response:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "...",
      "hash": "021a6da88e118989de2bd0f31c147eb0bbc7091db227cc14186809f41b064076",
      "targetAddress": "TEDsu2JsMyNRXZRZsP1YTEgfiEaFkvvSZ8",
      "status": "completed",
      "response": { ... },
      "createdAt": "2023-06-01T12:00:00.000Z",
      "updatedAt": "2023-06-01T12:05:00.000Z"
    }
  ]
}
```

## Scheduled Processing

The server automatically processes pending queue items every 5 minutes. You can adjust the schedule in the `app.js` file by modifying the cron expression.

## License

ISC
