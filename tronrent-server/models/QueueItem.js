const { Sequelize, DataTypes } = require("sequelize");
const sequelize = new Sequelize(process.env.DATABASE_URL);

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
      index: true,
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
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: Sequelize.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: Sequelize.NOW,
    },
  },
  {
    tableName: "queue_items",
    timestamps: true,
  }
);

module.exports = QueueItem;
