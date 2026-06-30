"use strict";

module.exports = (sequelize, DataTypes) => {
  const QueueItem = sequelize.define(
    "QueueItem",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      hash: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      targetAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "processing", "completed", "failed"),
        defaultValue: "pending",
      },
      response: {
        type: DataTypes.JSONB,
        defaultValue: null,
      },
    },
    {
      tableName: "queue_items",
      timestamps: true,
    }
  );

  return QueueItem;
};
