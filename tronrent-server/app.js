const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cron = require("node-cron");
const { sequelize } = require("./db/models");
const queueRoutes = require("./routes/queueRoutes");
const queueService = require("./services/queueService");

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/queue", queueRoutes);

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Connect to database and sync models
sequelize
  .authenticate()
  .then(() => {
    console.log("Database connection established.");
    return sequelize.sync(); // 在开发环境使用
  })
  .then(() => {
    // 启动应用服务器
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // Set scheduled task to process queue every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      console.log("Running scheduled queue processing...");
      try {
        const processedItems = await queueService.processQueue();
        console.log(`Processed ${processedItems.length} items`);
      } catch (error) {
        console.error("Error in scheduled queue processing:", error);
      }
    });
  })
  .catch((err) => {
    console.error("Unable to connect to the database:", err);
  });

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

module.exports = app;
