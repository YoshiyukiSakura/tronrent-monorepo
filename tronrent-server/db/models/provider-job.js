"use strict";

module.exports = (sequelize, DataTypes) => {
  const ProviderJob = sequelize.define(
    "ProviderJob",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      orderId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      dryRun: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      request: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      response: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "provider_jobs",
      timestamps: true,
    }
  );

  ProviderJob.associate = (models) => {
    ProviderJob.belongsTo(models.Order, {
      foreignKey: "orderId",
      as: "order",
    });
  };

  return ProviderJob;
};
