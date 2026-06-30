"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert("queue_items", [
      {
        hash: "021a6da88e118989de2bd0f31c147eb0bbc7091db227cc14186809f41b064076",
        targetAddress: "TEDsu2JsMyNRXZRZsP1YTEgfiEaFkvvSZ8",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete("queue_items", null, {});
  },
};
