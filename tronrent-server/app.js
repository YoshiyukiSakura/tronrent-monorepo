const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cron = require("node-cron");
const { sequelize } = require("./db/models");
const adminRoutes = require("./routes/adminRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const depositRoutes = require("./routes/depositRoutes");
const exchangeRoutes = require("./routes/exchangeRoutes");
const orderRoutes = require("./routes/orderRoutes");
const providerJobRoutes = require("./routes/providerJobRoutes");
const queueRoutes = require("./routes/queueRoutes");
const depositWatcherService = require("./services/depositWatcherService");
const exchangeOrderService = require("./services/exchangeOrderService");
const exchangePayoutJobService = require("./services/exchangePayoutJobService");
const orderService = require("./services/orderService");
const providerJobService = require("./services/providerJobService");
const queueService = require("./services/queueService");

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ||
    "http://localhost:3100,http://localhost:3101"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Idempotency-Key,x-admin-token,x-admin-actor"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/deposits", depositRoutes);
app.use("/api/exchange", exchangeRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/provider-jobs", providerJobRoutes);
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
    if (process.env.ENABLE_DB_SYNC === "true") {
      console.warn("ENABLE_DB_SYNC=true; use migrations for durable schemas.");
      return sequelize.sync();
    }
    console.log("Skipping sequelize.sync(); run migrations before serving.");
    return null;
  })
  .then(() => {
    // 启动应用服务器
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    if (process.env.ENABLE_QUEUE_CRON === "true") {
      cron.schedule("*/5 * * * *", async () => {
        console.log("Running scheduled queue processing...");
        try {
          const processedItems = await queueService.processQueue();
          console.log(`Processed ${processedItems.length} queue items`);
        } catch (error) {
          console.error("Error in scheduled queue processing:", error);
        }
      });
    }

    if (process.env.ENABLE_ORDER_PROVIDER_CRON === "true") {
      cron.schedule("* * * * *", async () => {
        console.log("Running scheduled provider job processing...");
        try {
          const processedJobs =
            await providerJobService.processPendingPaidOrders();
          console.log(`Processed ${processedJobs.length} provider jobs`);
        } catch (error) {
          console.error("Error in scheduled provider processing:", error);
        }
      });
    }

    if (process.env.ENABLE_DEPOSIT_WATCHER_CRON === "true") {
      cron.schedule("* * * * *", async () => {
        console.log("Running scheduled deposit scan...");
        try {
          const scanResult = await depositWatcherService.scanConfiguredTreasury({
            processProviderJobs:
              process.env.DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS === "true",
            processExchangePayouts:
              process.env.DEPOSIT_WATCHER_PROCESS_EXCHANGE_PAYOUTS === "true",
          });
          console.log(
            `Scanned ${scanResult.scanned} deposits, matched ${scanResult.matched}`
          );
        } catch (error) {
          console.error("Error in scheduled deposit scan:", error);
        }
      });
    }

    if (process.env.ENABLE_EXCHANGE_PAYOUT_CRON === "true") {
      cron.schedule("* * * * *", async () => {
        console.log("Running scheduled exchange payout processing...");
        try {
          const processedJobs =
            await exchangePayoutJobService.processPendingExchangePayouts();
          console.log(
            `Processed ${processedJobs.length} exchange payout jobs`
          );
        } catch (error) {
          console.error("Error in scheduled exchange payout processing:", error);
        }
      });
    }

    if (process.env.ENABLE_ORDER_EXPIRY_CRON === "true") {
      cron.schedule("* * * * *", async () => {
        console.log("Running scheduled order expiry sweep...");
        try {
          const expiredCount = await orderService.expirePendingOrders();
          console.log(`Expired ${expiredCount} pending orders`);
        } catch (error) {
          console.error("Error in scheduled order expiry sweep:", error);
        }
      });
    }

    if (process.env.ENABLE_EXCHANGE_EXPIRY_CRON === "true") {
      cron.schedule("* * * * *", async () => {
        console.log("Running scheduled exchange expiry sweep...");
        try {
          const expiredCount =
            await exchangeOrderService.expirePendingExchangeOrders();
          console.log(`Expired ${expiredCount} pending exchange orders`);
        } catch (error) {
          console.error("Error in scheduled exchange expiry sweep:", error);
        }
      });
    }
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
