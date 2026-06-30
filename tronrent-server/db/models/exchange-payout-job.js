"use strict";

module.exports = (sequelize, DataTypes) => {
  const ExchangePayoutJob = sequelize.define(
    "ExchangePayoutJob",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      exchangeOrderId: {
        type: DataTypes.UUID,
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
      asset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      contractAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      toAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amountBaseUnits: {
        type: DataTypes.BIGINT,
        allowNull: false,
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
      tableName: "exchange_payout_jobs",
      timestamps: true,
    }
  );

  ExchangePayoutJob.associate = (models) => {
    ExchangePayoutJob.belongsTo(models.ExchangeOrder, {
      foreignKey: "exchangeOrderId",
      as: "exchangeOrder",
    });
    ExchangePayoutJob.hasMany(models.ChainDeposit, {
      foreignKey: "matchedExchangePayoutJobId",
      as: "chainDeposits",
    });
  };

  return ExchangePayoutJob;
};
