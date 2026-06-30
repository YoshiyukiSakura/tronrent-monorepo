"use strict";

module.exports = (sequelize, DataTypes) => {
  const ChainDeposit = sequelize.define(
    "ChainDeposit",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      depositKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      network: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "tron",
      },
      asset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      txHash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      eventIndex: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "0",
      },
      contractAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      tokenDecimals: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      tokenSymbol: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fromAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      toAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amountBaseUnits: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      blockNumber: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      blockTimestamp: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      confirmations: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      matchedOrderId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      matchedPaymentId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      matchedExchangeOrderId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      matchedExchangePayoutJobId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      raw: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "chain_deposits",
      timestamps: true,
    }
  );

  ChainDeposit.associate = (models) => {
    ChainDeposit.belongsTo(models.Order, {
      foreignKey: "matchedOrderId",
      as: "matchedOrder",
    });
    ChainDeposit.belongsTo(models.Payment, {
      foreignKey: "matchedPaymentId",
      as: "matchedPayment",
    });
    ChainDeposit.belongsTo(models.ExchangeOrder, {
      foreignKey: "matchedExchangeOrderId",
      as: "matchedExchangeOrder",
    });
    ChainDeposit.belongsTo(models.ExchangePayoutJob, {
      foreignKey: "matchedExchangePayoutJobId",
      as: "matchedExchangePayoutJob",
    });
  };

  return ChainDeposit;
};
