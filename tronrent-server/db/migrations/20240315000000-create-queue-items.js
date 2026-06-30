"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("queue_items", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      hash: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      targetAddress: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "processing", "completed", "failed"),
        defaultValue: "pending",
      },
      response: {
        type: Sequelize.JSONB,
        defaultValue: null,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("now"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("now"),
      },
    });

    // 创建索引
    await queryInterface.addIndex("queue_items", ["hash"]);
    await queryInterface.addIndex("queue_items", ["status"]);
    await queryInterface.addIndex("queue_items", ["createdAt"]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("queue_items");
  },
};
