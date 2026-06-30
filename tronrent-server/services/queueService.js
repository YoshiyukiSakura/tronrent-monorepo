const axios = require("axios");
const QueueItem = require("../models/QueueItem");
const { Op } = require("sequelize");

/**
 * Add a new item to the queue
 * @param {string} hash - The hash to process
 * @param {string} targetAddress - The target address
 * @returns {Promise<Object>} The created queue item
 */
async function addToQueue(hash, targetAddress) {
  try {
    // Check if the hash already exists in the queue
    const existingItem = await QueueItem.findOne({
      where: { hash },
    });

    if (existingItem) {
      return {
        success: false,
        message: "Hash already exists in the queue",
        item: existingItem,
      };
    }

    // Create a new queue item
    const queueItem = await QueueItem.create({
      hash,
      targetAddress,
      status: "pending",
    });

    return {
      success: true,
      message: "Item added to queue successfully",
      item: queueItem,
    };
  } catch (error) {
    console.error("Error adding to queue:", error);
    throw error;
  }
}

/**
 * Process the queue by sending pending items to the third-party service
 * @returns {Promise<Array>} Array of processed items
 */
async function processQueue() {
  try {
    // Find all pending items
    const pendingItems = await QueueItem.findAll({
      where: { status: "pending" },
    });

    if (pendingItems.length === 0) {
      console.log("No pending items in the queue");
      return [];
    }

    console.log(`Processing ${pendingItems.length} pending items`);

    const processedItems = [];

    // Process each pending item
    for (const item of pendingItems) {
      try {
        // Update status to processing
        await item.update({ status: "processing" });

        // Send request to third-party service
        const response = await axios.post(process.env.THIRD_PARTY_API_URL, {
          hash: item.hash,
          targetAddress: item.targetAddress,
        });

        // Update item with response
        await item.update({
          response: response.data,
          status: "completed",
        });

        processedItems.push(item);
        console.log(`Processed item with hash: ${item.hash}`);
      } catch (error) {
        // Update item with error
        await item.update({
          status: "failed",
          response: { error: error.message },
        });

        processedItems.push(item);
        console.error(
          `Failed to process item with hash: ${item.hash}`,
          error.message
        );
      }
    }

    return processedItems;
  } catch (error) {
    console.error("Error processing queue:", error);
    throw error;
  }
}

/**
 * Get all queue items with optional filtering
 * @param {Object} filter - Filter criteria
 * @returns {Promise<Array>} Array of queue items
 */
async function getQueueItems(filter = {}) {
  try {
    const where = {};
    if (filter.status) {
      where.status = filter.status;
    }

    return await QueueItem.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });
  } catch (error) {
    console.error("Error getting queue items:", error);
    throw error;
  }
}

module.exports = {
  addToQueue,
  processQueue,
  getQueueItems,
};
