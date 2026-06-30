const express = require("express");
const router = express.Router();
const queueService = require("../services/queueService");

/**
 * POST /api/queue
 * Add a new item to the queue
 */
router.post("/", async (req, res) => {
  try {
    const { hash, targetAddress } = req.body;

    // Validate input
    if (!hash || !targetAddress) {
      return res.status(400).json({
        success: false,
        message: "Hash and targetAddress are required",
      });
    }

    // Add to queue
    const result = await queueService.addToQueue(hash, targetAddress);

    if (!result.success) {
      return res.status(409).json(result); // 409 Conflict
    }

    return res.status(201).json(result); // 201 Created
  } catch (error) {
    console.error("Error in POST /api/queue:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * GET /api/queue
 * Get all queue items
 */
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    const items = await queueService.getQueueItems(filter);

    return res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error("Error in GET /api/queue:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * POST /api/queue/process
 * Manually trigger queue processing
 */
router.post("/process", async (req, res) => {
  try {
    const processedItems = await queueService.processQueue();

    return res.status(200).json({
      success: true,
      count: processedItems.length,
      data: processedItems,
    });
  } catch (error) {
    console.error("Error in POST /api/queue/process:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = router;
