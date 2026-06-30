"use strict";

module.exports = (sequelize, DataTypes) => {
  const ExchangeOrder = sequelize.define(
    "ExchangeOrder",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      idempotencyKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      quoteId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
      },
      direction: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      customerWalletAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      outputAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      treasuryAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      inputAsset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      outputAsset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      inputContractAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      outputContractAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      inputDecimals: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      outputDecimals: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      quoteInputAmount: {
        type: DataTypes.DECIMAL(30, 6),
        allowNull: false,
      },
      quoteOutputAmount: {
        type: DataTypes.DECIMAL(30, 6),
        allowNull: false,
      },
      expectedInputBaseUnits: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      baseInputBaseUnits: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      inputOffsetBaseUnits: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      outputBaseUnits: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      spreadBps: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      rate: {
        type: DataTypes.DECIMAL(30, 12),
        allowNull: false,
      },
      depositReference: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      fundsReceivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      payoutCompletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "exchange_orders",
      timestamps: true,
    }
  );

  ExchangeOrder.associate = (models) => {
    ExchangeOrder.belongsTo(models.ExchangeQuote, {
      foreignKey: "quoteId",
      as: "quote",
    });
    ExchangeOrder.hasMany(models.ExchangePayoutJob, {
      foreignKey: "exchangeOrderId",
      as: "payoutJobs",
    });
    ExchangeOrder.hasMany(models.ChainDeposit, {
      foreignKey: "matchedExchangeOrderId",
      as: "chainDeposits",
    });
  };

  return ExchangeOrder;
};
